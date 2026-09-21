/**
 * Cuánto se facturó, en Odoo, asociado a un equipo móvil o a un tipo de
 * combustible — la parte que le falta a `lib/cantera/costoMaquinaDestape.ts`
 * para calcular el costo $/h de una máquina propia de destape.
 *
 * Un mismo equipo tiene una cuenta analítica **por empresa** (`EM3` es la
 * 148 en Polysan y la 300 en Polcecal — relevado el 21/09/2026: existen las
 * dos, cualquiera de las dos empresas puede haberle pagado algo), así que
 * acá siempre se suman las dos, no se elige una.
 *
 * El combustible **no tiene litros en ningún lado de la factura**: se
 * factura "1 unidad" = la entrega completa del camión cisterna, sin
 * cantidad. Por eso no hay forma de sacar un $/litro de una factura sola —
 * se resuelve afuera de acá, con `gastoDeCombustible` del período completo
 * dividido los litros que Taller Vial registró en ese período (el precio
 * implícito, no el de una entrega puntual).
 */

import { buscarLeer, empresasDeOdoo } from "./client";
import { leerCuentasAnaliticas } from "./catalogoContable";
import { analiticaDelEquipo, type AnaliticaDeOdoo } from "@/lib/facturacion/analiticaDelEquipo";

/** Sólo lo efectivamente contabilizado — un borrador no es un gasto real. */
function dominioBase(desde: string, hasta: string): unknown[] {
  return [
    ["move_id.move_type", "in", ["in_invoice", "in_refund"]],
    ["display_type", "=", "product"],
    ["parent_state", "=", "posted"],
    ["date", ">=", desde],
    ["date", "<=", hasta],
  ];
}

interface LineaConAnalitica {
  price_subtotal: number;
  analytic_distribution: Record<string, number> | false;
}

async function sumarLineasDeAnaliticas(analyticIds: number[], desde: string, hasta: string): Promise<number> {
  if (!analyticIds.length) return 0;
  const claves = new Set(analyticIds.map(String));
  const lineas = await buscarLeer<LineaConAnalitica>(
    "account.move.line",
    dominioBase(desde, hasta),
    ["price_subtotal", "analytic_distribution"],
    { limite: 3000 }
  );

  let total = 0;
  for (const l of lineas) {
    if (!l.analytic_distribution) continue;
    for (const [clave, porcentaje] of Object.entries(l.analytic_distribution)) {
      if (claves.has(clave)) total += l.price_subtotal * (porcentaje / 100);
    }
  }
  return total;
}

export interface GastoDelEquipo {
  gasto: number;
  /** Nombres de empresa donde el código no resolvió a una única analítica (ambigua o inexistente) — ese lado queda sin contar, no adivinado. */
  empresasSinResolver: string[];
}

/**
 * Lo facturado (posteado) a la cuenta analítica de este equipo, sumando las
 * dos empresas, en el período. Si el código no resuelve a una analítica en
 * alguna empresa, esa empresa aporta $0 y se avisa — mismo criterio que
 * "enlazar al que se parece es peor que null" del resto del sistema.
 */
export async function gastoAnaliticoDelEquipo(codigoEquipo: string, desde: string, hasta: string): Promise<GastoDelEquipo> {
  const empresas = await empresasDeOdoo();
  const analyticIds: number[] = [];
  const empresasSinResolver: string[] = [];

  for (const empresa of empresas) {
    const cuentas = await leerCuentasAnaliticas(empresa.id);
    const deOdoo: AnaliticaDeOdoo[] = cuentas.map((c) => ({ id: c.id, nombre: c.nombre, empresa: empresa.id }));
    const elegida = analiticaDelEquipo(codigoEquipo, deOdoo, empresa.id);
    if (elegida.analitica) analyticIds.push(elegida.analitica.id);
    else empresasSinResolver.push(empresa.name);
  }

  const gasto = await sumarLineasDeAnaliticas(analyticIds, desde, hasta);
  return { gasto, empresasSinResolver };
}

/**
 * Lo facturado (posteado, las dos empresas) en un tipo de combustible —
 * "DIESEL D500" o "INFINIA DIESEL", el nombre real del producto en Odoo—
 * en el período. **No incluye "IMPUESTO COMBUSTIBLE"**: es una línea aparte
 * de la misma factura, sin forma de repartirla entre diesel y nafta sin
 * adivinar, así que el estimado queda conservador a propósito.
 */
export async function gastoDeCombustible(nombreProducto: string, desde: string, hasta: string): Promise<number> {
  const lineas = await buscarLeer<{ price_subtotal: number }>(
    "account.move.line",
    [...dominioBase(desde, hasta), ["product_id.name", "=", nombreProducto]],
    ["price_subtotal"],
    { limite: 1000 }
  );
  return lineas.reduce((s, l) => s + l.price_subtotal, 0);
}
