import type { Clasificacion, Producto } from "@/lib/core/types";
import { clasificacionPorOdoo } from "@/lib/core/productos";
import { clasificacionDelHistorico } from "./equivalenciasDelHistorico";

/**
 * Lo que Despacho hace con una clasificación, que es distinto de lo que la
 * clasificación **es**.
 *
 * El catálogo, las listas de material/granulometría/envase y cómo se resuelve un
 * producto de Odoo viven en `lib/core/productos.ts`: los comparte con
 * Producción desde que el catálogo es uno solo
 * (docs/superpowers/specs/2026-09-10-productos-catalogo-unico-design.md).
 *
 * Acá queda lo que es de este módulo y de nadie más: de dónde saca su
 * clasificación una orden de carga, y cómo se escribe la celda `Material` de la
 * planilla, que tiene la forma del libro y no la del sistema.
 */

/**
 * La clasificación de una orden, venga de donde venga.
 *
 * Dos orígenes y por eso dos caminos: una orden cargada en la balanza trae el
 * producto del remito de Odoo y se resuelve contra el catálogo; una de las 1.703
 * importadas del libro **no tiene producto de Odoo** —vino de la planilla— y se
 * resuelve contra la tabla de equivalencias por texto.
 *
 * Está acá y no repetida en las tres pantallas que clasifican porque el orden
 * importa: primero el catálogo, que es un dato, y sólo si no hay, el texto, que
 * es una interpretación. Al revés, una orden con remito quedaría clasificada por
 * lo que alguien tipeó.
 */
export function clasificacionDeLaOrden(
  orden: { odoo_product_id: number | null; producto_raw: string | null },
  catalogo: Producto[]
): Clasificacion | null {
  return (
    clasificacionPorOdoo(orden.odoo_product_id, catalogo) ??
    clasificacionDelHistorico(orden.producto_raw)
  );
}

/**
 * Cómo se escribe cada envase **en la planilla**, con su preposición.
 *
 * Sale de contar los 1.714 renglones del libro: la forma dominante es
 * "<material> <granulometría> en <envase>", salvo el granel, que va "a granel".
 * Y el bolsón va en plural —"en Bolsones" 208 veces contra "en Bolson" 9—
 * porque el camión lleva varios; la bolsa va en singular.
 */
const ENVASE_EN_LA_PLANILLA: Record<string, string> = {
  "A granel": "a granel",
  Tolva: "en Tolva",
  Bolsa: "en Bolsa",
  "Bolsón": "en Bolsones",
  Unidad: "en Unidades",
};

/** El libro escribe el #200 sin el numeral. El resto va igual. */
const GRANULOMETRIA_EN_LA_PLANILLA: Record<string, string> = { "#200": "200" };

/**
 * El texto de la columna `Material` de la planilla: `Calcio 0-2 en Bolsones`.
 *
 * **Se escribe con la forma del libro, no con la del sistema**, y eso fue una
 * decisión: la planilla la sigue leyendo gente que tiene cinco meses de historia
 * arriba, y cambiarles la forma de la celda por una más prolija de parsear no le
 * sirve a nadie. Lo que sí cambia es que de acá en más se escribe **siempre
 * igual**: hoy el libro tiene 201 textos distintos para unas quince
 * combinaciones —"Filler a granel" aparece con 23 ortografías, 640 veces entre
 * todas—, y eso deja de crecer.
 *
 * Para mostrar en pantalla se usa `textoDeClasificacion` del núcleo, que no
 * lleva preposiciones.
 */
export function textoParaLaPlanilla(c: Clasificacion | null): string {
  if (!c) return "";
  const gran = c.granulometria
    ? (GRANULOMETRIA_EN_LA_PLANILLA[c.granulometria] ?? c.granulometria)
    : null;
  const env = ENVASE_EN_LA_PLANILLA[c.envase] ?? `en ${c.envase}`;
  return [c.material, gran, env].filter(Boolean).join(" ");
}
