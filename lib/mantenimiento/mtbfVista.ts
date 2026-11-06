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
import type { FilaMtbf, Mtbf } from "./mtbf";

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

/**
 * El límite que más cambia cómo se lee el número, escrito en un solo lugar.
 *
 * Sin horas de marcha cargadas, el MTBF cuenta días de calendario: una máquina
 * de un turno y otra de tres se comparan como si fueran iguales, y la que más
 * trabaja parece peor de lo que es. El spec manda decirlo en texto visible y no
 * en un tooltip, en las tres pantallas (listado, ficha y tablero). Si vive en
 * tres archivos, el día que se corrija en uno queda distinto en los otros dos.
 *
 * `titulo` va en negrita y `detalle` sigue en el mismo párrafo. `corto` es la
 * versión de una línea para donde no hay lugar, como el pie del tablero.
 */
export const DIAS_DE_CALENDARIO = {
  titulo: "Son días de calendario, no horas de máquina.",
  detalle:
    "Las horas de marcha todavía no se cargan, así que una máquina que trabaja un turno y otra que trabaja tres se comparan como si fueran iguales, y la que más trabaja parece peor de lo que es.",
  corto: "Días de calendario, no horas de máquina.",
} as const;

/**
 * Lo que la ficha del equipo sabe de su confiabilidad. Son dos estados y no uno
 * con `fila: null` a propósito: `fila: null` quiere decir "no falló en la
 * ventana" y la tarjeta lo pinta como una buena noticia. Si la lectura falló,
 * eso sería decirle "sin fallas" a una máquina que puede fallar cada cuatro
 * días, que es la mentira más cara que esta pantalla puede decir.
 */
export type ConfiabilidadDeLaFicha =
  | {
      disponible: true;
      /** null cuando el equipo no falló en la ventana. */
      fila: FilaMtbf | null;
      diasObservados: number;
      /** La etiqueta del mes en curso, para dibujarlo incompleto. */
      mesEnCurso: string;
    }
  | { disponible: false };

/** `mtbf` es null cuando la lectura de la planta falló: no hay cuenta, no hay "sin fallas". */
export function confiabilidadDeLaFicha(
  mtbf: Mtbf | null,
  equipmentId: string
): ConfiabilidadDeLaFicha {
  if (mtbf === null) return { disponible: false };
  return {
    disponible: true,
    fila: mtbf.filas.find((f) => f.equipmentId === equipmentId) ?? null,
    diasObservados: mtbf.diasObservados,
    mesEnCurso: mtbf.mesEnCurso,
  };
}

/*
 * Formato. Va a mano y no con `toLocaleString`: el servidor y el navegador
 * pueden tener ICU distintos, y un "4,6" que sale "4.6" en uno de los dos es un
 * error de hidratación que no se ve en el desarrollo.
 */

/** Un decimal y coma: 4,6. */
export function conComa(n: number, decimales: number): string {
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
 *
 * Los dos extremos están tapados por el mismo motivo. Redondear 99,6% a "100%"
 * afirma certeza sobre una exponencial que supone una tasa de falla constante:
 * ninguna máquina llega al mes con probabilidad 1, y el que lee "100%" deja de
 * mirarla. Va "≥99%", que es cierto, igual que "<0,1%" por abajo.
 */
export function porcentajeDeConfiabilidad(p: number | null): string {
  if (p === null) return "—";
  const v = p * 100;
  if (v >= 99.5) return "≥99%";
  if (v >= 1) return `${Math.round(v)}%`;
  if (v >= 0.05) return `${conComa(v, 1)}%`;
  return "<0,1%";
}

/**
 * Cuántas fallas de la ventana quedan antes del primer mes del gráfico.
 *
 * El gráfico son 12 meses calendario y la ventana son 365 días, que arrancan a
 * mitad de un mes: las fallas de esos días sueltos cuentan en `fallas` y no
 * tienen barra donde caer. Hoy da 0 porque el historial todavía no llena la
 * ventana, pero alrededor del 1/12/2026 empieza a dar hasta un mes entero de
 * fallas, y entonces las barras suman menos que el total **sin que nada lo
 * diga** — que es la única forma en que este gráfico puede mentir.
 *
 * Se informa en vez de corregirse: el spec pide doce meses, y un gráfico de
 * trece dibujaría un mes a medias al principio, con la misma etiqueta que el
 * mes en curso. Quien lo lea tiene que saber que el total y las barras no son
 * lo mismo, no que le escondan la diferencia.
 */
export function fallasAntesDelGrafico(fila: FilaMtbf): number {
  const enElGrafico = fila.porMes.reduce((suma, m) => suma + m.cantidad, 0);
  return Math.max(0, fila.fallas - enElGrafico);
}

/** `YYYY-MM-DD` como `DD/MM/YYYY`, sin pasar por `Date`. */
export function fechaCorta(fecha: string): string {
  const [a, m, d] = fecha.split("-");
  return `${d}/${m}/${a}`;
}
