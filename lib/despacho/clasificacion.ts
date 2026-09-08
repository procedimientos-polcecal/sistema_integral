import type { Clasificacion, ProductoDeDespacho } from "./types";

/**
 * Material, granulometría y envase: los tres campos que el talonario pide por
 * separado y que en Odoo viven metidos dentro del nombre del producto.
 *
 * `CARBONATO DE CALCIO 0-1 BOLSÓN (NA)` los tiene a los tres en una cadena, con
 * espacio al final y sufijos `(NA)`/`(EA)`. **No se parsea.** Una expresión
 * regular sobre esos nombres es la forma segura de que un día `CAL EN TOLVA`
 * entre como envase Bolsa y nadie lo note: enlazar al que se le parece es peor
 * que dejar en null, porque el dato aparece en el lugar que no es y no se
 * nota nunca. El mapeo lo carga una persona en `despacho_productos`, y lo que
 * no está mapeado se muestra "sin clasificar".
 *
 * LAS LISTAS VIVEN ACÁ Y NO EN UN ENUM DE POSTGRES. Un valor de enum nuevo
 * obliga a una migración sola por valor (55P04, la trampa #1 del README, que ya
 * mordió dos veces), y estas listas van a crecer mientras se mapeen los 432
 * productos: el papel dice cuatro materiales y en los últimos 90 días salió
 * Chocolata, Pedregullo 6/20, Minerales Ecológicos y Aditivo Calcáreo. Agregar
 * uno acá es una línea.
 */

/** Los cuatro del talonario, más lo que el relevamiento encontró que sale. */
export const MATERIALES = [
  "Cal",
  "Calcio",
  "Magnesio",
  "Filler",
  "Pedregullo",
  "Chocolata",
  "Minerales ecológicos",
  "Aditivo calcáreo",
  "Otro",
] as const;

/** Las cuatro del talonario, más la del pedregullo. Un producto puede no tener. */
export const GRANULOMETRIAS = ["#200", "0-1", "0-2", "1-2", "6/20"] as const;

/**
 * Los tres del talonario más los dos que el papel no tiene.
 *
 * `Tolva` sale de `CAL EN TOLVA` y `FILLER CALCAREO (TOLVA)`, que están entre
 * los más despachados; `Unidad` de los productos que Odoo mide en unidades y no
 * en toneladas.
 */
export const ENVASES = ["Bolsa", "Bolsón", "A granel", "Tolva", "Unidad"] as const;

/**
 * La clasificación de un producto de Odoo, o null si nadie lo mapeó todavía.
 *
 * No mira `activo`: eso saca al producto del desplegable de la pantalla de
 * mapeo, no le borra la clasificación a las órdenes que ya lo usaron. Una orden
 * de hace un año sigue siendo de Cal en tolva.
 */
export function clasificacionDe(
  odooProductId: number | null | undefined,
  mapeo: ProductoDeDespacho[]
): Clasificacion | null {
  if (odooProductId === null || odooProductId === undefined) return null;
  const p = mapeo.find((x) => x.odoo_product_id === odooProductId);
  if (!p) return null;
  return { material: p.material, granulometria: p.granulometria, envase: p.envase };
}

/**
 * Los tres campos en una línea: `Calcio 0-1 Bolsón`.
 *
 * Es lo que va en la columna `Material` de la planilla —que aplasta los tres en
 * una celda— y lo que se muestra en la cola del día. Sin clasificación devuelve
 * vacío y no una etiqueta inventada: quien llama decide si muestra "sin
 * clasificar" o el nombre crudo del producto.
 */
export function textoDeClasificacion(c: Clasificacion | null): string {
  if (!c) return "";
  return [c.material, c.granulometria, c.envase].filter(Boolean).join(" ");
}

/**
 * Partir el nombre que trae un many2one de Odoo: `[FAG] FILLER A GRANEL `.
 *
 * Odoo pega la referencia interna adelante del nombre y en esta base varios
 * nombres tienen un espacio de más al final —está en la base, no en la lectura—,
 * así que un `===` contra el nombre falla por un carácter invisible.
 *
 * Odoo usa `false` para todo lo ausente, nunca null: eso también entra acá.
 */
export function separarCodigoYNombre(valor: unknown): {
  codigo: string | null;
  nombre: string | null;
} {
  if (typeof valor !== "string" || valor.trim() === "") return { codigo: null, nombre: null };
  const s = valor.trim();
  const con = s.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (con) return { codigo: con[1].trim(), nombre: con[2].trim() };
  return { codigo: null, nombre: s };
}
