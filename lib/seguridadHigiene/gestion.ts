import { clasificar, type Clasificacion, type Criterio } from "./riesgo";
import {
  estadoDe,
  loQueFalta,
  type CondicionParaFaltantes,
  type Estado,
  type Falta,
} from "./condicion";

/**
 * La pantalla de gestión de condiciones inseguras, sin pantalla: qué se ve
 * primero, qué filtros hay y qué se manda al guardar.
 *
 * **El anti-objetivo del módulo es éste y vive acá**: lo que falta tiene que
 * verse antes que lo que está completo. La planilla de la que sale tenía 44
 * condiciones y 35 sin evaluar porque nada las mostraba. Por eso el orden no
 * es una preferencia de la pantalla sino una función con test.
 */

export interface FilaDeCondicion {
  id: string;
  numero: number;
  sector_id: string | null;
  equipo_id: string | null;
  detectada_el: string;
  detectada_por: string | null;
  descripcion: string;
  peligro_id: string | null;
  accion_propuesta: string | null;
  prioridad: number | null;
  responsable_id: string | null;
  fecha_maxima: string | null;
  fecha_ejecucion: string | null;
  requiere_inversion: boolean | null;
  observaciones: string | null;
  frecuencia: number | null;
  antecedentes: number | null;
  controles: number | null;
  magnitud_dano: number | null;
  legislacion: number | null;
  probabilidad: number | null;
  gravedad: number | null;
  nivel_riesgo: number | null;
  sectores: { nombre: string } | null;
  equipos: { name: string; code: string | null } | null;
  syh_peligros: { nombre: string } | null;
}

export const NOMBRE_DE_FALTA: Record<Falta, string> = {
  sin_evaluar: "Sin evaluar",
  sin_asignar: "Sin asignar",
  sin_lugar: "Sin lugar",
};

export const NOMBRE_DE_CLASIFICACION: Record<Clasificacion, string> = {
  I: "Intolerable",
  S: "Significativo",
  M: "Moderado",
  PS: "Poco significativo",
  NS: "No significativo",
};

/**
 * El nivel de riesgo, **para mostrarlo mientras se elige** y antes de guardar.
 *
 * Repite la cuenta de las columnas generadas de la tabla (probabilidad =
 * frecuencia + antecedentes + controles; gravedad = magnitud + legislación;
 * nivel = probabilidad × gravedad). La verdad es la de la base: una vez
 * guardada la condición, la pantalla muestra `nivel_riesgo` de la fila y no esta
 * cuenta. Con un puntaje que falta no hay nivel, igual que en la tabla: cuatro
 * de cinco es lo mismo que ninguno.
 */
export function nivelDeRiesgo(
  p: Record<Criterio, number | null>
): { probabilidad: number; gravedad: number; nivel: number } | null {
  const { frecuencia, antecedentes, controles, magnitud_dano, legislacion } = p;
  if (
    frecuencia === null || antecedentes === null || controles === null ||
    magnitud_dano === null || legislacion === null
  ) {
    return null;
  }
  const probabilidad = frecuencia + antecedentes + controles;
  const gravedad = magnitud_dano + legislacion;
  return { probabilidad, gravedad, nivel: probabilidad * gravedad };
}

/**
 * En qué tramo del orden cae una condición. Menor se ve antes.
 *
 *   0  vencida
 *   1  abierta y le falta algo (evaluar, asignar o el lugar)
 *   2  abierta y completa
 *   3  cerrada
 *
 * La spec dice «vencidas, después las que les falta algo, después el resto por
 * nivel». Se afinó en un punto: **las cerradas van al final aunque sean de
 * riesgo alto**. Con «el resto por nivel» a secas, una cerrada intolerable
 * quedaría arriba de una abierta moderada, y lo que hay para hacer se hundiría
 * debajo de lo que ya se hizo. Una cerrada con faltas tampoco sube al tramo 1:
 * no hay a quién ir a pedirle que la complete.
 */
export function tramoDeGestion(c: FilaDeCondicion, hoy: string): 0 | 1 | 2 | 3 {
  const estado = estadoDe(c, hoy);
  if (estado === "Vencida") return 0;
  if (estado === "Cerrada") return 3;
  return loQueFalta(c).length > 0 ? 1 : 2;
}

/** Un nivel que falta se ordena como el más bajo: no hay riesgo medido que subirla. */
function nivelParaOrdenar(c: FilaDeCondicion): number {
  return c.nivel_riesgo ?? -1;
}

/**
 * El orden por defecto de la tabla. No modifica la lista que recibe.
 *
 * Dentro de cada tramo: las vencidas, la que venció hace más; las que les falta
 * algo, la que más le falta; y en todos, el mayor nivel antes y la más nueva
 * antes en el empate.
 */
export function ordenarParaGestion(filas: FilaDeCondicion[], hoy: string): FilaDeCondicion[] {
  const tramos = new Map(filas.map((c) => [c.id, tramoDeGestion(c, hoy)]));

  return [...filas].sort((a, b) => {
    const ta = tramos.get(a.id)!;
    const tb = tramos.get(b.id)!;
    if (ta !== tb) return ta - tb;

    if (ta === 0) {
      // Las dos tienen fecha máxima: una vencida la tiene por definición.
      const porFecha = (a.fecha_maxima ?? "").localeCompare(b.fecha_maxima ?? "");
      if (porFecha !== 0) return porFecha;
    }
    if (ta === 1) {
      const porFaltas = loQueFalta(b).length - loQueFalta(a).length;
      if (porFaltas !== 0) return porFaltas;
    }

    const porNivel = nivelParaOrdenar(b) - nivelParaOrdenar(a);
    if (porNivel !== 0) return porNivel;
    return b.numero - a.numero;
  });
}

export interface FiltrosDeGestion {
  estado: Estado | "";
  /** «alguna» es cualquiera de las tres. */
  falta: Falta | "alguna" | "";
  /** `s:<id>` un sector (con sus equipos) o `e:<id>` un equipo. Vacío es todos. */
  lugar: string;
  clasificacion: Clasificacion | "sin_clasificar" | "";
}

export const SIN_FILTROS: FiltrosDeGestion = { estado: "", falta: "", lugar: "", clasificacion: "" };

/**
 * Aplica los filtros. `sectorDeEquipo` es lo que hace que filtrar por un sector
 * incluya las condiciones de sus equipos: quien busca «Cantera» quiere ver
 * también lo de la perforadora, que está cargado en el equipo y no en el sector.
 */
export function filtrarCondiciones(
  filas: FilaDeCondicion[],
  filtros: FiltrosDeGestion,
  hoy: string,
  sectorDeEquipo: ReadonlyMap<string, string | null>
): FilaDeCondicion[] {
  return filas.filter((c) => {
    if (filtros.estado && estadoDe(c, hoy) !== filtros.estado) return false;

    if (filtros.falta) {
      const faltas = loQueFalta(c);
      if (filtros.falta === "alguna" ? faltas.length === 0 : !faltas.includes(filtros.falta)) {
        return false;
      }
    }

    if (filtros.lugar) {
      const id = filtros.lugar.slice(2);
      if (filtros.lugar.startsWith("e:")) {
        if (c.equipo_id !== id) return false;
      } else {
        const delEquipo = c.equipo_id ? sectorDeEquipo.get(c.equipo_id) : null;
        if (c.sector_id !== id && delEquipo !== id) return false;
      }
    }

    if (filtros.clasificacion) {
      const clase = clasificar(c.nivel_riesgo);
      if (filtros.clasificacion === "sin_clasificar" ? clase !== null : clase !== filtros.clasificacion) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Los números del encabezado y del tablero. **Sin completar** es abierta y con
 * alguna falta; **vencidas** puede solaparse con eso (una vencida a la que le
 * falta evaluar cuenta en las dos), y por eso son dos números y no una partición.
 *
 * Pide sólo las columnas que las dos reglas leen, así el tablero no tiene que
 * traer la fila entera (ni disfrazar una fila parcial de `FilaDeCondicion`).
 */
export function resumenDeCondiciones(
  filas: (CondicionParaFaltantes & { fecha_ejecucion: string | null })[],
  hoy: string
): { total: number; abiertas: number; cerradas: number; vencidas: number; sinCompletar: number } {
  let abiertas = 0;
  let vencidas = 0;
  let sinCompletar = 0;
  for (const c of filas) {
    const estado = estadoDe(c, hoy);
    if (estado === "Cerrada") continue;
    abiertas++;
    if (estado === "Vencida") vencidas++;
    if (loQueFalta(c).length > 0) sinCompletar++;
  }
  return { total: filas.length, abiertas, cerradas: filas.length - abiertas, vencidas, sinCompletar };
}

// ── Lo que se manda al guardar ───────────────────────────────

/** Lo que la ficha edita, todo como texto: es lo que devuelven los campos. */
export interface Borrador {
  lugar: { tipo: "sector" | "equipo" | ""; id: string };
  descripcion: string;
  peligro_id: string;
  accion_propuesta: string;
  prioridad: string;
  frecuencia: string;
  antecedentes: string;
  controles: string;
  magnitud_dano: string;
  legislacion: string;
  responsable_id: string;
  fecha_maxima: string;
  requiere_inversion: "" | "si" | "no";
  observaciones: string;
  fecha_ejecucion: string;
}

export function borradorDe(c: FilaDeCondicion): Borrador {
  const n = (v: number | null) => (v === null ? "" : String(v));
  return {
    lugar: c.sector_id
      ? { tipo: "sector", id: c.sector_id }
      : c.equipo_id
        ? { tipo: "equipo", id: c.equipo_id }
        : { tipo: "", id: "" },
    descripcion: c.descripcion,
    peligro_id: c.peligro_id ?? "",
    accion_propuesta: c.accion_propuesta ?? "",
    prioridad: n(c.prioridad),
    frecuencia: n(c.frecuencia),
    antecedentes: n(c.antecedentes),
    controles: n(c.controles),
    magnitud_dano: n(c.magnitud_dano),
    legislacion: n(c.legislacion),
    responsable_id: c.responsable_id ?? "",
    fecha_maxima: c.fecha_maxima ?? "",
    requiere_inversion: c.requiere_inversion === null ? "" : c.requiere_inversion ? "si" : "no",
    observaciones: c.observaciones ?? "",
    fecha_ejecucion: c.fecha_ejecucion ?? "",
  };
}

const PUNTAJES: Criterio[] = ["frecuencia", "antecedentes", "controles", "magnitud_dano", "legislacion"];

/**
 * El cuerpo del PATCH: **sólo lo que cambió**, y sólo lo que quien guarda puede
 * tocar.
 *
 * Mandar la ficha entera sería pedirle permiso a la ruta por campos que nadie
 * movió: un `edicion` que corrige una descripción mandaría también los cinco
 * puntajes vacíos y recibiría un 403 por algo que no hizo. Y para un `admin`,
 * mandar sólo lo cambiado evita pisar lo que otra persona guardó mientras la
 * ficha estaba abierta.
 *
 * El lugar viaja siempre de a dos (`sector_id` y `equipo_id`, uno en null), que
 * es lo que la ruta necesita para mover una condición de un equipo a un sector.
 */
export function cambiosDe(
  c: FilaDeCondicion,
  b: Borrador,
  esAdmin: boolean
): Record<string, string | number | boolean | null> {
  const antes = borradorDe(c);
  const cambios: Record<string, string | number | boolean | null> = {};

  if (antes.lugar.tipo !== b.lugar.tipo || antes.lugar.id !== b.lugar.id) {
    cambios.sector_id = b.lugar.tipo === "sector" ? b.lugar.id : null;
    cambios.equipo_id = b.lugar.tipo === "equipo" ? b.lugar.id : null;
  }
  if (antes.descripcion !== b.descripcion) cambios.descripcion = b.descripcion;
  if (antes.peligro_id !== b.peligro_id) cambios.peligro_id = b.peligro_id || null;
  if (antes.accion_propuesta !== b.accion_propuesta) cambios.accion_propuesta = b.accion_propuesta;
  if (antes.prioridad !== b.prioridad) cambios.prioridad = Number(b.prioridad);

  if (!esAdmin) return cambios;

  for (const p of PUNTAJES) {
    if (antes[p] !== b[p]) cambios[p] = b[p] === "" ? null : Number(b[p]);
  }
  if (antes.responsable_id !== b.responsable_id) cambios.responsable_id = b.responsable_id || null;
  if (antes.fecha_maxima !== b.fecha_maxima) cambios.fecha_maxima = b.fecha_maxima || null;
  if (antes.requiere_inversion !== b.requiere_inversion) {
    cambios.requiere_inversion = b.requiere_inversion === "" ? null : b.requiere_inversion === "si";
  }
  if (antes.observaciones !== b.observaciones) cambios.observaciones = b.observaciones.trim() || null;
  if (antes.fecha_ejecucion !== b.fecha_ejecucion) cambios.fecha_ejecucion = b.fecha_ejecucion || null;

  return cambios;
}
