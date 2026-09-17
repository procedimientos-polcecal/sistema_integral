/** El historial de reparaciones de los equipos móviles: se carga desde el SdG, no espeja ninguna planilla. */

export interface ReparacionPlana {
  equipoId: string;
  fecha: string; // "YYYY-MM-DD"
}

export interface ResumenMensualDeReparaciones {
  equipoId: string;
  cantidad: number;
}

/** Cuántas reparaciones tuvo cada equipo en el mes — para verlo de un vistazo en el inicio del módulo. */
export function resumenMensualDeReparaciones(reparaciones: ReparacionPlana[], mes: string): ResumenMensualDeReparaciones[] {
  const delMes = reparaciones.filter((r) => r.fecha.startsWith(mes));
  const totales = new Map<string, number>();
  for (const r of delMes) totales.set(r.equipoId, (totales.get(r.equipoId) ?? 0) + 1);
  return [...totales.entries()].map(([equipoId, cantidad]) => ({ equipoId, cantidad }));
}
