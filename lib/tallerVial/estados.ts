/**
 * El estado diario de un equipo, espejado de "HISTORIAL ESTADOS" de la
 * planilla real: una matriz fecha × equipo con tres códigos por celda.
 * Confirmado con el usuario: OP = Operativo, FS = Fuera de Servicio,
 * OCF = Operativo Con Fallas.
 */

export type EstadoDiario = "OPERATIVO" | "FUERA_DE_SERVICIO" | "OPERATIVO_CON_FALLAS";

const CODIGO_A_ESTADO: Record<string, EstadoDiario> = {
  OP: "OPERATIVO",
  FS: "FUERA_DE_SERVICIO",
  OCF: "OPERATIVO_CON_FALLAS",
};

/** Null si el código de la planilla no es ninguno de los tres conocidos — no se adivina. */
export function estadoDesdeCodigoSheet(codigo: string): EstadoDiario | null {
  return CODIGO_A_ESTADO[codigo.trim().toUpperCase()] ?? null;
}

export const ETIQUETA_ESTADO: Record<EstadoDiario, string> = {
  OPERATIVO: "Operativo",
  FUERA_DE_SERVICIO: "Fuera de servicio",
  OPERATIVO_CON_FALLAS: "Operativo con fallas",
};

export interface EstadoPlano {
  equipoId: string;
  fecha: string; // "YYYY-MM-DD"
  estado: EstadoDiario;
}

export interface ResumenMensualDeEstado {
  equipoId: string;
  diasRegistrados: number;
  diasOperativo: number;
  diasFueraDeServicio: number;
  diasConFallas: number;
}

/** Cuántos días de cada estado tuvo cada equipo en el mes — la alarma es `diasFueraDeServicio`. */
export function resumenMensualDeEstados(estados: EstadoPlano[], mes: string): ResumenMensualDeEstado[] {
  const delMes = estados.filter((e) => e.fecha.startsWith(mes));
  const totales = new Map<string, { operativo: number; fs: number; ocf: number; total: number }>();

  for (const e of delMes) {
    const acc = totales.get(e.equipoId) ?? { operativo: 0, fs: 0, ocf: 0, total: 0 };
    acc.total += 1;
    if (e.estado === "OPERATIVO") acc.operativo += 1;
    else if (e.estado === "FUERA_DE_SERVICIO") acc.fs += 1;
    else if (e.estado === "OPERATIVO_CON_FALLAS") acc.ocf += 1;
    totales.set(e.equipoId, acc);
  }

  return [...totales.entries()].map(([equipoId, acc]) => ({
    equipoId,
    diasRegistrados: acc.total,
    diasOperativo: acc.operativo,
    diasFueraDeServicio: acc.fs,
    diasConFallas: acc.ocf,
  }));
}
