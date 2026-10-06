import { calUtilVial, humedad, pesoVolumetrico } from "./determinaciones";
import { granulometria, type FilaDeGranulometria } from "./granulometria";
import type {
  Determinacion,
  LadoDelDesvio,
  Limite,
  Muestra,
  Retenido,
  ValorEvaluado,
} from "./types";

/**
 * Los límites y la muestra ya evaluada.
 *
 * **La tabla de límites nace vacía y mientras lo esté nada se marca.** Es la
 * misma decisión que los renglones del parte en Producción: la pieza existe y
 * el módulo ya la usa, así que el día que calidad decida los valores no hay que
 * migrar ni volver a tocar las pantallas.
 *
 * Que no avise no es lo mismo que estar roto, y por eso la pantalla de límites
 * lo dice con todas las letras cuando un producto no tiene ninguno.
 */

export function limiteDe(
  limites: Limite[],
  determinacion: Determinacion,
  malla: number | null
): Limite | undefined {
  return limites.find((l) => l.determinacion === determinacion && l.malla === malla);
}

/**
 * De qué lado del límite se fue, o `undefined` si está adentro.
 *
 * Los extremos están adentro: un límite de "máximo 3" dice que 3 está bien.
 * Y un valor que no se pudo calcular no está fuera de nada — un null no es un
 * desvío, es un dato que falta.
 */
export function fueraDeLimite(
  valor: number | null,
  limite: Limite | undefined
): LadoDelDesvio | undefined {
  if (valor === null || !limite) return undefined;
  if (limite.maximo !== null && valor > limite.maximo) return "alto";
  if (limite.minimo !== null && valor < limite.minimo) return "bajo";
  return undefined;
}

function conLimite(
  evaluado: ValorEvaluado,
  limites: Limite[],
  determinacion: Determinacion,
  malla: number | null
): ValorEvaluado {
  const fuera = fueraDeLimite(evaluado.valor, limiteDe(limites, determinacion, malla));
  return fuera ? { ...evaluado, fuera } : evaluado;
}

export interface MuestraEvaluada {
  humedad: ValorEvaluado;
  pesoVolumetrico: ValorEvaluado;
  calUtilVial: ValorEvaluado;
  granulometria: { filas: FilaDeGranulometria[]; problema?: string };
  hayFueraDeLimite: boolean;
}

/**
 * Las cuatro determinaciones calculadas y comparadas contra los límites del
 * producto.
 *
 * Recibe **todos** los límites y filtra por producto acá adentro: así quien
 * muestra una lista de muestras de varios productos los trae una sola vez.
 */
export function evaluarMuestra(
  muestra: Muestra,
  retenidos: Retenido[],
  limites: Limite[]
): MuestraEvaluada {
  const delProducto = limites.filter((l) => l.producto_id === muestra.producto_id);

  const h = conLimite(
    humedad({
      recipiente: muestra.humedad_p_recipiente,
      inicial: muestra.humedad_p_inicial,
      final: muestra.humedad_p_final,
    }),
    delProducto,
    "humedad",
    null
  );

  const pv = conLimite(
    pesoVolumetrico({ gramos: muestra.peso_vol_gramos, volumenCc: muestra.peso_vol_volumen_cc }),
    delProducto,
    "peso_volumetrico",
    null
  );

  const cuv = conLimite(
    calUtilVial({
      mlAcido: muestra.cal_util_ml_acido,
      pesoMuestraG: muestra.cal_util_peso_muestra_g,
    }),
    delProducto,
    "cal_util_vial",
    null
  );

  const g = granulometria({
    pesoMuestraG: muestra.granulometria_peso_muestra_g,
    retenidos: retenidos.map((r) => ({ malla: r.malla, retenido_g: r.retenido_g })),
  });

  // El retenido y el acumulado de la misma malla tienen límites distintos: un
  // retenido bien en #200 con el acumulado alto es un problema de
  // clasificación, no de molienda.
  const filas = g.filas.map((f) => ({
    malla: f.malla,
    retenido: conLimite(f.retenido, delProducto, "retenido", f.malla),
    acumulado: conLimite(f.acumulado, delProducto, "acumulado", f.malla),
  }));

  const hayFueraDeLimite =
    [h, pv, cuv].some((v) => v.fuera !== undefined) ||
    filas.some((f) => f.retenido.fuera !== undefined || f.acumulado.fuera !== undefined);

  return {
    humedad: h,
    pesoVolumetrico: pv,
    calUtilVial: cuv,
    granulometria: { filas, problema: g.problema },
    hayFueraDeLimite,
  };
}
