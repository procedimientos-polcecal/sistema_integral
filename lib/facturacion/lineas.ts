import { sugerirProducto, type ProductoDeOdoo } from "@/lib/compras/productoOdoo";
import type { LineaDelComprobante } from "./lineasDelPdf";

/**
 * El detalle de una factura del buzón: de lo que dice el papel a lo que va a
 * Odoo.
 *
 * Son tres cosas distintas por línea y conviene tenerlas separadas:
 *
 * 1. **Lo que dice el comprobante** —descripción, cantidad, precio, total—, que
 *    no se toca nunca: es el papel.
 * 2. **El producto de Odoo**, que el sistema propone y una persona corrige. Se
 *    reusa el mismo emparejador que las órdenes de compra, con su tabla de lo
 *    aprendido: es el mismo problema (un texto libre contra un catálogo de
 *    rubros) y lo que se aprende de un lado sirve del otro.
 * 3. **La imputación** —cuenta contable y distribución analítica—, que la pone
 *    una persona. El sistema no la adivina: 87% de las líneas de compra del
 *    grupo llevan analítica, y ninguna regla del comprobante dice a qué equipo o
 *    sector corresponde un repuesto.
 */

export interface DistribucionAnalitica {
  /** `{ "1549": 100 }` — id de `account.analytic.account` a porcentaje. */
  [odooAnalyticId: string]: number;
}

/** Una línea del detalle, como se guarda y como se muestra. */
export interface LineaDeFactura {
  id: string;
  factura_id: string;
  orden: number;
  descripcion: string;
  cantidad: number | null;
  precio_unitario: number | null;
  total: number | null;
  odoo_product_id: number | null;
  odoo_product_nombre: string | null;
  odoo_account_id: number | null;
  odoo_account_nombre: string | null;
  analitica: DistribucionAnalitica | null;
  analitica_detalle: string | null;
  producto_origen: "aprendido" | "sugerido" | "a mano" | null;
}

/** Lo que se inserta al cargar la factura, antes de que nadie corrija nada. */
export type LineaNueva = Omit<LineaDeFactura, "id" | "factura_id">;

/**
 * Convertir lo leído del PDF en filas, con el producto ya propuesto.
 *
 * El producto se propone pero **no se da por bueno**: `producto_origen` dice si
 * lo eligió una regla, la tabla de lo aprendido o una persona, que es la misma
 * distinción que `identificado_por` hace en la cabecera. Si mañana el gasto
 * quedó en la cuenta equivocada, la primera pregunta es quién eligió.
 */
export function prepararLineas(
  lineas: LineaDelComprobante[],
  catalogos: { catalogo: ProductoDeOdoo[]; aprendidos: Map<string, number> }
): LineaNueva[] {
  return lineas.map((linea, i) => {
    const sugerencia = sugerirProducto(linea.descripcion, catalogos.catalogo, catalogos.aprendidos);

    return {
      orden: i,
      descripcion: linea.descripcion,
      cantidad: linea.cantidad,
      precio_unitario: linea.precioUnitario,
      total: linea.total,
      odoo_product_id: sugerencia.producto?.id ?? null,
      odoo_product_nombre: sugerencia.producto?.nombre ?? null,
      odoo_account_id: null,
      odoo_account_nombre: null,
      analitica: null,
      analitica_detalle: null,
      producto_origen: sugerencia.producto ? sugerencia.motivo === "aprendido" ? "aprendido" : "sugerido" : null,
    };
  });
}

/** Ver el comentario de `revisarDistribucion`: sale de lo que Odoo ya aceptó. */
const TOLERANCIA_DE_LA_SUMA = 0.05;

/**
 * Si una distribución analítica es válida para Odoo.
 *
 * Odoo espera porcentajes que sumen 100, **pero no es estricto**, y eso se sabe
 * porque se miró lo que hay cargado: el gasto de carbonilla del grupo está
 * repartido entre seis cuentas como `16,67 + 16,66 × 5`, que suma **99,97**, y
 * está posteado. O sea que exigir 100 exacto rechazaría asientos que Odoo aceptó.
 *
 * De ahí sale la tolerancia: cinco centésimas de punto, que cubre el redondeo de
 * repartir entre hasta unas pocas decenas de cuentas y sigue atrapando el error
 * que importa —una distribución que suma 80 porque alguien borró una línea—.
 *
 * Vacía es válida: una línea sin analítica es una que nadie imputó todavía.
 */
export function revisarDistribucion(
  analitica: DistribucionAnalitica | null | undefined
): string | null {
  if (!analitica) return null;

  const entradas = Object.entries(analitica);
  if (entradas.length === 0) return null;

  for (const [id, porcentaje] of entradas) {
    if (!/^\d+$/.test(id)) return `"${id}" no es una cuenta analítica de Odoo.`;
    if (typeof porcentaje !== "number" || !Number.isFinite(porcentaje)) {
      return `El porcentaje de la cuenta ${id} no es un número.`;
    }
    if (porcentaje <= 0) return `La cuenta ${id} tiene un porcentaje de ${porcentaje}.`;
  }

  const suma = entradas.reduce((a, [, p]) => a + p, 0);
  if (Math.abs(suma - 100) > TOLERANCIA_DE_LA_SUMA) {
    return `Los porcentajes suman ${Math.round(suma * 100) / 100} y tienen que sumar 100.`;
  }

  return null;
}

/**
 * Repartir en partes iguales entre varias cuentas analíticas.
 *
 * El resto se le da a la primera, así que la suma da **100 exacto**: seis
 * cuentas quedan en `16,70 + 16,66 × 5`. Es un centavo de punto más prolijo que
 * lo que reparte Odoo —que deja 99,97— y no hay motivo para copiarle el redondeo.
 */
export function repartirEnPartesIguales(ids: number[]): DistribucionAnalitica {
  if (ids.length === 0) return {};

  const base = Math.floor((100 / ids.length) * 100) / 100;
  const reparto: DistribucionAnalitica = {};
  for (const id of ids) reparto[String(id)] = base;

  const sobra = Math.round((100 - base * ids.length) * 100) / 100;
  if (sobra !== 0) reparto[String(ids[0])] = Math.round((base + sobra) * 100) / 100;

  return reparto;
}

/**
 * Cómo se lee una distribución en pantalla y en el registro que queda guardado.
 *
 * Se guarda el texto además de los ids porque dentro de seis meses `{"1549":100}`
 * no le dice nada a nadie, y porque si alguien renombra la cuenta analítica en
 * Odoo, esto deja constancia de con qué nombre se eligió.
 */
export function describirDistribucion(
  analitica: DistribucionAnalitica | null | undefined,
  nombres: Map<number, string>
): string | null {
  if (!analitica) return null;
  const entradas = Object.entries(analitica);
  if (entradas.length === 0) return null;

  /*
   * Ordenado por porcentaje y no por id. No es cosmético: las claves de un
   * objeto que parecen enteros las ordena JavaScript de menor a mayor, así que
   * el orden en que se armó la distribución se pierde. Que mande el porcentaje
   * deja primero la cuenta que se llevó la mayor parte, que es lo que alguien
   * quiere ver de un vistazo.
   */
  return entradas
    .sort((a, b) => b[1] - a[1])
    .map(([id, pct]) => `${nombres.get(Number(id)) ?? `#${id}`} ${pct}%`)
    .join(" · ");
}
