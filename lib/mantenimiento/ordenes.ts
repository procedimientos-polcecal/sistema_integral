/**
 * Órdenes de trabajo: leer la planilla donde viven.
 *
 * Se lee por posición de columna, como en el origen y verificado contra la
 * planilla "ORDEN DE TRABAJO", pestaña OT:
 *
 *   A N° OT · B fecha · C sector · D equipo · E especialidad · F tipo ·
 *   G quién lo realiza · H descripción · I repuesto · J ejecución · K cierre ·
 *   L (calculada, se saltea) · M estado · N contratista · O horas ·
 *   P/Q/R operarios · S prioridad · T frecuencia · U próxima fecha ·
 *   V fotos · W observaciones
 *
 * La L se llama "Column 19" y trae un "Atrasado / al día" calculado. **No es el
 * estado**: el estado está en M, y confundirlas daría por atrasada media
 * planilla.
 */

import { texto, fechaDeSheets, codigoDeEquipo } from "@/lib/mantenimiento/planilla";

/**
 * Las especialidades que usa la planilla, verificadas contra ella.
 *
 * Es vocabulario cerrado: si aparece una nueva hay que sumarla acá para poder
 * filtrar por ella — las OT igual se guardan con lo que diga la celda.
 */
export const ESPECIALIDADES = ["MECÁNICO", "ELÉCTRICO", "CIVIL", "LUBRICACIÓN"] as const;

/** Columna de cada dato, contando desde A = 0. */
const COL = {
  otNumber: 0,
  fecha: 1,
  sector: 2,
  equipo: 3,
  especialidad: 4,
  tipo: 5,
  quien: 6,
  descripcion: 7,
  repuesto: 8,
  fechaEjecucion: 9,
  fechaCierre: 10,
  estado: 12,
  contratista: 13,
  horas: 14,
  operario1: 15,
  operario2: 16,
  operario3: 17,
  prioridad: 18,
  frecuencia: 19,
  proximaFecha: 20,
} as const;

/**
 * El estado de la planilla, en el vocabulario del sistema.
 *
 * Lo que no se reconoce queda como "por hacer": es el estado del que se parte,
 * no un dato faltante. Una OT sin clasificar es una OT que falta hacer.
 */
export function estadoDeTexto(valor: unknown): string {
  const v = String(valor ?? "").trim().toUpperCase();

  if (v === "REALIZADO") return "REALIZADO";
  if (v.includes("PROCESO")) return "EN_PROCESO";
  if (v === "ATRASADO") return "ATRASADO";
  if (v === "SUSPENDIDA") return "SUSPENDIDA";
  return "POR_HACER";
}

/**
 * Un campo de texto de la planilla.
 *
 * El guión suelto es como se escribe "acá no va nada" en una planilla: no es un
 * contratista llamado "-".
 */
const campo = (v: unknown): string | null => {
  const s = texto(v);
  return s === null || s === "-" ? null : s;
};

const numero = (v: unknown): number | null => {
  const s = texto(v);
  if (s === null) return null;
  const n = Number(s.replace(",", "."));
  return isFinite(n) ? n : null;
};

export interface OrdenLeida {
  ot_number: number;
  fecha: string | null;
  sector_raw: string | null;
  equipo_raw: string | null;
  equipo_code: string | null;
  especialidad: string | null;
  tipo: string | null;
  quien: string | null;
  descripcion: string | null;
  repuesto: string | null;
  fecha_ejecucion: string | null;
  fecha_cierre: string | null;
  estado: string;
  contratista: string | null;
  horas: number | null;
  operario_1: string | null;
  operario_2: string | null;
  operario_3: string | null;
  prioridad: string | null;
  frecuencia: string | null;
  proxima_fecha: string | null;
  sheets_row: number;
}

/** Una fila de la planilla como orden de trabajo. `null` si no lo es. */
export function filaDeOrden(fila: unknown[], numeroFila: number): OrdenLeida | null {
  const nro = Number(fila[COL.otNumber]);
  if (!nro || isNaN(nro)) return null;

  const equipoRaw = campo(fila[COL.equipo]);

  return {
    ot_number: nro,
    fecha: fechaDeSheets(fila[COL.fecha]),
    sector_raw: campo(fila[COL.sector]),
    equipo_raw: equipoRaw,
    equipo_code: codigoDeEquipo(equipoRaw),
    especialidad: campo(fila[COL.especialidad]),
    tipo: campo(fila[COL.tipo]),
    quien: campo(fila[COL.quien]),
    descripcion: campo(fila[COL.descripcion]),
    repuesto: campo(fila[COL.repuesto]),
    fecha_ejecucion: fechaDeSheets(fila[COL.fechaEjecucion]),
    fecha_cierre: fechaDeSheets(fila[COL.fechaCierre]),
    estado: estadoDeTexto(fila[COL.estado]),
    contratista: campo(fila[COL.contratista]),
    horas: numero(fila[COL.horas]),
    operario_1: campo(fila[COL.operario1]),
    operario_2: campo(fila[COL.operario2]),
    operario_3: campo(fila[COL.operario3]),
    prioridad: campo(fila[COL.prioridad]),
    frecuencia: campo(fila[COL.frecuencia]),
    proxima_fecha: fechaDeSheets(fila[COL.proximaFecha]),
    sheets_row: numeroFila,
  };
}
