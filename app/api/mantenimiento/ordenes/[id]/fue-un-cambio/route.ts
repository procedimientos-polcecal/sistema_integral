import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { traerTodo } from "@/lib/core/paginado";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { altaEnLaPlanilla } from "@/lib/mantenimiento/formulario";
import { loQueHayQueExportar } from "@/lib/mantenimiento/cierreDeOT";
import { celdasParaRegistrar } from "@/lib/mantenimiento/ordenes";
import { escribirEnLaFilaDeLaOT } from "@/lib/mantenimiento/planillaDeOT";
import { elPendienteDelIntento } from "@/lib/mantenimiento/pendienteDeLaOT";
import { celdaDeObservacionPrevia } from "@/lib/mantenimiento/notas";
import { ESTADO_CANCELADA } from "@/lib/mantenimiento/cancelacion";
import { borrarLosEventosDeLasOT } from "@/lib/agenda/elEventoSigueALaOT";
import {
  descripcionDelCambio, elMotivoDeLaRotacion, lasQueSalenDelCiclo,
  loQueImpideRegistrarElCambio,
  type CicloDelCambio, type RotacionAResolver,
} from "@/lib/mantenimiento/cambioFueraDeTurno";

type Params = { params: Promise<{ id: string }> };

/**
 * Lo mismo que declara `mantenimiento/ordenes`, que hace estrictamente menos:
 * un `altaEnLaPlanilla`. Ésta hace eso **más** dos `escribirEnLaFilaDeLaOT`
 * —cada uno relee la columna A entera del master para encontrar la fila— y un
 * borrado de calendario. Importa cuál es la ventana que un corte abre: entre
 * la fila ya escrita en la planilla y el `insert` en la base, que es el final
 * partido que deja una orden existiendo sólo en la planilla.
 */
export const maxDuration = 300;

/**
 * POST — esta OT no fue una rotación: fue un cambio.
 *
 * Un ciclo encadenado pide rotar los martillos. En la máquina se cambian
 * enteros, así que esa orden no se puede cerrar —cerrarla diría que se hizo
 * algo que no se hizo— y el ciclo la espera para siempre. Acá se registra el
 * trabajo que sí se hizo, se aparca el que no, y el ciclo vuelve a contar desde
 * la fecha del cambio.
 *
 * No es el caso raro: entre cambio y cambio de martillos, sobre 70 intervalos
 * en los cuatro equipos, 60 tuvieron menos de las 3 rotaciones esperadas
 * (26/11/2026).
 *
 * ── POR QUÉ EL ALTA VA PRIMERO ─────────────────────────────────────────────
 *
 * Porque los dos finales partidos no cuestan lo mismo:
 *
 *   · **Alta sí, cancelación no**: existe la orden del cambio —correcto, el
 *     trabajo se hizo— y la rotación queda abierta y en el ciclo. Queda una
 *     orden suelta que alguien cancela a mano. Recuperable y ruidoso.
 *   · **Cancelación sí, alta no**: la rotación queda cancelada citando una OT
 *     que no existe, del cambio no queda nada, y el ciclo —sin ninguna orden en
 *     rango— vuelve a crear la rotación 1 contada desde el corte **viejo**. Mal
 *     y en silencio.
 *
 * Y es además la regla de la casa: la planilla manda en Mantenimiento, una
 * orden existe cuando tiene su fila allá, y de esa misma lectura sale su número.
 *
 * Queda un final imperfecto aceptado, el mismo que ya acepta `generarEncadenadas`:
 * si el insert falla con la fila de la planilla ya escrita, la orden existe
 * donde manda y la trae la sincronización — pero sin `ciclo_id`, así que el
 * corte no se movería. Se informa con el número para poder arreglarlo a mano;
 * no se inventa un rollback de la planilla.
 *
 * ── EL MOTIVO ENTRA ANTES QUE EL ESTADO ────────────────────────────────────
 *
 * La misma regla del PATCH de órdenes y del botón de reinicio: si la nota no
 * entra, la rotación no se cancela. Acá importa el doble, porque una
 * `CANCELADA` sin motivo es lo que `laCancelacionNoTieneMotivo` informa como
 * divergencia del contraste: sonaría una alarma por una cancelación que el
 * sistema hizo bien.
 *
 * ── EL CICLO Y SUS TAREAS SE LEEN EN CONSULTAS SEPARADAS, NO CON UN EMBED ──
 *
 * **No es por la ambigüedad**: el repo embebe ese par por la columna
 * —`madre:tarea_madre_id(nombre, componente)`, como hacen la ficha del equipo
 * y la Configuración— y nombrar la columna ya elige el camino, así que no hay
 * `300 PGRST201` posible. Es por el test: `supabaseDeMentira` **no resuelve
 * embeds** —sólo el de `creado_por`—, y esta ruta tiene test de ruta
 * justamente porque lo que hay que probar acá es el orden de las escrituras.
 * Con un embed, esa lectura devolvería `null` en el test y el test estaría
 * probando otra cosa que la que corre en producción.
 *
 * Dos consultas sobre dos filas cuestan nada. El `GET` de `ciclos/[id]`, que
 * alimenta al modal, hace lo mismo y por la misma razón: dos lecturas gemelas
 * escritas igual se leen mejor que una de cada forma.
 *
 * ── Y POR QUÉ ESTA RUTA MUEVE EL CORTE ─────────────────────────────────────
 *
 * Está explicado entero en el encabezado de `lib/mantenimiento/cambioFueraDeTurno.ts`,
 * que es donde vive `lasQueSalenDelCiclo`. En una línea: la madre nace hoy con
 * un cierre en el pasado, y `laUltimaEnRango` recorta por `created_at_app`, así
 * que dejárselo a `elCorteQueSigue` hace que el ciclo recree la rotación recién
 * cancelada — en silencio.
 *
 * ── Y EL CALENDARIO, AL FINAL ──────────────────────────────────────────────
 *
 * `CANCELADA` **no borra ningún evento**: `laOTEstaCerrada` sólo hace que la
 * agenda deje de moverlo. Sin este paso, cada uso de este botón deja cinco
 * personas citadas a una rotación que no se va a hacer. Va último porque hablar
 * con Google es lo único acá que puede tardar o colgar la función, y para este
 * punto está todo guardado.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Registrar un cambio requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const admin = createAdminClient();
  const body = (await cuerpoJson(request)) ?? {};

  const { data: rotacion } = await admin
    .from("ordenes_trabajo")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!rotacion) {
    return NextResponse.json({ error: "No existe esa orden de trabajo" }, { status: 404 });
  }

  // El ciclo, si la orden dice tener uno. Cuando no lo dice, la validación de
  // abajo se encarga de explicarlo con sus palabras y no hace falta repetirlas.
  const { data: ciclo } = rotacion.ciclo_id
    ? await admin
        .from("mant_ciclos_de_ot")
        .select("id, repeticiones, desde, especialidad, tarea_madre_id, tarea_hija_id")
        .eq("id", rotacion.ciclo_id)
        .maybeSingle()
    : { data: null };

  if (rotacion.ciclo_id && !ciclo) {
    return NextResponse.json(
      {
        error:
          `La OT ${rotacion.ot_number ?? "—"} dice pertenecer a un ciclo que ya ` +
          "no está en la base. Avisá antes de tocar nada más.",
      },
      { status: 500 }
    );
  }

  const { data: tareas } = ciclo
    ? await admin
        .from("mant_tareas_preventivas")
        .select("id, nombre, componente")
        .in("id", [ciclo.tarea_madre_id, ciclo.tarea_hija_id])
    : { data: [] };

  const madre = (tareas ?? []).find((t) => t.id === ciclo?.tarea_madre_id);
  const hija = (tareas ?? []).find((t) => t.id === ciclo?.tarea_hija_id);

  // Los textos de relleno sólo se alcanzan cuando no hay ciclo, y en ese caso
  // la validación corta antes de usarlos.
  const elCiclo: CicloDelCambio = {
    repeticiones: Number(ciclo?.repeticiones ?? 0),
    desde: (ciclo?.desde as string | null) ?? null,
    tareaMadre: madre?.nombre ?? "el cambio",
    tareaHija: hija?.nombre ?? "la rotación",
    componente: hija?.componente ?? madre?.componente ?? "las piezas",
  };

  const laOrden = rotacion as unknown as RotacionAResolver;
  const problemas = loQueImpideRegistrarElCambio(laOrden, elCiclo, body, hoyEnArgentina());
  if (problemas.length > 0) {
    return NextResponse.json({ error: problemas.join(" ") }, { status: 400 });
  }

  const fecha = String(body.fecha).trim();
  const texto = (v: unknown) => {
    const s = String(v ?? "").trim();
    return s === "" ? null : s;
  };
  // Vacío es `null` y no 0: esta orden nace cerrada, así que las horas dicen
  // cuánto duró el trabajo. Un cero inventado alimentaría el costo por equipo.
  const horas =
    String(body.horas ?? "").trim() === "" ? null : Number(body.horas);

  const operarios = {
    operario_1: texto(body.operario_1),
    operario_2: texto(body.operario_2),
    operario_3: texto(body.operario_3),
  };

  const { data: quienLoRegistra } = await admin
    .from("usuarios")
    .select("email, nombre, apellido")
    .eq("id", user.id)
    .maybeSingle();

  // ── 1. La planilla, que es donde se reparte el número ─────────────────────
  const descripcion = descripcionDelCambio(elCiclo, laOrden);

  const alta = await altaEnLaPlanilla({
    creado: new Date(),
    email: quienLoRegistra?.email ?? null,
    nombre: quienLoRegistra?.nombre ?? null,
    apellido: quienLoRegistra?.apellido ?? null,
    sector: rotacion.sector_raw ?? null,
    equipo: rotacion.equipo_raw ?? null,
    especialidad: (ciclo?.especialidad as string | null) ?? null,
    tipo: "PROGRAMADO",
    quien: "INTERNO",
    descripcion,
    repuesto: null,
    // El trabajo se hizo ese día: la ejecución y el cierre son el mismo.
    fecha_ejecucion: fecha,
    fecha_fin: null,
    // Un preventivo no tiene urgencia de dónde sacarla.
    prioridad: null,
  });

  if (!alta.ok) {
    return NextResponse.json(
      { error: `No se pudo escribir la orden en la planilla: ${alta.error}` },
      { status: 500 }
    );
  }

  // ── 2. La base ────────────────────────────────────────────────────────────
  const ahora = new Date().toISOString();

  const { data: creada, error: errorAlta } = await admin
    .from("ordenes_trabajo")
    .insert({
      ot_number: alta.ot_number,
      fecha: hoyEnArgentina(),
      sector_id: rotacion.sector_id ?? null,
      sector_raw: rotacion.sector_raw ?? null,
      equipo_raw: rotacion.equipo_raw ?? null,
      equipo_code: rotacion.equipo_code ?? null,
      equipment_id: rotacion.equipment_id ?? null,
      especialidad: ciclo?.especialidad ?? null,
      tipo: "PROGRAMADO",
      quien: "INTERNO",
      descripcion,
      fecha_ejecucion: fecha,
      fecha_cierre: fecha,
      estado: "REALIZADO",
      horas,
      ...operarios,
      ciclo_id: ciclo?.id ?? null,
      ciclo_vuelta: 0,
      // Las tres que la protegen del borrado de espejo: nace acá y su fila del
      // master llega por `IMPORTRANGE` minutos después.
      app_created: true,
      created_at_app: ahora,
      synced_at: ahora,
    })
    .select("id")
    .single();

  if (errorAlta || !creada) {
    return NextResponse.json(
      {
        error:
          `La orden ${alta.ot_number} quedó escrita en la planilla pero no en el ` +
          `sistema (${errorAlta?.message ?? "sin detalle"}). La va a traer la ` +
          "sincronización, pero sin enlazarla al ciclo: avisá.",
      },
      { status: 500 }
    );
  }

  // ── 3. El motivo, antes que el estado ─────────────────────────────────────
  const motivo = elMotivoDeLaRotacion(elCiclo, fecha, alta.ot_number);

  const { error: errorNota } = await admin
    .from("ordenes_trabajo_notas")
    .insert({ orden_id: rotacion.id, texto: motivo, creado_por: user.id });

  if (errorNota) {
    return NextResponse.json(
      {
        error:
          `Quedó creada la OT ${alta.ot_number} con el cambio, pero la OT ` +
          `${rotacion.ot_number ?? "—"} no se canceló porque no se pudo guardar ` +
          `el motivo: ${errorNota.message}. Cancelala a mano.`,
      },
      { status: 500 }
    );
  }

  // ── 4. Y la rotación queda cancelada y fuera del ciclo ────────────────────
  const { error: errorRotacion } = await admin
    .from("ordenes_trabajo")
    .update({ estado: ESTADO_CANCELADA, ciclo_id: null, synced_at: ahora })
    .eq("id", rotacion.id);

  if (errorRotacion) {
    return NextResponse.json({ error: errorRotacion.message }, { status: 500 });
  }

  // ── 5. El corte del ciclo, y lo que el cambio dejó atrás ──────────────────
  //
  // Es el único paso que el encabezado argumenta como imprescindible, así que
  // es el último que puede fallar callado: con el corte sin mover y la rotación
  // ya cancelada, la corrida siguiente mueve el corte sola —la madre nueva sí
  // entra en rango, porque su cierre ya no empata con el corte viejo— y la de
  // después encuentra a una hija vieja como última, y crea la vuelta siguiente,
  // que es la rotación recién cancelada. Un 201 ahí sería el anti-objetivo en
  // silencio.
  if (ciclo) {
    const { error: errorCorte } = await admin
      .from("mant_ciclos_de_ot")
      .update({ desde: fecha, vuelta_desde: 0 })
      .eq("id", ciclo.id);

    if (errorCorte) {
      return NextResponse.json(
        {
          error:
            `Quedó creada la OT ${alta.ot_number} con el cambio y la OT ` +
            `${rotacion.ot_number ?? "—"} cancelada, pero el ciclo no se movió: ` +
            `${errorCorte.message}. Avisá antes de que el generador vuelva a ` +
            "correr, porque puede pedir una rotación sobre los martillos nuevos.",
        },
        { status: 500 }
      );
    }

    // `traerTodo` y no un `select` pelado: PostgREST corta en 1.000 sin avisar
    // y esto crece con cada vuelta —`generarEncadenadas` lee esta misma tabla
    // con este mismo filtro y ya pagina, «porque esto crece con cada vuelta»—.
    // Una lectura cortada deja adentro del ciclo hijas nacidas después del
    // cambio, que son justo las que hacen que la corrida siguiente cree la
    // vuelta siguiente ya atrasada. Y no es teórico acá: el 24/11/2026
    // Hidratación llegó a 427 órdenes en cuatro días.
    let delCiclo: { id: string; created_at_app: string | null }[];
    try {
      delCiclo = await traerTodo<{ id: string; created_at_app: string | null }>(
        (desde, hasta) =>
          admin
            .from("ordenes_trabajo")
            .select("id, created_at_app")
            .eq("ciclo_id", ciclo.id)
            .order("id")
            .range(desde, hasta)
      );
    } catch (e) {
      return NextResponse.json(
        {
          error:
            `Quedó todo registrado y el ciclo se movió al ${fecha}, pero no se ` +
            `pudieron leer sus órdenes para sacarlas: ${e instanceof Error ? e.message : String(e)}. ` +
            "Avisá: el generador puede pedir una rotación de más.",
        },
        { status: 500 }
      );
    }

    const salen = lasQueSalenDelCiclo(delCiclo, fecha, [rotacion.id, creada.id]);
    // De a 200: un `.in()` con muchos ids arma una URL que PostgREST rechaza,
    // y de a una serían cientos de viajes seguidos adentro de la función.
    for (let i = 0; i < salen.length; i += 200) {
      const { error: errorSuelta } = await admin
        .from("ordenes_trabajo")
        .update({ ciclo_id: null })
        .in("id", salen.slice(i, i + 200));

      if (errorSuelta) {
        return NextResponse.json(
          {
            error:
              `Quedó todo registrado y el ciclo se movió al ${fecha}, pero ` +
              `algunas órdenes no se pudieron sacar del ciclo: ${errorSuelta.message}. ` +
              "Avisá: el generador puede pedir una rotación de más.",
          },
          { status: 500 }
        );
      }
    }
  }

  // ── 6. Las dos filas de la planilla, cada una con su cola ─────────────────
  const laNueva = {
    estado: "REALIZADO", fecha_cierre: fecha, horas,
    contratista: null, ...operarios,
  };
  let planilla_error: string | null = null;

  const deLaNueva = loQueHayQueExportar(laNueva);
  if (deLaNueva) {
    planilla_error = await escribirEnLaFilaDeLaOT(
      { ot_number: alta.ot_number },
      celdasParaRegistrar(deLaNueva)
    );
    await admin
      .from("ordenes_trabajo")
      .update({
        sheets_pendiente: elPendienteDelIntento(laNueva, planilla_error),
        sheets_intentado_en: ahora,
      })
      .eq("id", creada.id);
  }

  const cancelada = { ...rotacion, estado: ESTADO_CANCELADA };
  const deLaRotacion = loQueHayQueExportar(cancelada);
  if (deLaRotacion) {
    const fallo = await escribirEnLaFilaDeLaOT(
      { ot_number: rotacion.ot_number },
      [...celdasParaRegistrar(deLaRotacion), celdaDeObservacionPrevia(motivo)]
    );
    planilla_error = planilla_error ?? fallo;
    await admin
      .from("ordenes_trabajo")
      .update({
        sheets_pendiente: elPendienteDelIntento(cancelada, fallo),
        sheets_intentado_en: ahora,
      })
      .eq("id", rotacion.id);
  }

  // ── 7. El evento de la rotación, que no se va solo ────────────────────────
  //
  // **Son dos borrados y hacen falta los dos.** `borrarLosEventosDeLasOT`
  // borra en Google y no toca la fila: su único llamador anterior era el
  // borrado de espejo, donde la fila se va sola por el cascade de
  // `ordenes_trabajo`. Acá la OT se **cancela**, así que la fila sobrevive —y
  // con eso alcanza para que `revisarLaCasilla` la traiga (tiene
  // `google_event_id`, tiene `inicio_escrito`, no está divergida y su `fin` no
  // pasó), lea de Google el evento cancelado, `queDivergio` conteste
  // **«borrado»** y salga un push diciendo que alguien borró el evento, a las
  // mismas cinco personas que estaban invitadas—. Y peor: «reescribir» lo
  // **resucita** con un `PUT status: confirmed` en los cinco calendarios,
  // deshaciendo este paso entero.
  //
  // Si Google no pudo, la fila **se queda**: es lo único que sabe dónde está el
  // evento vivo, y `borrarLosEventosDeLasOT` ya le dejó el aviso escrito. Es la
  // misma decisión, con el mismo argumento, que el DELETE de
  // `agenda/eventos/[id]`.
  const noSePudoBorrar = await borrarLosEventosDeLasOT(admin, [rotacion.id]);
  const calendario_error = noSePudoBorrar.get(rotacion.id) ?? null;

  if (!calendario_error) {
    const { error: errorFila } = await admin
      .from("agenda_eventos")
      .delete()
      .eq("ot_id", rotacion.id);

    // No voltea nada: el evento ya no está en ningún calendario, que es lo que
    // importaba. Lo que queda es una fila que la Agenda sigue dibujando y que
    // el barrido va a marcar como divergida; se dice para que alguien la saque.
    if (errorFila) {
      return NextResponse.json(
        {
          data: { ot_number: alta.ot_number, cancelada: rotacion.ot_number ?? null },
          planilla_error,
          calendario_error:
            `El evento se borró de los calendarios, pero su fila quedó en la ` +
            `Agenda del SdG: ${errorFila.message}. Borrala desde /agenda, o el ` +
            "barrido va a avisar que alguien lo borró en Google.",
        },
        { status: 201 }
      );
    }
  }

  return NextResponse.json(
    {
      data: { ot_number: alta.ot_number, cancelada: rotacion.ot_number ?? null },
      planilla_error,
      calendario_error,
    },
    { status: 201 }
  );
}
