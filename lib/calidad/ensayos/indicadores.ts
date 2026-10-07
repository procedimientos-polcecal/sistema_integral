import type { MuestraEvaluada } from "./limites";
import type { Determinacion, Muestra } from "./types";

/**
 * Los indicadores del laboratorio.
 *
 * Es lo que el Excel no podía hacer, y no por falta de ganas: la columna
 * `Ret #100 (%)` estaba guardada en dos escalas distintas según la época, así
 * que cualquier promedio o serie sobre los tres años mezclaba valores que
 * difieren en 100×. Acá no se guarda ningún porcentaje —se despejan al leer—, y
 * recién por eso una serie significa algo.
 *
 * **Todo trabaja sobre `MuestraResuelta`, que es plana y serializable.** La
 * evaluación —`evaluarMuestra`, la misma del listado y del formulario— se hace
 * una vez en el servidor y lo que cruza al cliente son los valores ya
 * resueltos. Así la serie que arma el gráfico cuando alguien cambia el
 * desplegable sale de estas mismas funciones probadas, y no de una copia
 * escrita adentro de la pantalla.
 */

export interface RetenidoResuelto {
  malla: number;
  retenido: number | null;
  acumulado: number | null;
}

export interface MuestraResuelta {
  fecha: string;
  producto_id: string;
  humedad: number | null;
  pesoVolumetrico: number | null;
  calUtilVial: number | null;
  /** Si alguna de sus determinaciones se fue de un límite cargado. */
  fuera: boolean;
  retenidos: RetenidoResuelto[];
}

/** De la muestra evaluada a la forma plana que viaja al cliente. */
export function resolver(muestra: Muestra, evaluada: MuestraEvaluada): MuestraResuelta {
  return {
    fecha: muestra.fecha,
    producto_id: muestra.producto_id,
    humedad: evaluada.humedad.valor,
    pesoVolumetrico: evaluada.pesoVolumetrico.valor,
    calUtilVial: evaluada.calUtilVial.valor,
    fuera: evaluada.hayFueraDeLimite,
    retenidos: evaluada.granulometria.filas.map((f) => ({
      malla: f.malla,
      retenido: f.retenido.valor,
      acumulado: f.acumulado.valor,
    })),
  };
}

/**
 * Un promedio, con **sobre cuántas muestras se calculó**.
 *
 * `n` no es decoración. En el archivo real la cal útil vial tiene tres filas
 * con dato sobre 206 muestras de `Cal`: un "57,5%" suelto se lee como el valor
 * del producto, y es el promedio de tres ensayos de un año. Una determinación
 * que casi no se mide tiene que decirlo al lado del número.
 */
export interface Estadistica {
  n: number;
  promedio: number | null;
  minimo: number | null;
  maximo: number | null;
}

export interface ResumenDeProducto {
  producto_id: string;
  nombre: string;
  muestras: number;
  fueraDeLimite: number;
  humedad: Estadistica;
  pesoVolumetrico: Estadistica;
  calUtilVial: Estadistica;
}

export interface PuntoDeSerie {
  fecha: string;
  valor: number;
}

/** Qué serie mirar: una determinación y, si es de granulometría, en qué malla. */
export interface QueSerie {
  determinacion: Determinacion;
  malla?: number | null;
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

export function estadisticaDe(valores: (number | null | undefined)[]): Estadistica {
  // Un null es "no se midió", no un cero: promediarlo como cero bajaría el
  // promedio en cada muestra donde esa determinación no se hizo.
  const hay = valores.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (hay.length === 0) return { n: 0, promedio: null, minimo: null, maximo: null };

  return {
    n: hay.length,
    promedio: redondear(hay.reduce((a, b) => a + b, 0) / hay.length),
    minimo: redondear(Math.min(...hay)),
    maximo: redondear(Math.max(...hay)),
  };
}

/** El valor de una muestra para la serie que se está mirando. */
export function valorDe(m: MuestraResuelta, que: QueSerie): number | null {
  if (que.determinacion === "humedad") return m.humedad;
  if (que.determinacion === "peso_volumetrico") return m.pesoVolumetrico;
  if (que.determinacion === "cal_util_vial") return m.calUtilVial;

  const fila = m.retenidos.find((f) => f.malla === que.malla);
  if (!fila) return null;
  return que.determinacion === "retenido" ? fila.retenido : fila.acumulado;
}

/**
 * La serie en el tiempo, de la más vieja a la más nueva.
 *
 * Las muestras sin ese dato **no entran**, en vez de entrar como cero: una
 * línea que baja a cero porque ese día no se midió es una mentira que se lee de
 * un vistazo y que el gráfico no puede desmentir.
 *
 * Dos muestras del mismo día quedan las dos: son un caso real —28 de las 29
 * fechas repetidas de la hoja `Cal` lo son— y promediarlas acá taparía
 * justamente la dispersión que se está mirando.
 */
export function serieDe(muestras: MuestraResuelta[], que: QueSerie): PuntoDeSerie[] {
  return muestras
    .map((m) => ({ fecha: m.fecha, valor: valorDe(m, que) }))
    .filter((p): p is PuntoDeSerie => p.valor !== null)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Las mallas que aparecen en el período, para ofrecerlas en el selector. */
export function mallasDelPeriodo(muestras: MuestraResuelta[]): number[] {
  const vistas = new Set<number>();
  for (const m of muestras) for (const r of m.retenidos) vistas.add(r.malla);
  return [...vistas].sort((a, b) => a - b);
}

/**
 * Un renglón por producto con muestras en el período.
 *
 * Los productos sin ninguna muestra no aparecen: un renglón de ceros se lee
 * como "este producto dio cero" y lo que pasó es que no se ensayó.
 */
export function resumenPorProducto(
  muestras: MuestraResuelta[],
  productos: { id: string; nombre: string }[]
): ResumenDeProducto[] {
  const porProducto = new Map<string, MuestraResuelta[]>();
  for (const m of muestras) {
    const suyas = porProducto.get(m.producto_id) ?? [];
    suyas.push(m);
    porProducto.set(m.producto_id, suyas);
  }

  const resumenes: ResumenDeProducto[] = [];
  for (const producto of productos) {
    const suyas = porProducto.get(producto.id);
    if (!suyas || suyas.length === 0) continue;

    resumenes.push({
      producto_id: producto.id,
      nombre: producto.nombre,
      muestras: suyas.length,
      fueraDeLimite: suyas.filter((m) => m.fuera).length,
      humedad: estadisticaDe(suyas.map((m) => m.humedad)),
      pesoVolumetrico: estadisticaDe(suyas.map((m) => m.pesoVolumetrico)),
      calUtilVial: estadisticaDe(suyas.map((m) => m.calUtilVial)),
    });
  }

  return resumenes;
}

export interface MesDeMuestras {
  mes: string;
  muestras: number;
  fueraDeLimite: number;
}

/** Cuántas muestras por mes, para ver si el laboratorio dejó de ensayar algo. */
export function muestrasPorMes(muestras: MuestraResuelta[]): MesDeMuestras[] {
  const porMes = new Map<string, MesDeMuestras>();

  for (const m of muestras) {
    const mes = m.fecha.slice(0, 7);
    const actual = porMes.get(mes) ?? { mes, muestras: 0, fueraDeLimite: 0 };
    actual.muestras++;
    if (m.fuera) actual.fueraDeLimite++;
    porMes.set(mes, actual);
  }

  return [...porMes.values()].sort((a, b) => a.mes.localeCompare(b.mes));
}
