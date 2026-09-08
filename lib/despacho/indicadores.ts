import { tiemposDeLaOrden } from "./orden";
import type { HorariosDeOrden } from "./types";

/**
 * Los números que la planilla no da hoy: cuánto se tarda en cargar y cuánto se
 * queda un camión en el predio.
 *
 * Función pura y con tests porque es donde está la decisión de qué se cuenta.
 * Dos reglas, y las dos existen para que el promedio no mienta:
 *
 * **Un tiempo que no se puede calcular no entra.** Tratar como cero una orden a
 * la que le falta un horario bajaría el promedio y diría que se carga más rápido
 * de lo que se carga. Se cuentan aparte (`sinTiempoDeCarga`) para que se vea
 * sobre cuántas órdenes está hecho el promedio.
 *
 * **Un tiempo negativo tampoco entra**, y por lo mismo: es un horario mal
 * corregido, no un camión que tardó menos que nada. La orden se muestra en rojo
 * en el listado —ahí sí, con el número negativo a la vista— pero no se promedia.
 */

export interface OrdenParaIndicadores extends HorariosDeOrden {
  numero: string;
  cliente_raw: string | null;
}

export interface Indicadores {
  cantidad: number;
  /** Minutos. Null cuando no hubo ninguna orden con los dos horarios. */
  promedioCarga: number | null;
  promedioPredio: number | null;
  sinTiempoDeCarga: number;
  sinTiempoEnPredio: number;
  peoresEnPredio: { numero: string; cliente: string | null; minutos: number }[];
}

/** Cuántos de los peores se llevan a la pantalla. */
const CUANTOS_PEORES = 5;

export function indicadoresDeOrdenes(ordenes: OrdenParaIndicadores[]): Indicadores {
  const cargas: number[] = [];
  const predios: { numero: string; cliente: string | null; minutos: number }[] = [];
  let sinCarga = 0;
  let sinPredio = 0;

  for (const o of ordenes) {
    const { carga, predio } = tiemposDeLaOrden(o);

    if (carga !== null && carga >= 0) cargas.push(carga);
    else sinCarga++;

    if (predio !== null && predio >= 0) {
      predios.push({ numero: o.numero, cliente: o.cliente_raw, minutos: predio });
    } else sinPredio++;
  }

  return {
    cantidad: ordenes.length,
    promedioCarga: promedio(cargas),
    promedioPredio: promedio(predios.map((p) => p.minutos)),
    sinTiempoDeCarga: sinCarga,
    sinTiempoEnPredio: sinPredio,
    peoresEnPredio: [...predios].sort((a, b) => b.minutos - a.minutos).slice(0, CUANTOS_PEORES),
  };
}

/** Null y no cero cuando no hay nada que promediar: un cero diría "tardó nada". */
function promedio(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const suma = valores.reduce((a, b) => a + b, 0);
  return Math.round((suma / valores.length) * 10) / 10;
}
