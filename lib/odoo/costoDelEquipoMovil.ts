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
 *
 * `gastoAnaliticoDeEquipos` pide TODOS los equipos del mes de una sola vez
 * — antes era una consulta a cuentas analíticas y otra a líneas de factura
 * POR equipo, y con varios equipos por mes la página de Destape tardaba
 * varios segundos (Odoo Online no es rápido, ver `lib/odoo/client.ts`).
 * Con esto son 4 llamadas a Odoo en total, no 4 por equipo.
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

export interface GastoDelEquipo {
  gasto: number;
  /** Nombres de empresa donde el código no resolvió a una única analítica (ambigua o inexistente) — ese lado queda sin contar, no adivinado. */
  empresasSinResolver: string[];
}

/**
 * Lo facturado (posteado) a la cuenta analítica de cada equipo pedido,
 * sumando las dos empresas, en el período. Si un código no resuelve a una
 * analítica en alguna empresa, esa empresa aporta $0 para ese equipo y
 * queda avisada — mismo criterio que "enlazar al que se parece es peor
 * que null" del resto del sistema.
 */
export async function gastoAnaliticoDeEquipos(
  codigosDeEquipo: string[],
  desde: string,
  hasta: string
): Promise<Record<string, GastoDelEquipo>> {
  const codigos = [...new Set(codigosDeEquipo)];
  const resultado: Record<string, GastoDelEquipo> = {};
  for (const codigo of codigos) resultado[codigo] = { gasto: 0, empresasSinResolver: [] };
  if (!codigos.length) return resultado;

  const empresas = await empresasDeOdoo();
  const cuentasPorEmpresa = await Promise.all(empresas.map((e) => leerCuentasAnaliticas(e.id)));

  // Cada cuenta analítica pertenece a lo sumo a un equipo — se resuelve una
  // vez acá y después sólo se busca por id al recorrer las líneas.
  const codigoDelAnalyticId = new Map<number, string>();
  for (const codigo of codigos) {
    empresas.forEach((empresa, i) => {
      const deOdoo: AnaliticaDeOdoo[] = cuentasPorEmpresa[i].map((c) => ({ id: c.id, nombre: c.nombre, empresa: empresa.id }));
      const elegida = analiticaDelEquipo(codigo, deOdoo, empresa.id);
      if (elegida.analitica) codigoDelAnalyticId.set(elegida.analitica.id, codigo);
      else resultado[codigo].empresasSinResolver.push(empresa.name);
    });
  }

  if (codigoDelAnalyticId.size === 0) return resultado;

  const lineas = await buscarLeer<LineaConAnalitica>(
    "account.move.line",
    dominioBase(desde, hasta),
    ["price_subtotal", "analytic_distribution"],
    { limite: 3000 }
  );

  for (const l of lineas) {
    if (!l.analytic_distribution) continue;
    for (const [clave, porcentaje] of Object.entries(l.analytic_distribution)) {
      const codigo = codigoDelAnalyticId.get(Number(clave));
      if (codigo) resultado[codigo].gasto += l.price_subtotal * (porcentaje / 100);
    }
  }

  return resultado;
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
