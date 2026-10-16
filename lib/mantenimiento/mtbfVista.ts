/**
 * Qué filas del listado de MTBF se ven, dados los filtros.
 *
 * Es la parte de la pantalla que decide algo, así que está acá y no en el
 * cliente: se puede probar sin montar nada.
 *
 * **Filtrar no recalcula.** El filtro de especialidad muestra los equipos que
 * tuvieron al menos una falla de esa clase, pero el MTBF y la cantidad de fallas
 * que se leen siguen siendo los de todas las causas. Un MTBF condicionado a una
 * especialidad bajo un encabezado que dice "MTBF" es un número engañoso, y por
 * eso esta función nunca toca los valores de la fila: sólo decide si entra.
 *
 * Un equipo que nunca falló no tuvo fallas de ninguna especialidad, así que con
 * ese filtro puesto no figura entre los "sin fallas".
 */
import type { FilaMtbf } from "./mtbf";

export interface EquipoDeLaVista {
  id: string;
  code: string;
  name: string;
  sectorId: string;
  sectorNombre: string;
}

export interface FilaDeVista extends FilaMtbf {
  equipo: EquipoDeLaVista;
}

export interface Filtros {
  sectorId: string | null;
  especialidad: string | null;
}

/** Las filas con su equipo resuelto, ya filtradas. El filtro NO recalcula el MTBF. */
export function filasVisibles(
  filas: FilaMtbf[],
  equipos: EquipoDeLaVista[],
  filtros: Filtros
): FilaDeVista[] {
  const porId = new Map(equipos.map((e) => [e.id, e]));
  const visibles: FilaDeVista[] = [];

  for (const fila of filas) {
    // Un equipo dado de baja después de la falla ya no está en el catálogo
    // activo: sin nombre ni sector no hay nada que mostrar.
    const equipo = porId.get(fila.equipmentId);
    if (!equipo) continue;
    if (filtros.sectorId !== null && equipo.sectorId !== filtros.sectorId) continue;
    if (
      filtros.especialidad !== null &&
      !fila.porEspecialidad.some((e) => e.especialidad === filtros.especialidad)
    ) {
      continue;
    }
    visibles.push({ ...fila, equipo });
  }

  return visibles;
}

/** Los equipos activos que no tienen ninguna fila, ya filtrados. */
export function equiposSinFallas(
  filas: FilaMtbf[],
  equipos: EquipoDeLaVista[],
  filtros: Filtros
): EquipoDeLaVista[] {
  if (filtros.especialidad !== null) return [];

  const conFallas = new Set(filas.map((f) => f.equipmentId));
  return equipos.filter(
    (e) =>
      !conFallas.has(e.id) &&
      (filtros.sectorId === null || e.sectorId === filtros.sectorId)
  );
}

/*
 * Formato. Va a mano y no con `toLocaleString`: el servidor y el navegador
 * pueden tener ICU distintos, y un "4,6" que sale "4.6" en uno de los dos es un
 * error de hidratación que no se ve en el desarrollo.
 */

/** Un decimal y coma: 4,6. */
function conComa(n: number, decimales: number): string {
  return n.toFixed(decimales).replace(".", ",");
}

/** Los días de un MTBF: "4,6 d". Sin MTBF no se escribe ningún número. */
export function diasCorridos(mtbf: number | null): string {
  return mtbf === null ? "—" : `${conComa(mtbf, 1)} d`;
}

/**
 * Una probabilidad 0..1 como porcentaje. Entero desde el 1%, un decimal por
 * debajo —"0,1%" es la diferencia entre un molino que casi no llega al mes y uno
 * que no llega nunca— y "<0,1%" antes que un 0% que dice imposible.
 */
export function porcentajeDeConfiabilidad(p: number | null): string {
  if (p === null) return "—";
  const v = p * 100;
  if (v >= 1) return `${Math.round(v)}%`;
  if (v >= 0.05) return `${conComa(v, 1)}%`;
  return "<0,1%";
}

/** `YYYY-MM-DD` como `DD/MM/YYYY`, sin pasar por `Date`. */
export function fechaCorta(fecha: string): string {
  const [a, m, d] = fecha.split("-");
  return `${d}/${m}/${a}`;
}
