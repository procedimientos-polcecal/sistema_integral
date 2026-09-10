/**
 * Los montos de cada etapa y el cruce contra la factura de Odoo.
 *
 *   monto perforación = pozos × metros_por_pozo × precio_usd_m × tc
 *   monto bochón      = metros_perforados × precio_usd_m × tc
 *   monto voladura    = Σ(consumo.cantidad × consumo.precio_usd) × tc
 *
 * Nada de esto se guarda: se despeja al leer. El cruce compara el monto
 * calculado contra `amount_untaxed` (el neto) de la factura que finanzas
 * vinculó en Odoo — el monto de la planilla es neto, confirmado con el usuario.
 */

function num(v: unknown): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

/** pozos × metros_por_pozo, o null si falta alguno. */
export function metrosPerforados(
  pozos: number | null | undefined,
  metrosPorPozo: number | null | undefined
): number | null {
  const p = num(pozos);
  const m = num(metrosPorPozo);
  return p === null || m === null ? null : p * m;
}

export function montoPerforacion(e: {
  pozos: number | null | undefined;
  metrosPorPozo: number | null | undefined;
  precioUsdM: number | null | undefined;
  tc: number | null | undefined;
}): number | null {
  const metros = metrosPerforados(e.pozos, e.metrosPorPozo);
  const precio = num(e.precioUsdM);
  const tc = num(e.tc);
  if (metros === null || precio === null || tc === null) return null;
  return metros * precio * tc;
}

export function montoBochon(e: {
  metrosPerforados: number | null | undefined;
  precioUsdM: number | null | undefined;
  tc: number | null | undefined;
}): number | null {
  const metros = num(e.metrosPerforados);
  const precio = num(e.precioUsdM);
  const tc = num(e.tc);
  if (metros === null || precio === null || tc === null) return null;
  return metros * precio * tc;
}

/**
 * El monto de la voladura sale de los renglones de consumo cargados. `null` si
 * no hay ninguno o falta el TC: sin insumos no hay número, y mostrar 0 sería
 * decir que la voladura no costó nada.
 */
export function montoVoladura(
  consumos: { cantidad: number | null; precio_usd: number | null }[],
  tc: number | null | undefined
): number | null {
  const t = num(tc);
  if (t === null || consumos.length === 0) return null;
  let totalUsd = 0;
  for (const c of consumos) {
    const cant = num(c.cantidad);
    const precio = num(c.precio_usd);
    if (cant === null || precio === null) continue;
    totalUsd += cant * precio;
  }
  return totalUsd * t;
}

export type LecturaDeCruce = "coincide" | "revisar" | "sin_factura" | "sin_monto";

export interface Cruce {
  /** calculado − factura */
  diferencia: number | null;
  /** (calculado − factura) / factura, en tanto por uno */
  porcentaje: number | null;
  lectura: LecturaDeCruce;
}

const TOLERANCIA = 0.02;

/**
 * Compara el monto que calculó el SdG contra el importe neto de la factura
 * vinculada. Es la columna "Coincide" de la planilla, ahora contra el dato real
 * de Odoo.
 *
 * `sin_monto` cuando el SdG no pudo calcular (faltan datos de carga);
 * `sin_factura` cuando finanzas todavía no vinculó ninguna.
 */
export function cruce(
  montoCalculado: number | null | undefined,
  importeFactura: number | null | undefined,
  tolerancia: number = TOLERANCIA
): Cruce {
  const calc = num(montoCalculado);
  const fact = num(importeFactura);

  if (calc === null) return { diferencia: null, porcentaje: null, lectura: "sin_monto" };
  if (fact === null) return { diferencia: null, porcentaje: null, lectura: "sin_factura" };

  const diferencia = calc - fact;
  const porcentaje = fact === 0 ? null : diferencia / fact;
  const lectura: LecturaDeCruce =
    porcentaje !== null && Math.abs(porcentaje) <= tolerancia ? "coincide" : "revisar";

  return { diferencia, porcentaje, lectura };
}
