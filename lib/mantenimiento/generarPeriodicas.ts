/**
 * Las OT de los mantenimientos periódicos, creadas solas.
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 *
 * El preventivo tiene pantalla y tiene un botón que genera la orden, y **nadie
 * lo apretó nunca**. Medido el 29/10/2026: 1 mantenimiento programado, vencido
 * desde el 8/8/2026, y **cero OT nacidas de un programado en toda la
 * historia**. Lo que depende de que una persona se acuerde, no pasa.
 *
 * ── LO QUE NO SE DUPLICA, Y POR QUÉ ESTO NO ES EL POST DE NUEVO ─────────────
 *
 * El alta de la ruta son 470 líneas, y la mitad de lo que hace un cron no lo
 * tiene ni lo quiere: la clave de la carga sin señal, el correo de
 * `avisarDeLaCarga`, la validación de GUT y de la falla, los renglones de
 * repuestos, el `after()` que reintenta cuatro minutos. Lo que sí hay que
 * compartir son las **reglas**, y las cinco ya viven en `lib/`:
 *
 *   `loQueFaltaParaCrear`  — qué no puede faltar para que exista una orden
 *   `altaEnLaPlanilla`     — reparte el número y escribe la fila
 *   `estadoSegunElCierre`  — con qué estado nace
 *   `celdasParaRegistrar`  — qué va de la K en adelante
 *   `elPendienteDelIntento`— qué se encola si la planilla no contestó
 *
 * Esto las compone. Extraer además el `record` del insert habría sido una
 * función de veinte parámetros que no decide nada, tocando el camino de
 * escritura más importante del módulo para ganar un objeto literal.
 *
 * ── Y POR QUÉ PUEDE CORRER DIEZ VECES POR DÍA ──────────────────────────────
 *
 * El cron de Mantenimiento **no es diario**: `vercel.json` lo agenda 06:00 UTC
 * pero el reloj real es Actions, que declara cada 15 minutos y corre cada 3 a
 * 5 horas. Así que la idempotencia no la puede dar el reloj: la da el dato.
 * Sólo se miran programados **cuya fecha ya llegó**, y lo primero que se hace
 * después de crear es correrla. No alcanza con «ya hay una OT abierta de este
 * programado»: eso deja de proteger apenas alguien la cierra, y entonces la
 * corrida siguiente genera la del ciclo que viene antes de tiempo.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { altaEnLaPlanilla } from "@/lib/mantenimiento/formulario";
import { estadoSegunElCierre, loQueHayQueExportar } from "@/lib/mantenimiento/cierreDeOT";
import { celdasParaRegistrar } from "@/lib/mantenimiento/ordenes";
import { escribirEnLaFilaDeLaOT } from "@/lib/mantenimiento/planillaDeOT";
import { elPendienteDelIntento } from "@/lib/mantenimiento/pendienteDeLaOT";
import { leToca, proximaFecha } from "@/lib/mantenimiento/vencimiento";
import {
  cuerpoDeLaOT, respuestasIniciales, loQueFaltaParaGenerar, especialidadDelProgramado,
  type MantenimientoParaLaOT,
} from "@/lib/mantenimiento/otDesdeMantenimiento";

/** Un programado con lo que hace falta para decidir si le toca. */
export type Programado = MantenimientoParaLaOT & {
  status: string;
  schedule_type: string;
  interval_days: number | null;
};

export interface Incompleto {
  id: string;
  falta: string[];
}

export interface QueGenerar {
  generar: Programado[];
  incompletos: Incompleto[];
}

/**
 * Cuáles toca generar hoy, y cuáles tocarían pero no se puede.
 *
 * Los dos grupos salen juntos a propósito. Un programado vencido al que le
 * falta la especialidad **no se saltea en silencio**: se informa, porque lo
 * que no se ve es lo que se queda tres meses vencido sin que nadie lo note —
 * que es exactamente de dónde salió todo esto.
 *
 * Un incompleto que todavía no vence no se informa: no es un problema de hoy.
 */
export function queGenerar(programados: readonly Programado[], hoy: string): QueGenerar {
  const generar: Programado[] = [];
  const incompletos: Incompleto[] = [];

  for (const p of programados) {
    if (p.status !== "active") continue;
    if (!leToca(p, hoy)) continue;

    const falta = loQueFaltaParaGenerar(p);
    if (falta.length > 0) incompletos.push({ id: p.id, falta });
    else generar.push(p);
  }

  return { generar, incompletos };
}

export interface ResultadoDeGenerar {
  generadas: { ot_number: number; schedule_id: string }[];
  incompletos: Incompleto[];
  /** Los que no se pudieron crear, con lo que dijo el otro lado sin traducir. */
  fallaron: { schedule_id: string; error: string }[];
  /** Los que dejaron de repetirse: una fecha fija, o un personalizado sin intervalo. */
  cerrados: string[];
  /**
   * Las que se crearon pero cuyo ESTADO todavía no llegó al master, porque su
   * fila viene por `IMPORTRANGE`. No es un error: quedan encoladas y las
   * termina `exportarLoPendiente` en la corrida siguiente.
   */
  sinEstadoTodavia: number[];
}

/** Las columnas que hacen falta para decidir y para armar la orden. */
const COLUMNAS =
  "id, equipment_id, maintenance_type, description, next_date, estimated_hours, " +
  "status, schedule_type, interval_days, especialidad, " +
  "equipos:equipment_id(code, name, sector_id, sectores:sector_id(nombre)), " +
  "assigned_user:assigned_to(nombre, apellido)";

/**
 * Crea las OT que toquen. No tira: devuelve qué pasó con cada una.
 *
 * El orden importa y es el mismo que el de la ruta: **primero la planilla y
 * después la base**. Una orden existe cuando tiene su fila allá; si esto falla,
 * no se creó nada en ningún lado y no se consumió ningún número.
 *
 * Y la fecha del programado **se corre sólo si la orden se creó**. Moverla sin
 * haber creado nada es perder el ciclo en silencio, que es la forma más cara de
 * fallar que tiene esto.
 */
export async function generarLasPeriodicas(
  admin = createAdminClient(),
  hoy = hoyEnArgentina()
): Promise<ResultadoDeGenerar> {
  const r: ResultadoDeGenerar = {
    generadas: [], incompletos: [], fallaron: [], cerrados: [], sinEstadoTodavia: [],
  };

  const { data } = await admin
    .from("mantenimientos_programados")
    .select(COLUMNAS)
    .eq("status", "active");

  const { generar, incompletos } = queGenerar((data ?? []) as unknown as Programado[], hoy);
  r.incompletos = incompletos;

  for (const p of generar) {
    // Las mismas respuestas que trae el formulario, con la especialidad que
    // este programado resuelva —la suya o la de su tipo— y su fecha vencida,
    // que es la que corresponde: la OT se pide para cuando tenía que hacerse.
    const respuestas = {
      ...respuestasIniciales(p),
      especialidad: especialidadDelProgramado(p),
    };
    const cuerpo = cuerpoDeLaOT(p, respuestas) as Record<string, string | null>;

    const alta = await altaEnLaPlanilla({
      creado: new Date(),
      // Lo crea el sistema y la planilla lo dice. Esas tres columnas existen
      // desde el 18/10/2026 para que quien mire sepa a quién preguntarle, y
      // poner ahí a alguien que no pidió nada sería peor que decir la verdad.
      email: null, nombre: "SdG", apellido: "(automático)",
      sector: cuerpo.sector_raw ?? null,
      equipo: cuerpo.equipo_raw ?? null,
      especialidad: respuestas.especialidad || null,
      tipo: cuerpo.tipo ?? null,
      quien: respuestas.quien || null,
      descripcion: String(cuerpo.descripcion ?? "").trim(),
      repuesto: null,
      fecha_ejecucion: respuestas.fecha_ejecucion || null,
      // Un preventivo no tiene urgencia de donde sacarla, y ponerle una sería
      // inventar el dato del que sale el orden del tablero.
      prioridad: null,
    });

    if (!alta.ok) {
      r.fallaron.push({ schedule_id: p.id, error: alta.error });
      continue;
    }

    const { error } = await admin.from("ordenes_trabajo").insert({
      ot_number: alta.ot_number,
      fecha: hoy,
      sector_id: cuerpo.sector_id ?? null,
      sector_raw: cuerpo.sector_raw ?? null,
      equipo_raw: cuerpo.equipo_raw ?? null,
      equipo_code: cuerpo.equipo_code ?? null,
      equipment_id: p.equipment_id,
      especialidad: respuestas.especialidad,
      tipo: "PROGRAMADO",
      quien: respuestas.quien,
      descripcion: String(cuerpo.descripcion ?? "").trim(),
      fecha_ejecucion: respuestas.fecha_ejecucion || null,
      estado: estadoSegunElCierre(null, "POR_HACER"),
      horas: p.estimated_hours === null || p.estimated_hours === undefined
        ? null : Number(p.estimated_hours),
      operario_1: String(cuerpo.operario_1 ?? "").trim() || null,
      schedule_id: p.id,
      // Las tres que la protegen del borrado de espejo, y hay que saber por
      // qué van: esta OT nace en el SdG y su fila del master llega por
      // `IMPORTRANGE` horas después, así que hasta entonces la planilla "no la
      // trae". `app_created` con `sheets_row` en null es lo que
      // `nuncaEstuvoEnLaPlanilla` mira para protegerla, y `created_at_app` es
      // la segunda red: una fila que apareció después de que leyéramos la
      // planilla tampoco se borra. Sin esto, la corrida siguiente se la lleva
      // en cascada con sus notas y sus repuestos.
      app_created: true,
      created_at_app: new Date().toISOString(),
      synced_at: new Date().toISOString(),
    });

    if (error) {
      // La fila de la planilla ya está escrita y el número repartido, así que
      // la orden existe donde manda. Se informa y la trae la sincronización.
      r.fallaron.push({ schedule_id: p.id, error: error.message });
      continue;
    }

    r.generadas.push({ ot_number: alta.ot_number, schedule_id: p.id });

    // ── Y LA COLUMNA DEL ESTADO, QUE ESTO NO ESCRIBÍA ─────────────────────
    //
    // Faltaba, y lo encontró el detector de divergencias a las horas: la OT
    // 2935 —la primera que generó esto, el 30/10/2026— nació con su celda de
    // ESTADO vacía en el master. Es **el mismo agujero que el PATCH tenía el
    // 26/10**, repetido acá: `altaEnLaPlanilla` escribe la fila del libro de
    // respuestas, que derrama a las columnas A..J, pero la M vive sólo en el
    // master y hay que escribirla aparte.
    //
    // Y no alcanza con intentarlo: si falla —y acá **falla casi siempre**,
    // porque la fila del master llega por `IMPORTRANGE` segundos después de
    // crear— hay que anotar el pendiente. Esa marca es lo único que encola el
    // reintento **y** lo que evita que la importación siguiente pise el
    // estado con la celda vacía.
    //
    // Sin `after()`, a diferencia de la ruta: un cron no le está contestando a
    // nadie que espere, y `exportarLoPendiente` corre al principio de la
    // sincronización siguiente, que es dentro de 3 a 5 horas. Insistir cuatro
    // minutos acá sólo alargaría la corrida.
    const paraLaPlanilla = loQueHayQueExportar({
      estado: "POR_HACER",
      fecha_cierre: null,
      horas: p.estimated_hours === null || p.estimated_hours === undefined
        ? null : Number(p.estimated_hours),
      contratista: null,
      operario_1: String(cuerpo.operario_1 ?? "").trim() || null,
      operario_2: null,
      operario_3: null,
    });

    if (paraLaPlanilla) {
      const orden = { id: "", ot_number: alta.ot_number };
      const falloLaM = await escribirEnLaFilaDeLaOT(orden, celdasParaRegistrar(paraLaPlanilla));
      const pendiente = elPendienteDelIntento(
        { estado: "POR_HACER", fecha_cierre: null, horas: null,
          contratista: null, operario_1: null, operario_2: null, operario_3: null },
        falloLaM
      );
      await admin
        .from("ordenes_trabajo")
        .update({ sheets_pendiente: pendiente, sheets_intentado_en: new Date().toISOString() })
        .eq("ot_number", alta.ot_number);
      if (falloLaM) r.sinEstadoTodavia.push(alta.ot_number);
    }

    // Recién ahora se corre la fecha. `proximaFecha` saltea los ciclos
    // perdidos: de un mensual vencido hace tres meses sale UNA orden y la
    // fecha queda en el futuro, no tres órdenes.
    const proxima = proximaFecha(p, hoy);
    if (proxima) {
      await admin.from("mantenimientos_programados")
        .update({ next_date: proxima, last_executed_at: new Date().toISOString() })
        .eq("id", p.id);
    } else {
      // Una fecha fija no se repite, y un personalizado sin intervalo no dice
      // cada cuánto. Se cierra, en vez de quedar generando para siempre.
      await admin.from("mantenimientos_programados")
        .update({ status: "completed", last_executed_at: new Date().toISOString() })
        .eq("id", p.id);
      r.cerrados.push(p.id);
    }
  }

  return r;
}
