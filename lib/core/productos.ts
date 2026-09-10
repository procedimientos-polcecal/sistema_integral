import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "./paginado";
import type { Clasificacion, Producto } from "./types";

/**
 * El catálogo de lo que la planta produce y despacha.
 *
 * Spec: docs/superpowers/specs/2026-09-10-productos-catalogo-unico-design.md
 *
 * **La identidad de un producto es su producto de Odoo, no su terna.** Eso se
 * midió antes de decidirlo: tres productos distintos comparten
 * (Cal, —, Bolsón) —`CAL EN BOLSONES CUV 65-70` con 362 líneas de remito,
 * `PUESTA EN DESTINO` con 268 y `CUV 55-60` con 16—, o sea 646 líneas, el 23%
 * de todo lo que sale. Con la terna como clave caían en una sola fila, y CUV
 * 65-70 contra 55-60 es una especificación de calidad, no una ortografía.
 *
 * Así que material, granulometría y envase son una **clasificación encima** de
 * la identidad, y puede faltar entera: el producto más despachado de todos
 * —`MINERALES ECOLOGICOS`, 379 líneas— no tiene terna posible, igual que
 * `BINDER` y `TOSCA`. Un producto sin clasificar se muestra con su nombre de
 * Odoo, que es un estado válido y visible, no un dato faltante.
 *
 * ESTO VIVE EN EL NÚCLEO porque lo comparten Producción y Despacho, que antes
 * tenían un catálogo cada uno —`produccion_productos` y `despacho_productos`—
 * con dos vocabularios y **grano distinto**: la `familia` `0_2` de Producción no
 * dice el material, y en el libro de Despacho `Calcio 0-2 en Bolsón` son 135
 * órdenes y `Dolomita 0-2 en Bolsón` 20. Dos cosas que ese vocabulario contaba
 * juntas.
 */

/**
 * Los materiales, las granulometrías y los envases.
 *
 * LAS LISTAS VIVEN ACÁ Y NO EN UN ENUM DE POSTGRES. Un valor de enum nuevo
 * obliga a una migración sola por valor (`55P04`, la trampa que ya mordió dos
 * veces) y estas listas crecen cada vez que se mapea un producto nuevo: el papel
 * dice cuatro materiales y el relevamiento de Odoo encontró Chocolata,
 * Pedregullo 6/20, Minerales Ecológicos y Aditivo Calcáreo. Agregar uno acá es
 * una línea.
 *
 * La contra, que hay que saber: **la base no rechaza un valor inventado**. Las
 * columnas son `text`. Por eso las rutas validan contra estas listas antes de
 * escribir — si no, un typo entra y aparece como un material nuevo en los
 * filtros.
 */
export const MATERIALES = [
  "Cal",
  "Calcio",
  "Magnesio",
  "Filler",
  "Dolomita",
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
 * en toneladas —`Cal Bolsa Moreno (UNIDAD)`, `Carbonato de Calcio 0-2 Bolsa
 * (NA) (UNIDAD)`—.
 */
export const ENVASES = ["Bolsa", "Bolsón", "A granel", "Tolva", "Unidad"] as const;

/**
 * La clasificación de una fila del catálogo, o null si nadie la cargó.
 *
 * **Los tres o ninguno.** La base lo garantiza con un `check`
 * (`productos_clasificacion_entera`) y acá se lee igual: si falta el material o
 * el envase, no hay clasificación. Media clasificación no es un dato
 * incompleto; es uno que filtra mal y no se nota.
 */
export function clasificacionDelProducto(producto: Producto): Clasificacion | null {
  if (!producto.material || !producto.envase) return null;
  return {
    material: producto.material,
    granulometria: producto.granulometria,
    envase: producto.envase,
  };
}

/**
 * La clasificación que le corresponde a un producto de Odoo.
 *
 * No mira `activo`: eso saca al producto del desplegable de la pantalla de
 * mapeo, no le borra la clasificación a las órdenes que ya lo usaron. Una orden
 * de hace un año sigue siendo de Cal en tolva. Los cinco productos que Odoo
 * tiene archivados entran al catálogo inactivos justamente por esto: un remito
 * viejo los sigue nombrando.
 */
export function clasificacionPorOdoo(
  odooProductId: number | null | undefined,
  catalogo: Producto[]
): Clasificacion | null {
  if (odooProductId === null || odooProductId === undefined) return null;
  const p = catalogo.find((x) => x.odoo_product_id === odooProductId);
  return p ? clasificacionDelProducto(p) : null;
}

/** El producto del catálogo que corresponde a un producto de Odoo, o null. */
export function productoPorOdoo(
  odooProductId: number | null | undefined,
  catalogo: Producto[]
): Producto | null {
  if (odooProductId === null || odooProductId === undefined) return null;
  return catalogo.find((x) => x.odoo_product_id === odooProductId) ?? null;
}

/**
 * Los tres campos en una línea: `Calcio 0-1 Bolsón`.
 *
 * Sin clasificación devuelve vacío y no una etiqueta inventada: quien llama
 * decide si muestra "sin clasificar" o el nombre del producto de Odoo.
 */
export function textoDeClasificacion(c: Clasificacion | null): string {
  if (!c) return "";
  return [c.material, c.granulometria, c.envase].filter(Boolean).join(" ");
}

/** Qué está mal en una clasificación que llega de una ruta, o null si está bien. */
export interface ClasificacionQueLlega {
  material?: unknown;
  granulometria?: unknown;
  envase?: unknown;
}

/**
 * Valida lo que llega antes de escribirlo, y devuelve el mensaje del problema.
 *
 * Existe del lado del código porque las columnas son `text` y la base acepta
 * cualquier cosa; y existe **además** del `check` de la base porque un 400 con
 * el motivo es mejor que un 23514 que la pantalla no sabe explicar.
 *
 * El "los tres o ninguno" se comprueba sobre lo que va a quedar, no sobre lo que
 * vino: un PATCH que manda sólo el envase de un producto sin material dejaría
 * media clasificación, y ése es justo el caso que el `check` rechaza.
 */
export function problemaDeClasificacion(
  llega: ClasificacionQueLlega,
  actual?: Clasificacion | null
): string | null {
  const material = valorFinal(llega.material, actual?.material);
  const envase = valorFinal(llega.envase, actual?.envase);
  const granulometria = valorFinal(llega.granulometria, actual?.granulometria);

  if (material !== null && !MATERIALES.includes(material as (typeof MATERIALES)[number])) {
    return `Material inválido. Son: ${MATERIALES.join(", ")}`;
  }
  if (envase !== null && !ENVASES.includes(envase as (typeof ENVASES)[number])) {
    return `Envase inválido. Son: ${ENVASES.join(", ")}`;
  }
  if (
    granulometria !== null &&
    !GRANULOMETRIAS.includes(granulometria as (typeof GRANULOMETRIAS)[number])
  ) {
    return `Granulometría inválida. Son: ${GRANULOMETRIAS.join(", ")}`;
  }

  if ((material === null) !== (envase === null)) {
    return "La clasificación va entera o vacía: material y envase juntos.";
  }
  if (granulometria !== null && material === null) {
    return "Una granulometría sin material no es una clasificación.";
  }
  return null;
}

/** Un texto que llega: vacío es null, y lo que no vino no cambia lo que había. */
function valorFinal(llega: unknown, actual: string | null | undefined): string | null {
  if (llega === undefined) return actual ?? null;
  if (typeof llega !== "string") return null;
  const s = llega.trim();
  return s === "" ? null : s;
}

/** Las columnas del catálogo. Literal: partida en dos, Supabase pierde los tipos. */
const COLUMNAS =
  "id, odoo_product_id, odoo_default_code, nombre, material, granulometria, envase, kg_por_unidad, activo";

/**
 * El catálogo entero, para resolver clasificaciones sin ir de a una.
 *
 * Con `traerTodo` porque crece: arranca en 49 —los que salieron en 180 días— y
 * se suma uno cada vez que un remito trae un producto que no estaba. `.limit()`
 * devolvería 1000 sin avisar.
 */
export async function traerCatalogoDeProductos(
  supabase: SupabaseClient
): Promise<Producto[]> {
  return traerTodo<Producto>((desde, hasta) =>
    supabase.from("productos").select(COLUMNAS).order("nombre").range(desde, hasta)
  );
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
