import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esAdminMantenimiento } from "@/lib/mantenimiento/auth";
import { esFechaIso, semanaDe, sumarDias } from "@/lib/core/fechas";
import { traerTodo } from "@/lib/core/paginado";
import {
  estaVigente,
  noViene,
  type AusenciaCruda,
  type FrancoCrudo,
  type PersonaDelTaller,
} from "@/lib/mantenimiento/disponibilidad";
import {
  comoReferencia,
  laQueRige,
  turnoDeLaPersona,
  type FilaDeReferencia,
} from "@/lib/mantenimiento/referenciaDelTaller";
import {
  franjaDeLaSemana,
  type FranjaDeLaSemana,
} from "@/lib/mantenimiento/rotacionDeLaSemana";
import { resolverElCatalogo } from "@/lib/mantenimiento/operarioDelCatalogo";
import { turnoDelDia } from "@/lib/mantenimiento/asignarOperario";
import type { Grupo, Oficio, Turno } from "@/lib/mantenimiento/programacion";

/**
 * El taller de un mes: la rotación de cada semana, el catálogo de operarios
 * resuelto contra el padrón, y por día quién no viene y en qué turno está.
 *
 * Es lo que dibuja la franja arriba de cada semana del mes en «Asignación
 * RR.HH» y lo que llena el panel de asignar operarios a una OT.
 *
 * ── POR QUÉ ES UNA RUTA APARTE Y NO UN PEDAZO DE `/calendario` ─────────────
 *
 * Porque **de acá salen nombres**. `/api/mantenimiento/calendario` la abre
 * cualquiera que vea Mantenimiento —la montan tres pantallas, el alta de una
 * OT incluida— y por eso sólo manda **cuántas** personas hay por oficio, nunca
 * quiénes. Sumarle los nombres a esa ruta se los habría entregado a los
 * catorce niveles del módulo de una sola vez y sin que se note.
 *
 * Ésta está guardada con `esAdminMantenimiento`, el mismo permiso que la
 * pestaña «Semana», que es la otra que muestra al taller con nombre y apellido.
 *
 * ── LO QUE SE LEE Y LO QUE SALE ────────────────────────────────────────────
 *
 * Todo con el cliente admin y **una sola vez para todo el rango**, igual que
 * las dos rutas hermanas: `mant_personal_taller`, `ausencias` y `francos`
 * están cerradas con `tiene_acceso_rrhh()` o con el admin del módulo, así que
 * con el cliente de la sesión llegarían vacías **sin error** y la franja diría
 * «no hay nadie». El permiso lo pone la ruta, arriba.
 *
 * De `ausencias` entra el `tipo` porque `noViene` lo necesita para descartar
 * la `TARDANZA`, y **se tira antes del JSON**: es dato médico y disciplinario,
 * y es la misma regla que ya cumplen la ruta de programación y la de
 * disponibilidad. De acá sale sólo **quién** no viene y **qué día**, nunca por
 * qué.
 */

/**
 * El mismo tope que `/api/mantenimiento/calendario`, y por el mismo motivo: un
 * mes con las semanas parciales de los bordes llega a 42 días, y 62 deja
 * margen para quien pida dos meses corridos.
 */
const MAXIMO_DE_DIAS = 62;

/** Una fecha de la base como `YYYY-MM-DD` pelado, igual que en las rutas hermanas. */
function soloElDia(v: unknown): string {
  return String(v ?? "").slice(0, 10);
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Ver el taller del mes requiere ser admin de Mantenimiento" },
      { status: 403 }
    );
  }

  const params = new URL(request.url).searchParams;
  const desde = params.get("desde");
  const hasta = params.get("hasta");
  if (!esFechaIso(desde) || !esFechaIso(hasta)) {
    return NextResponse.json({ error: "desde y hasta tienen que ser AAAA-MM-DD" }, { status: 400 });
  }
  if (desde > hasta) {
    return NextResponse.json({ error: "desde no puede ser posterior a hasta" }, { status: 400 });
  }
  if (sumarDias(desde, MAXIMO_DE_DIAS) < hasta) {
    return NextResponse.json(
      { error: `El rango no puede pasar de ${MAXIMO_DE_DIAS} días` },
      { status: 400 }
    );
  }

  /*
   * Las semanas que toca el rango, y el rango real que hay que leer.
   *
   * Una franja habla de una semana entera, así que el primer lunes puede caer
   * antes de `desde` y el último domingo después de `hasta`: leer sólo el rango
   * pedido dejaría la primera y la última franja contando ausencias a medias.
   */
  const lunes: string[] = [];
  for (let d = semanaDe(desde)[0]; d <= hasta; d = sumarDias(d, 7)) lunes.push(d);
  const primerDia = lunes[0];
  const ultimoDia = semanaDe(lunes[lunes.length - 1])[6];

  const db = createAdminClient();

  /*
   * ── LAS CUATRO LECTURAS VAN CON `traerTodo()`, Y NO ES CEREMONIA ──────────
   *
   * PostgREST corta en 1.000 filas y no avisa. «Esta tabla es chica» es
   * justamente el razonamiento que la regla de la casa prohíbe, y acá hay dos
   * que pueden llegar: `mant_programacion_pisadas` es por persona y por día, o
   * sea ~16 personas × 62 días = 992 en el rango máximo; y
   * `mant_programacion_referencia` crece una fila por semana y se pide
   * **ascendente**, así que al cortar se perderían las anclas **más nuevas** y
   * `laQueRige` elegiría una vieja: la franja entera mostraría la rotación
   * equivocada, sin un solo error.
   */
  // ── El padrón que rige algún día del rango, con el nombre de cada uno ──
  let filasPadron: {
    empleado_id: string;
    oficio: string;
    grupo: string | null;
    desde: string;
    hasta: string | null;
    empleados: { nombre: string; apellido: string } | { nombre: string; apellido: string }[] | null;
  }[];
  try {
    filasPadron = await traerTodo((a, b) =>
      db
        .from("mant_personal_taller")
        .select("empleado_id, oficio, grupo, desde, hasta, empleados(nombre, apellido)")
        .lte("desde", ultimoDia)
        .or(`hasta.is.null,hasta.gte.${primerDia}`)
        .order("desde")
        .order("empleado_id")
        .range(a, b)
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const padron: PersonaDelTaller[] = (filasPadron ?? []).map((f) => ({
    empleadoId: f.empleado_id,
    oficio: f.oficio as Oficio,
    grupo: f.grupo as Grupo | null,
    desde: soloElDia(f.desde),
    hasta: f.hasta === null ? null : soloElDia(f.hasta),
  }));

  const nombres = new Map<string, string>();
  for (const f of filasPadron ?? []) {
    const e = Array.isArray(f.empleados) ? f.empleados[0] : f.empleados;
    nombres.set(f.empleado_id, e ? `${e.nombre} ${e.apellido}` : "(sin nombre)");
  }

  // ── La referencia: todas las filas, y la que rige cada semana la elige `laQueRige` ──
  let referencias: FilaDeReferencia[];
  try {
    const filasRef = await traerTodo<FilaDeReferencia>((a, b) =>
      db
        .from("mant_programacion_referencia")
        .select("lunes, grupo_en_4a12, electricista_4a12_id, electricista_8a16_id, electricista_12a20_id")
        .order("lunes")
        .range(a, b)
    );
    referencias = filasRef.map((f) => ({ ...f, lunes: soloElDia(f.lunes) }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const idsDelPadron = new Set(padron.map((p) => p.empleadoId));

  // ── Ausencias y francos. El `tipo` entra y no sale: ver el encabezado ──
  let ausencias: AusenciaCruda[];
  let francos: FrancoCrudo[];
  try {
    const todasAusencias = await traerTodo<AusenciaCruda>((a, b) =>
      db
        .from("ausencias")
        .select("empleado_id, fecha_desde, fecha_hasta, tipo")
        .lte("fecha_desde", ultimoDia)
        .gte("fecha_hasta", primerDia)
        .order("id")
        .range(a, b)
    );
    // Filtrar acá y no con `.in()`: una lista larga de ids arma una URL que
    // PostgREST rechaza con un 400 sin decir por qué.
    ausencias = todasAusencias
      .filter((a) => idsDelPadron.has(a.empleado_id))
      .map((a) => ({
        ...a,
        fecha_desde: soloElDia(a.fecha_desde),
        fecha_hasta: soloElDia(a.fecha_hasta),
      }));

    // Por `fecha_descanso` y nunca por `fecha_tomado`: el segundo es el día en
    // que alguien apretó el botón. Los francos viejos la tienen en null y no
    // abren hueco, que es la verdad.
    const todosFrancos = await traerTodo<FrancoCrudo>((a, b) =>
      db
        .from("francos")
        .select("empleado_id, estado, fecha_descanso")
        .eq("estado", "TOMADO")
        .gte("fecha_descanso", primerDia)
        .lte("fecha_descanso", ultimoDia)
        .order("id")
        .range(a, b)
    );
    francos = todosFrancos
      .filter((f) => idsDelPadron.has(f.empleado_id))
      .map((f) => ({ ...f, fecha_descanso: f.fecha_descanso ? soloElDia(f.fecha_descanso) : null }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // ── Las pisadas: un turno que alguien escribió a mano para un día ──
  let pisadas: { empleado_id: string; dia: string; turno: Turno }[];
  let catalogo: ReturnType<typeof resolverElCatalogo>;
  try {
    const filasPisadas = await traerTodo<{ empleado_id: string; dia: string; turno: string }>(
      (a, b) =>
        db
          .from("mant_programacion_pisadas")
          .select("empleado_id, dia, turno")
          .gte("dia", primerDia)
          .lte("dia", ultimoDia)
          .order("dia")
          .order("empleado_id")
          .range(a, b)
    );
    pisadas = filasPisadas.map((p) => ({
      empleado_id: p.empleado_id,
      dia: soloElDia(p.dia),
      turno: p.turno as Turno,
    }));

    // ── El catálogo de operarios, resuelto contra el padrón ──
    const filasCatalogo = await traerTodo<{ slot: number; nombre: string }>((a, b) =>
      db.from("operarios").select("slot, nombre").order("slot").order("nombre").range(a, b)
    );
    catalogo = resolverElCatalogo(filasCatalogo, padron, nombres);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // ── Una franja por semana ──
  const franjas: FranjaDeLaSemana[] = lunes.map((l) =>
    franjaDeLaSemana(
      l,
      padron,
      nombres,
      referencias,
      ausencias,
      francos,
      pisadas.map((p) => ({ empleado_id: p.empleado_id, dia: p.dia }))
    )
  );

  /*
   * Y el día por día, que es lo que mira el panel al asignar: quién no viene y
   * en qué turno está cada uno.
   *
   * La franja habla de la semana y esto habla del día, así que acá **sí** ganan
   * las pisadas (`turnoDelDia`). Una orden de arrastre se mira contra el día en
   * que se la está viendo, no contra su `fecha_ejecucion`.
   */
  const pisadaDe = new Map<string, Turno>();
  for (const p of pisadas) pisadaDe.set(`${p.empleado_id}|${p.dia}`, p.turno);

  const noVienen: Record<string, string[]> = {};
  const turnos: Record<string, Turno> = {};

  for (const l of lunes) {
    const fila = laQueRige(referencias, l);
    const ref = fila ? comoReferencia(fila) : null;
    for (const dia of semanaDe(l)) {
      if (dia < primerDia || dia > ultimoDia) continue;
      const faltan: string[] = [];
      const vistos = new Set<string>();
      for (const p of padron) {
        if (!estaVigente(p, dia)) continue;
        if (vistos.has(p.empleadoId)) continue;
        vistos.add(p.empleadoId);
        if (noViene(ausencias, francos, p.empleadoId, dia)) faltan.push(p.empleadoId);
        const clave = `${p.empleadoId}|${dia}`;
        const turno = turnoDelDia(
          ref ? turnoDeLaPersona(ref, l, p) : null,
          pisadaDe.get(clave) ?? null
        );
        if (turno) turnos[clave] = turno;
      }
      noVienen[dia] = faltan;
    }
  }

  return NextResponse.json({ franjas, catalogo, noVienen, turnos });
}
