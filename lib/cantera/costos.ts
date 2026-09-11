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

/**
 * El monto de la perforación:
 *
 *   metros perforados × precio USD/m × TC  +  noches de sereno × monto por noche
 *
 * `metros` es el total (Σ pozos·metros de los tramos); lo calcula el que llama
 * con `metrosYPozos()` de `tramos.ts`. Las noches de sereno son un pago local
 * en pesos, así que se suman **sin pasar por el TC**. `null` si no se puede
 * calcular la parte de perforación; el sereno solo no alcanza para un monto.
 */
export function montoPerforacion(e: {
  metros: number | null | undefined;
  precioUsdM: number | null | undefined;
  tc: number | null | undefined;
  nochesSereno?: number | null;
  montoNoche?: number | null;
}): number | null {
  const metros = num(e.metros);
  const precio = num(e.precioUsdM);
  const tc = num(e.tc);
  if (metros === null || precio === null || tc === null) return null;

  const noches = num(e.nochesSereno);
  const porNoche = num(e.montoNoche);
  const sereno = noches !== null && porNoche !== null ? noches * porNoche : 0;

  return metros * precio * tc + sereno;
}

/**
 * El monto de un bochón: cantidad de bochones × metros perforados (por bochón,
 * casi siempre ≤ 1 m) × precio USD/m × TC.
 *
 * Los dos números vienen invertidos en la planilla vieja respecto de lo que
 * dicen sus propios encabezados —"Metros perf." guarda la cantidad de
 * bochones y "Perforaciones" los metros—, confirmado con el usuario. Acá cada
 * campo tiene el nombre de lo que realmente es.
 */
export function montoBochon(e: {
  cantidad: number | null | undefined;
  metrosPerforados: number | null | undefined;
  precioUsdM: number | null | undefined;
  tc: number | null | undefined;
}): number | null {
  const cantidad = num(e.cantidad);
  const metros = num(e.metrosPerforados);
  const precio = num(e.precioUsdM);
  const tc = num(e.tc);
  if (cantidad === null || metros === null || precio === null || tc === null) return null;
  return cantidad * metros * precio * tc;
}

/**
 * El servicio de voladura es el **4% de la suma de todos los insumos usados**,
 * no un renglón que se tipea (confirmado con el usuario). En la planilla figura
 * como una fila con precio 0,04 y el total ya calculado; acá se recalcula
 * siempre, así que las filas de `tipo === "voladura"` no se suman como insumo.
 */
export const TASA_SERVICIO_VOLADURA = 0.04;

/** La suma de los insumos reales (sin el servicio), en USD. */
export function baseDeConsumosUsd(
  consumos: { cantidad: number | null; precio_usd: number | null; tipo?: string | null }[]
): number {
  let base = 0;
  for (const c of consumos) {
    if (c.tipo === "voladura") continue; // el servicio se recalcula, no se suma
    const cant = num(c.cantidad);
    const precio = num(c.precio_usd);
    if (cant === null || precio === null) continue;
    base += cant * precio;
  }
  return base;
}

/**
 * El monto de la voladura: (insumos + 4% de servicio) × TC. `null` si no hay
 * renglones o falta el TC: sin insumos no hay número, y mostrar 0 sería decir
 * que la voladura no costó nada.
 */
export function montoVoladura(
  consumos: { cantidad: number | null; precio_usd: number | null; tipo?: string | null }[],
  tc: number | null | undefined
): number | null {
  const t = num(tc);
  if (t === null || consumos.length === 0) return null;
  const base = baseDeConsumosUsd(consumos);
  return base * (1 + TASA_SERVICIO_VOLADURA) * t;
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
