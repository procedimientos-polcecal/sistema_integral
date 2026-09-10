/**
 * Los totales de insumos de una voladura, y el cotejo con el texto libre.
 *
 * `cantera_consumos` es la versión desglosada de `VOLADURAS!Explosivos`
 * (`"emulex x 60 mm: 48,5"`). Los dos registran el mismo hecho y nada obliga a
 * que digan lo mismo, así que hay que poder avisar cuando divergen — sin
 * intentar partir el texto con una regex, que es el error que Despacho decidió
 * no cometer con los nombres de producto.
 */

import { TASA_SERVICIO_VOLADURA } from "./costos";
import type { TipoDeConsumo } from "./types";

function num(v: unknown): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

export interface RenglonDeConsumo {
  tipo: string | null;
  cantidad: number | null;
  precio_usd: number | null;
}

export interface TotalesDeConsumos {
  totalUsd: number;
  totalArs: number;
  /** El desglose por tipo, para el informe (perforación / explosivo / servicio / accesorios). */
  porTipo: Record<string, { usd: number; ars: number }>;
}

export function totalesDeConsumos(
  consumos: RenglonDeConsumo[],
  tc: number | null | undefined
): TotalesDeConsumos {
  const t = num(tc) ?? 0;
  const porTipo: Record<string, { usd: number; ars: number }> = {};
  let base = 0;

  for (const c of consumos) {
    if (c.tipo === "voladura") continue; // el servicio se recalcula abajo
    const cant = num(c.cantidad);
    const precio = num(c.precio_usd);
    if (cant === null || precio === null) continue;
    const usd = cant * precio;
    base += usd;
    const clave = (c.tipo ?? "otros_insumos") as TipoDeConsumo;
    porTipo[clave] ??= { usd: 0, ars: 0 };
    porTipo[clave].usd += usd;
  }

  // El servicio: 4% de la base, siempre calculado.
  const servicioUsd = base * TASA_SERVICIO_VOLADURA;
  if (base > 0) porTipo.voladura = { usd: servicioUsd, ars: 0 };

  const totalUsd = base + servicioUsd;
  for (const k of Object.keys(porTipo)) porTipo[k].ars = porTipo[k].usd * t;

  return { totalUsd, totalArs: totalUsd * t, porTipo };
}

/**
 * `true` cuando hay texto de explosivos cargado pero nadie lo desglosó en
 * renglones. La pantalla muestra el texto y avisa que falta el detalle; el
 * monto de la voladura queda en `null` hasta que se cargue.
 */
export function faltaDesglose(
  explosivosRaw: string | null | undefined,
  consumos: unknown[]
): boolean {
  return Boolean(explosivosRaw && explosivosRaw.trim()) && consumos.length === 0;
}
