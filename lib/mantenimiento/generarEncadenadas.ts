/**
 * Las OT de los ciclos encadenados, creadas solas.
 *
 * Una madre que se cierra genera una hija, la hija que se cierra genera la
 * siguiente, y después de la última vuelve la madre. La decisión de **qué** y
 * **cuándo** es pura y vive en `cicloDeOT.ts`, con sus tests; esto es lo que
 * habla con la base y con Google.
 *
 * ── POR QUÉ ESTO ES UNA RECONCILIACIÓN Y NO UN ENGANCHE AL CIERRE ──────────
 *
 * Lo natural sería colgarlo del botón de cerrar una OT. No sirve: **las OT se
 * cierran en la planilla**. De las 248 órdenes de martillos medidas el
 * 12/11/2026 en los cuatro equipos del ciclo, **225 ni siquiera nacieron en el
 * sistema** (`app_created = false`): entraron por el formulario y se cierran
 * escribiendo la columna ESTADO del master. Un enganche en la ruta PATCH vería
 * una minoría de los cierres.
 *
 * Así que esto corre después de cada sincronización y mira el estado del mundo:
 * qué ciclos tienen su OT cerrada y todavía no tienen la siguiente. Es la misma
 * forma que `generarLasPeriodicas` y es la única que ve los cierres que entran
 * por la planilla.
 *
 * ── LA IDEMPOTENCIA LA DA EL DATO ──────────────────────────────────────────
 *
 * El cron **no es diario**: `vercel.json` lo agenda 06:00 UTC pero el reloj
 * real es Actions, que declara cada 15 minutos y corre cada 3 a 5 horas. Esto
 * puede correr diez veces por día.
 *
 * Lo que lo hace idempotente es que el estado se deriva de las OT mismas: si la
 * última del ciclo está abierta no se hace nada, y la primera corrida deja una
 * abierta que la segunda ve. No hay un puntero que pueda desincronizarse.
 *
 * ── EL ORDEN DE LOS PASOS NO ES COSMÉTICO ──────────────────────────────────
 *
 * Primero la planilla, después el insert, después la columna M, y el calendario
 * al final. Una orden existe cuando tiene su fila allá; si `altaEnLaPlanilla`
 * falla, no se creó nada en ningún lado y no se consumió ningún número.
 *
 * Y la columna M hay que escribirla aparte **y encolarla si falla**, que es el
 * mismo agujero que tuvieron el PATCH el 26/10 y las periódicas el 30/10:
 * `altaEnLaPlanilla` escribe la fila del libro de respuestas, que derrama a las
 * columnas A..J, pero la M vive sólo en el master. Acá falla casi siempre,
 * porque esa fila llega por `IMPORTRANGE` segundos después de crear. La marca
 * `sheets_pendiente` es lo único que encola el reintento **y** lo que evita que
 * la importación siguiente pise el estado con la celda vacía.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { alNacerLaOT } from "@/lib/agenda/alNacerLaOT";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { altaEnLaPlanilla } from "@/lib/mantenimiento/formulario";
import { estadoSegunElCierre, loQueHayQueExportar } from "@/lib/mantenimiento/cierreDeOT";
import { celdasParaRegistrar } from "@/lib/mantenimiento/ordenes";
import { escribirEnLaFilaDeLaOT } from "@/lib/mantenimiento/planillaDeOT";
import { elPendienteDelIntento } from "@/lib/mantenimiento/pendienteDeLaOT";
import { traerTodo } from "@/lib/core/paginado";
import {
  queSigueEnElCiclo, elCorteQueSigue, descripcionDeLaOT,
  type CicloParaDecidir, type OTDelCiclo,
} from "./cicloDeOT";

export interface ResultadoDeEncadenadas {
  generadas: { ot_number: number; ciclo_id: string; vuelta: number }[];
  /** Los que esperan que una persona cargue su punto de arranque. */
  sinArrancar: string[];
  /** Los que no pueden avanzar, con el motivo en castellano. */
  trabados: { ciclo_id: string; porque: string }[];
  /** Lo que dijo el otro lado, sin traducir. */
  fallaron: { ciclo_id: string; error: string }[];
  /** Las creadas cuyo ESTADO todavía no llegó al master. No es un error. */
  sinEstadoTodavia: number[];
  sinCalendario: { ot_number: number; aviso: string }[];
}

/** Lo que hace falta para decidir y para armar la orden. */
const COLUMNAS =
  "id, equipment_id, repeticiones, especialidad, horas_estimadas, desde, vuelta_desde, " +
  "equipos:equipment_id(code, name, is_active, sector_id, sectores:sector_id(nombre)), " +
  "madre:tarea_madre_id(nombre, componente), " +
  "hija:tarea_hija_id(nombre, componente, periodo_dias)";

type TareaDelCiclo = { nombre: string; componente: string; periodo_dias?: number | null };

type CicloLeido = {
  id: string;
  equipment_id: string;
  repeticiones: number;
  especialidad: string | null;
  horas_estimadas: number | null;
  desde: string | null;
  vuelta_desde: number | null;
  equipos: {
    code: string | null; name: string | null; is_active: boolean | null;
    sector_id: string | null; sectores: { nombre: string | null } | null;
  } | null;
  madre: TareaDelCiclo | null;
  hija: TareaDelCiclo | null;
};

/**
 * Crea las OT que toquen. **No tira**: devuelve qué pasó con cada ciclo, y uno
 * trabado no frena al siguiente.
 */
export async function generarLasEncadenadas(
  admin = createAdminClient(),
  hoy = hoyEnArgentina()
): Promise<ResultadoDeEncadenadas> {
  const r: ResultadoDeEncadenadas = {
    generadas: [], sinArrancar: [], trabados: [], fallaron: [],
    sinEstadoTodavia: [], sinCalendario: [],
  };

  const { data } = await admin
    .from("mant_ciclos_de_ot")
    .select(COLUMNAS)
    .eq("activo", true);

  const ciclos = (data ?? []) as unknown as CicloLeido[];
  if (ciclos.length === 0) return r;

  // Las OT de todos los ciclos de una vez. `traerTodo` porque esto crece con
  // cada vuelta y PostgREST corta en 1000 sin avisar.
  const todasLasOT = await traerTodo<OTDelCiclo & { ciclo_id: string }>((desde, hasta) =>
    admin
      .from("ordenes_trabajo")
      .select("ot_number, ciclo_id, ciclo_vuelta, estado, fecha_cierre, fecha_ejecucion, created_at_app")
      .not("ciclo_id", "is", null)
      .range(desde, hasta)
  );

  for (const ciclo of ciclos) {
    const eq = ciclo.equipos;

    // Un equipo dado de baja no recibe órdenes nuevas. Se dice, en vez de
    // seguir creando trabajo para una máquina que ya no está.
    if (eq?.is_active === false) {
      r.trabados.push({
        ciclo_id: ciclo.id,
        porque: `El equipo ${eq.code ?? ""} está inactivo, así que el ciclo no genera órdenes.`,
      });
      continue;
    }

    if (!ciclo.madre || !ciclo.hija) {
      r.trabados.push({
        ciclo_id: ciclo.id,
        porque: "Al ciclo le falta la tarea madre o la hija en el catálogo de tareas preventivas.",
      });
      continue;
    }

    const paraDecidir: CicloParaDecidir = {
      id: ciclo.id,
      repeticiones: ciclo.repeticiones,
      periodo_dias: ciclo.hija.periodo_dias ?? null,
      desde: ciclo.desde,
      vuelta_desde: ciclo.vuelta_desde,
    };
    const mias = todasLasOT.filter((o) => o.ciclo_id === ciclo.id);

    // ── Primero el corte, y después la decisión ───────────────────────────
    //
    // En este orden a propósito: la madre que acaba de cerrarse mueve el corte
    // en esta misma corrida, y así la hija 1 nace sin esperar a la siguiente.
    const corte = elCorteQueSigue(paraDecidir, mias);
    if (corte) {
      const { error } = await admin
        .from("mant_ciclos_de_ot")
        .update({ desde: corte.desde, vuelta_desde: corte.vuelta_desde })
        .eq("id", ciclo.id);
      if (error) {
        r.fallaron.push({ ciclo_id: ciclo.id, error: error.message });
        continue;
      }
      paraDecidir.desde = corte.desde;
      paraDecidir.vuelta_desde = corte.vuelta_desde;
    }

    const decision = queSigueEnElCiclo(paraDecidir, mias);

    if (decision.que === "sin_arrancar") { r.sinArrancar.push(ciclo.id); continue; }
    if (decision.que === "trabado") { r.trabados.push({ ciclo_id: ciclo.id, porque: decision.porque }); continue; }
    if (decision.que === "esperar") continue;

    const esLaMadre = decision.vuelta === 0;
    const tarea = esLaMadre ? ciclo.madre : ciclo.hija;
    const descripcion = descripcionDeLaOT({
      tarea: tarea.nombre,
      componente: tarea.componente,
      vuelta: decision.vuelta,
      repeticiones: ciclo.repeticiones,
      // Lo que el sistema cree, escrito en la orden para que se pueda
      // desmentir. Cuando la próxima es la madre, el corte es la fecha de la
      // última rotación y no la del cambio, así que no se nombra.
      ultimoCambio: esLaMadre ? null : (paraDecidir.vuelta_desde === 0 ? paraDecidir.desde : null),
    });

    const equipoRaw = eq ? `${eq.code ?? ""} — ${eq.name ?? ""}`.trim() : null;
    const horas = ciclo.horas_estimadas === null || ciclo.horas_estimadas === undefined
      ? null : Number(ciclo.horas_estimadas);

    // ── 1. La planilla, que es donde se reparte el número ─────────────────
    const alta = await altaEnLaPlanilla({
      creado: new Date(),
      // Lo crea el sistema y la planilla lo dice: poner ahí a alguien que no
      // pidió nada sería peor que decir la verdad.
      email: null, nombre: "SdG", apellido: "(automático)",
      sector: eq?.sectores?.nombre ?? null,
      equipo: equipoRaw,
      especialidad: ciclo.especialidad,
      tipo: "PROGRAMADO",
      quien: "INTERNO",
      descripcion,
      repuesto: null,
      fecha_ejecucion: decision.fecha_ejecucion,
      // El ciclo sabe cuándo arranca, no cuánto dura.
      fecha_fin: null,
      // Un preventivo no tiene urgencia de dónde sacarla, y ponerle una sería
      // inventar el dato del que sale el orden del tablero.
      prioridad: null,
    });

    if (!alta.ok) { r.fallaron.push({ ciclo_id: ciclo.id, error: alta.error }); continue; }

    // ── 2. La base ────────────────────────────────────────────────────────
    const { data: creada, error } = await admin.from("ordenes_trabajo").insert({
      ot_number: alta.ot_number,
      fecha: hoy,
      sector_id: eq?.sector_id ?? null,
      sector_raw: eq?.sectores?.nombre ?? null,
      equipo_raw: equipoRaw,
      equipo_code: eq?.code ?? null,
      equipment_id: ciclo.equipment_id,
      especialidad: ciclo.especialidad,
      tipo: "PROGRAMADO",
      quien: "INTERNO",
      descripcion,
      fecha_ejecucion: decision.fecha_ejecucion,
      estado: estadoSegunElCierre(null, "POR_HACER"),
      horas,
      ciclo_id: ciclo.id,
      ciclo_vuelta: decision.vuelta,
      // Las tres que la protegen del borrado de espejo: esta OT nace en el SdG
      // y su fila del master llega por `IMPORTRANGE` horas después, así que
      // hasta entonces la planilla "no la trae".
      app_created: true,
      created_at_app: new Date().toISOString(),
      synced_at: new Date().toISOString(),
    }).select("id").single();

    if (error) {
      // La fila de la planilla ya está escrita y el número repartido, así que
      // la orden existe donde manda. Se informa y la trae la sincronización.
      r.fallaron.push({ ciclo_id: ciclo.id, error: error.message });
      continue;
    }

    r.generadas.push({ ot_number: alta.ot_number, ciclo_id: ciclo.id, vuelta: decision.vuelta });

    // ── 3. La columna del ESTADO, que vive sólo en el master ──────────────
    const paraLaPlanilla = loQueHayQueExportar({
      estado: "POR_HACER", fecha_cierre: null, horas,
      contratista: null, operario_1: null, operario_2: null, operario_3: null,
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

    // ── 4. El calendario, al final ────────────────────────────────────────
    //
    // Hablar con Google es lo único de acá que puede tardar o colgar la
    // función, y la orden ya está guardada: acá sólo se espeja. `alNacerLaOT`
    // no lanza — la frase se junta en el informe y no frena a los demás.
    if (creada) {
      const sinCalendario = await alNacerLaOT(admin, creada.id);
      if (sinCalendario) r.sinCalendario.push({ ot_number: alta.ot_number, aviso: sinCalendario });
    }
  }

  return r;
}
