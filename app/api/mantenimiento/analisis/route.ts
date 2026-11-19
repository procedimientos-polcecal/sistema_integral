import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeVerMantenimiento } from "@/lib/mantenimiento/auth";
import { hoyEnArgentina, sumarDias } from "@/lib/core/fechas";
import { traerTodo } from "@/lib/core/paginado";
import {
  analizarLaSemana,
  lasQueNecesitanReprogramarse,
  type OrdenParaAnalisis,
} from "@/lib/mantenimiento/analisisDeOt";
import {
  cadenaDeFechas,
  diasCorridos,
  diasDelMovimiento,
  type Reprogramacion,
} from "@/lib/mantenimiento/reprogramaciones";

/**
 * El análisis semanal de las OT: `GET ?semana=YYYY-MM-DD`, donde la fecha es
 * CUALQUIER día de la semana pedida (sin parámetro, la de hoy). Un valor mal
 * formado es un 400 y no un «usá la semana actual»: contestar otra semana sin
 * decirlo es mostrarle números que no pidió.
 *
 * La ruta no tiene aritmética: lee, compone las funciones de `analisisDeOt.ts`
 * y contesta.
 *
 * ── DOS ALCANCES, A PROPÓSITO ──────────────────────────────────────────────
 * `analisis` y `reprogramaciones` son **de la semana pedida**. `necesitan` es
 * **contra hoy**, nunca contra la semana: quien mira la semana 45 en diciembre
 * igual necesita la lista de lo que hay que reprogramar AHORA, y una lista de
 * lo que había que reprogramar hace un mes es una lista que nadie puede
 * accionar.
 *
 * ── CUÁNDO ENTRA UNA REPROGRAMACIÓN EN UNA SEMANA ──────────────────────────
 * Por `creado_en`. Para una fila de origen `planilla` eso es **cuándo la
 * sincronización notó el cambio, no cuándo alguien editó la celda**: la
 * planilla no guarda cuándo se tocó. Quien lea el conteo semanal tiene que
 * saber que, para esas filas, el día es el de la detección (la sincronización
 * corre cada diez minutos, así que la diferencia suele ser chica, pero una
 * edición hecha el domingo a la noche y detectada el lunes cuenta en el lunes).
 * La semana se mide en hora de Argentina, no en UTC.
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeVerMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Mantenimiento" }, { status: 403 });
  }

  const hoy = hoyEnArgentina();
  const pedida = new URL(req.url).searchParams.get("semana");
  if (pedida !== null && !esUnaFechaReal(pedida)) {
    return NextResponse.json(
      { error: "El parámetro «semana» tiene que ser una fecha AAAA-MM-DD." },
      { status: 400 },
    );
  }
  const unDiaDeLaSemana = pedida ?? hoy;

  try {
    // 2.531 filas hoy y PostgREST corta en 1.000: sin `traerTodo` el análisis
    // se calcularía sobre un tercio de la base sin avisar. El orden por id
    // hace estable la paginación.
    const ordenes = await traerTodo<OrdenParaAnalisis>((desde, hasta) =>
      supabase
        .from("ordenes_trabajo")
        .select(
          "id, ot_number, sector_raw, equipo_raw, tipo, descripcion, fecha_ejecucion, fecha_cierre, estado, app_created, reprogramada_veces",
        )
        .order("id")
        .range(desde, hasta),
    );

    const analisis = analizarLaSemana(ordenes, unDiaDeLaSemana);
    const necesitan = lasQueNecesitanReprogramarse(ordenes, hoy);

    // La semana de lunes a domingo en hora de pared argentina (UTC-3, sin
    // horario de verano), pasada como instantes con su huso explícito.
    const desdeInstante = `${analisis.lunes}T00:00:00-03:00`;
    const hastaInstante = `${sumarDias(analisis.domingo, 1)}T00:00:00-03:00`;

    // Una fila por MOVIMIENTO y no por OT: una semana con más de 1.000
    // movimientos —la primera vez que la sincronización vuelque un lote grande
    // de la planilla, por ejemplo— perdería OT enteras sin error ni aviso. Por
    // eso `traerTodo`, con `id` de desempate para que la paginación no repita
    // ni saltee filas que comparten `creado_en`.
    const deLaSemana = await traerTodo<{ ot_id: string }>((desde, hasta) =>
      supabase
        .from("mant_reprogramaciones_ot")
        .select("ot_id")
        .gte("creado_en", desdeInstante)
        .lt("creado_en", hastaInstante)
        .order("creado_en", { ascending: true })
        .order("id", { ascending: true })
        .range(desde, hasta),
    );

    // Se trae el historial ENTERO de las OT que se movieron esa semana y no
    // sólo los movimientos de la semana: la cadena de fechas y los días
    // corridos empiezan en la fecha original, y con un solo renglón de la
    // semana se verían como si la orden hubiera arrancado ahí.
    //
    // El lote queda ATRAPADO ENTRE DOS LÍMITES MUDOS: un `.in()` con muchos ids
    // arma una URL que PostgREST rechaza con un 400 sin decir por qué (de ahí
    // los 200), y una respuesta se corta en 1.000 filas sin avisar —200 OT con
    // cinco movimientos de promedio ya son 1.000—. Achicar el lote no cierra el
    // segundo límite (una OT sola puede tener muchos movimientos), así que cada
    // lote se pagina por dentro con `traerTodo`. Si se toca el 200, mirar los
    // dos.
    const ids = [...new Set(deLaSemana.map((f) => f.ot_id))];
    const historial: Reprogramacion[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const lote = ids.slice(i, i + 200);
      historial.push(
        ...(await traerTodo<Reprogramacion>((desde, hasta) =>
          supabase
            .from("mant_reprogramaciones_ot")
            .select(
              "id, ot_id, fecha_anterior, fecha_nueva, origen, razon, razon_etiqueta, justificacion, creado_por, creado_en",
            )
            .in("ot_id", lote)
            // `id` desempata: dos movimientos de una misma OT anotados en la
            // misma pasada de la sincronización comparten `creado_en`, y sin
            // él la cadena dependería del orden en que los devuelva Postgres.
            .order("creado_en", { ascending: true })
            .order("id", { ascending: true })
            .range(desde, hasta),
        )),
      );
    }

    // Los nombres de quienes reprogramaron, con el cliente ADMIN y en una
    // consulta aparte, a propósito: la policy de `usuarios` es
    // `id = auth.uid() or es_admin()`, así que un embebido
    // `creado_por:usuarios(...)` con la sesión devuelve null para las filas de
    // todo el mundo menos las propias, sin ningún error. Ya pasó con la campana
    // de la mensajería y con /mis-avisos, y las dos veces se descubrió tarde.
    // No simplificar a un embebido. Quien llega acá ya pasó el permiso de
    // Mantenimiento, y sólo se leen nombres de los autores que se devuelven.
    const idsDeAutores = [
      ...new Set(historial.map((m) => m.creado_por).filter((x): x is string => !!x)),
    ];
    const autores: Record<string, string> = {};
    if (idsDeAutores.length > 0) {
      const admin = createAdminClient();
      for (let i = 0; i < idsDeAutores.length; i += 200) {
        const { data, error } = await admin
          .from("usuarios")
          .select("id, nombre, apellido")
          .in("id", idsDeAutores.slice(i, i + 200));
        if (error) throw new Error(error.message);
        for (const u of data ?? []) {
          autores[u.id as string] =
            [u.nombre, u.apellido].filter(Boolean).join(" ").trim() || "(sin nombre)";
        }
      }
    }

    const ordenPorId = new Map(ordenes.map((o) => [o.id, o]));
    const movimientosPorOt = new Map<string, Reprogramacion[]>();
    for (const m of historial) {
      const lista = movimientosPorOt.get(m.ot_id) ?? [];
      lista.push(m);
      movimientosPorOt.set(m.ot_id, lista);
    }

    const reprogramaciones = ids
      .map((otId) => {
        const orden = ordenPorId.get(otId);
        const movimientos = movimientosPorOt.get(otId) ?? [];
        const vigente = orden?.fecha_ejecucion ?? null;
        return {
          ot_id: otId,
          ot_number: orden?.ot_number ?? null,
          sector_raw: orden?.sector_raw ?? null,
          equipo_raw: orden?.equipo_raw ?? null,
          descripcion: orden?.descripcion ?? null,
          fecha_vigente: vigente,
          cadena: cadenaDeFechas(movimientos, vigente),
          dias: diasCorridos(movimientos, vigente),
          movimientos: movimientos.map((m) => ({ ...m, dias: diasDelMovimiento(m) })),
        };
      })
      .sort((a, b) => (a.ot_number ?? 0) - (b.ot_number ?? 0));

    return NextResponse.json({ analisis, necesitan, reprogramaciones, autores });
  } catch (e) {
    // El detalle al log y no al cuerpo: el mensaje de Supabase nombra tablas y
    // columnas, y a la pantalla le alcanza con reintentar.
    console.error("[mantenimiento/analisis] no se pudo armar el análisis:", e);
    return NextResponse.json(
      { error: "No se pudo armar el análisis. Probá de nuevo en un momento." },
      { status: 500 },
    );
  }
}

/** "2026-02-30" tiene la forma pero no existe: se comprueba yendo y volviendo. */
function esUnaFechaReal(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
