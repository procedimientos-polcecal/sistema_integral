/**
 * Avisos: leer la planilla donde se reportan.
 *
 * Un aviso (N° OA) dice que algo necesita mantenimiento. De un aviso puede
 * salir después una orden de trabajo.
 *
 * La planilla se lee **por posición de columna**, no por encabezado, porque
 * así está armada en el origen: A el número, B la fecha, C el sector, D el
 * equipo, E la descripción, F la urgencia, G quién avisó, J si ya tiene OT,
 * K la imagen y L las observaciones. H e I son restos de una fórmula que parte
 * el nombre en dos y no se leen.
 *
 * Verificado contra la planilla: el código de origen leía las observaciones de
 * K, que hoy es la imagen, así que los avisos con foto guardaban la URL de
 * Drive en el campo de observaciones. Si alguien inserta una columna en el
 * medio, esto se rompe en silencio.
 */

import { texto, fechaDeSheets, codigoDeEquipo } from "@/lib/mantenimiento/planilla";

/** Columna de cada dato, contando desde A = 0. */
const COL = {
  oa: 0,
  fecha: 1,
  sector: 2,
  equipo: 3,
  descripcion: 4,
  urgencia: 5,
  quien: 6,
  otAsignada: 9,
  imagen: 10,
  observaciones: 11,
} as const;

export interface AvisoLeido {
  oa_number: string;
  fecha: string | null;
  sector_raw: string | null;
  equipo_raw: string | null;
  equipo_code: string | null;
  descripcion: string | null;
  urgencia: string | null;
  quien_aviso: string | null;
  ot_asignada: string | null;
  observaciones: string | null;
  /** La columna "Imagen": un link de Drive a la foto del aviso. */
  reference_photos: string[] | null;
  sheets_row: number;
}

/** Una fila de la planilla como aviso. `null` si no lo es. */
export function filaDeAviso(fila: unknown[], numeroFila: number): AvisoLeido | null {
  const oa = texto(fila[COL.oa]);
  if (!oa) return null;

  const equipoRaw = texto(fila[COL.equipo]);
  const imagen = texto(fila[COL.imagen]);

  return {
    oa_number: oa,
    fecha: fechaDeSheets(fila[COL.fecha]),
    sector_raw: texto(fila[COL.sector]),
    equipo_raw: equipoRaw,
    equipo_code: codigoDeEquipo(equipoRaw),
    descripcion: texto(fila[COL.descripcion]),
    urgencia: texto(fila[COL.urgencia]),
    quien_aviso: texto(fila[COL.quien]),
    ot_asignada: texto(fila[COL.otAsignada]),
    observaciones: texto(fila[COL.observaciones]),
    reference_photos: imagen ? [imagen] : null,
    sheets_row: numeroFila,
  };
}

/**
 * Qué prioridad de OT le corresponde a la urgencia del aviso.
 *
 * En la planilla la urgencia viene con emoji —"🟠 Alta", "🟡 Media", "🟢 Baja"—,
 * verificado contra ella, así que se busca la palabra adentro en vez de
 * comparar la celda entera.
 */
export function prioridadDeUrgencia(urgencia: string | null | undefined): string {
  const s = String(urgencia ?? "");
  if (/alta/i.test(s)) return "ALTA";
  if (/baja/i.test(s)) return "BAJA";
  return "MEDIA";
}
