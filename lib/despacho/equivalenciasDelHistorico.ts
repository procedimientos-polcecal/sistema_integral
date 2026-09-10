import type { Clasificacion } from "@/lib/core/types";

/**
 * Cómo se lee la columna `Material` del histórico importado.
 *
 * LAS 1.703 ÓRDENES DEL LIBRO NO TIENEN PRODUCTO DE ODOO. Vinieron de la
 * planilla, así que `odoo_product_id` está en null en todas, y `clasificacionDe`
 * —que mapea por producto de Odoo contra `despacho_productos`— no las iba a
 * poder clasificar nunca: arrancaron y se quedaban todas "sin clasificar". Las
 * que se cargan desde la balanza no tienen el problema, porque traen el
 * producto del remito.
 *
 * ASÍ QUE ESTO ES LA TABLA POR TEXTO QUE PEDÍA docs/DESPACHO.md. El libro
 * escribe el material a mano y tiene **201 textos distintos para 36
 * combinaciones**: `Filler a granel` aparece en 23 ortografías —`filller`,
 * `filkler`, `fiuller`, `Fller`, `filoler`— y suma 640 órdenes. Es una tabla y
 * no una expresión regular por la misma razón que `despacho_productos`:
 * enlazar al que se le parece es peor que dejar en null, porque el dato aparece
 * en el lugar que no es y no se nota nunca.
 *
 * **Está congelada y no va a crecer.** El histórico está cerrado: de acá en más
 * manda el sistema, que escribe la columna con una sola ortografía
 * (`textoParaLaPlanilla`). Estas 161 claves son todo lo que el libro llegó a
 * tener, con el texto **exacto** como quedó en la base —espacios dobles
 * incluidos, que por eso hay entradas casi iguales—. No hay normalización en el
 * medio a propósito: una función que "arregla" el texto antes de buscarlo es
 * una decisión invisible más, y acá lo que se revisa es qué se convierte en qué.
 *
 * LAS 54 ÓRDENES QUE QUEDAN AFUERA están en docs/DESPACHO.md con su motivo. En
 * resumen: 11 traen dos granulometrías, 9 dos materiales y 1 dos envases —una
 * sola clasificación no las puede representar—, 8 no nombran un producto
 * (`Arena`, `muestra`, `binder`, `3 rollos de membrana`, `10 bolsas`), 13
 * vienen vacías, y 12 son erratas que se entienden pero que quedaron para que
 * las confirme una persona antes de escribirlas.
 *
 * DOS SE SACARON A MANO DESPUÉS DE MIRARLAS: `cal #200 en bolson` y
 * `Cal 02 en Bolson`, una orden cada una. En las ~516 órdenes de Cal del libro
 * la Cal **nunca** lleva granulometría, y `cal` y `calcio` están a una letra:
 * `Calcio 0-2 en bolsón` tiene 135 precedentes y esto uno. Puede ser un
 * producto raro o puede ser una letra que falta, y no hay forma de saberlo
 * desde acá — que es la definición de dejar en null.
 *
 * LO QUE SÍ SE PIERDE, DICHO: las ~18 órdenes de `Cal en Bolsa guemes` y
 * `Cal moreno en Bolsa` entran como Cal en Bolsa y la marca de la bolsa se cae.
 * El material y el envase son los correctos; la marca no es ninguno de los tres
 * campos del talonario, así que no tiene dónde ir. Si esa marca importa, es una
 * columna, no una clasificación.
 */
const c = (
  material: string,
  granulometria: string | null,
  envase: string
): Clasificacion => ({ material, granulometria, envase });

/** Texto exacto de la planilla -> clasificación. El número es cuántas órdenes lo usan. */
export const EQUIVALENCIAS_DEL_HISTORICO: Record<string, Clasificacion> = {
  // Filler A granel - 640 ordenes en 23 escrituras
  "Filler a granel": c("Filler", null, "A granel"), // 331
  "filler a granel": c("Filler", null, "A granel"), // 256
  "filller a granel": c("Filler", null, "A granel"), // 10
  "filer a granel": c("Filler", null, "A granel"), // 10
  "filler agranel": c("Filler", null, "A granel"), // 8
  "filkler a granel": c("Filler", null, "A granel"), // 3
  "fillerb a granel": c("Filler", null, "A granel"), // 2
  "Flller a granel": c("Filler", null, "A granel"), // 2
  "filler a  granel": c("Filler", null, "A granel"), // 2
  "filler  a granel": c("Filler", null, "A granel"), // 2
  "fiuller a granel": c("Filler", null, "A granel"), // 2
  "FILLER A GRANEL": c("Filler", null, "A granel"), // 1
  "Fller a granel": c("Filler", null, "A granel"), // 1
  "Filler A granel": c("Filler", null, "A granel"), // 1
  "filoler a granel": c("Filler", null, "A granel"), // 1
  "Filler a Granel": c("Filler", null, "A granel"), // 1
  "Filler  granel": c("Filler", null, "A granel"), // 1
  "filler a ggranel": c("Filler", null, "A granel"), // 1
  "Fille a granel": c("Filler", null, "A granel"), // 1
  "fiiler agranel": c("Filler", null, "A granel"), // 1
  "fillera granel": c("Filler", null, "A granel"), // 1
  "fiiler a granel": c("Filler", null, "A granel"), // 1
  "fillere a granel": c("Filler", null, "A granel"), // 1

  // Cal Bolsón - 363 ordenes en 18 escrituras
  "Cal en Bolsones": c("Cal", null, "Bolsón"), // 207
  "cal en bolson": c("Cal", null, "Bolsón"), // 64
  "cal en bolsones": c("Cal", null, "Bolsón"), // 47
  "Cal en bolsones": c("Cal", null, "Bolsón"), // 20
  "Cal en Bolson": c("Cal", null, "Bolsón"), // 4
  "cal en Bolsones": c("Cal", null, "Bolsón"), // 3
  "Cal Bolsones": c("Cal", null, "Bolsón"), // 3
  "cal enn bolson": c("Cal", null, "Bolsón"), // 3
  "Cal En Bolsones": c("Cal", null, "Bolsón"), // 2
  "cal en bolosn": c("Cal", null, "Bolsón"), // 2
  "Cal en bolson": c("Cal", null, "Bolsón"), // 1
  "Cal en Bolsone": c("Cal", null, "Bolsón"), // 1
  "Cal e Bolsones": c("Cal", null, "Bolsón"), // 1
  "cal en bolsonbes": c("Cal", null, "Bolsón"), // 1
  "cal en  bolsones": c("Cal", null, "Bolsón"), // 1
  "cal en bollson": c("Cal", null, "Bolsón"), // 1
  "cal en bolosnes": c("Cal", null, "Bolsón"), // 1
  "CAl en bolsones": c("Cal", null, "Bolsón"), // 1

  // Filler Tolva - 150 ordenes en 4 escrituras
  "Filler en Tolva": c("Filler", null, "Tolva"), // 116
  "Filler en tolva": c("Filler", null, "Tolva"), // 32
  "Filler el tolva": c("Filler", null, "Tolva"), // 1
  "Fiiller en tolva": c("Filler", null, "Tolva"), // 1

  // Calcio 0-2 Bolsón - 135 ordenes en 13 escrituras
  "calcio 0-2 en bolson": c("Calcio", "0-2", "Bolsón"), // 57
  "Calcio 02 en Bolsones": c("Calcio", "0-2", "Bolsón"), // 52
  "Calcio 02 en Bolson": c("Calcio", "0-2", "Bolsón"), // 9
  "Calcio 02 en bolsones": c("Calcio", "0-2", "Bolsón"), // 5
  "Calcio 02 en bolson": c("Calcio", "0-2", "Bolsón"), // 2
  "Calcio 02  en Bolsones": c("Calcio", "0-2", "Bolsón"), // 2
  "calciuo 0-2 en bolson": c("Calcio", "0-2", "Bolsón"), // 2
  "Calcio 0-2 en Bolsones": c("Calcio", "0-2", "Bolsón"), // 1
  "Calcio 02  en Bolson": c("Calcio", "0-2", "Bolsón"), // 1
  "calkcio 0-2 en bolson": c("Calcio", "0-2", "Bolsón"), // 1
  "calcio 02 en Bolsones": c("Calcio", "0-2", "Bolsón"), // 1
  "calcio 0-2 en bolosn": c("Calcio", "0-2", "Bolsón"), // 1
  "calcio 0-2 en bolsones": c("Calcio", "0-2", "Bolsón"), // 1

  // Cal Bolsa - 91 ordenes en 14 escrituras
  "cal en bolsa": c("Cal", null, "Bolsa"), // 36
  "Cal en Bolsa": c("Cal", null, "Bolsa"), // 31
  "Cal en Bolsa guemes": c("Cal", null, "Bolsa"), // 7
  "Cal Bolsa guemes": c("Cal", null, "Bolsa"), // 6
  "Cal en bolsa guemes": c("Cal", null, "Bolsa"), // 2
  "Cal en Bolsa moreno": c("Cal", null, "Bolsa"), // 1
  "Cal en Bolsa Guemes": c("Cal", null, "Bolsa"), // 1
  "cal en Bolsa": c("Cal", null, "Bolsa"), // 1
  "Cal Bolsa guemees": c("Cal", null, "Bolsa"), // 1
  "cal en bolsaon": c("Cal", null, "Bolsa"), // 1
  "CAL EN BOLSA": c("Cal", null, "Bolsa"), // 1
  "Cal bolsa guemes": c("Cal", null, "Bolsa"), // 1
  "Cal moreno en Bolsa": c("Cal", null, "Bolsa"), // 1
  "Cal en bolsa": c("Cal", null, "Bolsa"), // 1

  // Cal A granel - 47 ordenes en 5 escrituras
  "Cal a granel": c("Cal", null, "A granel"), // 29
  "cal a granel": c("Cal", null, "A granel"), // 13
  "Cal a Granel": c("Cal", null, "A granel"), // 3
  "cal en granel": c("Cal", null, "A granel"), // 1
  "Cal  a granel": c("Cal", null, "A granel"), // 1

  // Calcio 0-1 Bolsón - 36 ordenes en 7 escrituras
  "Calcio 01 en Bolsones": c("Calcio", "0-1", "Bolsón"), // 18
  "calcio 0-1 en bolson": c("Calcio", "0-1", "Bolsón"), // 11
  "calcio 0-1 bolson": c("Calcio", "0-1", "Bolsón"), // 3
  "Calcio 0-1 en Bolsones": c("Calcio", "0-1", "Bolsón"), // 1
  "Calcio 01  en Bolsones": c("Calcio", "0-1", "Bolsón"), // 1
  "calcio 01/2 en bolson": c("Calcio", "0-1", "Bolsón"), // 1
  "Calcio 01 en bolsones": c("Calcio", "0-1", "Bolsón"), // 1

  // Calcio #200 Bolsón - 20 ordenes en 9 escrituras
  "Calcio 200 en Bolsones": c("Calcio", "#200", "Bolsón"), // 7
  "calcio #200 en bolson": c("Calcio", "#200", "Bolsón"), // 4
  "calcio 200 en bolson": c("Calcio", "#200", "Bolsón"), // 2
  "calcio #200 en bolosn": c("Calcio", "#200", "Bolsón"), // 2
  "Calcio #200 en Bolsones": c("Calcio", "#200", "Bolsón"), // 1
  "Calcio 200  en Bolson": c("Calcio", "#200", "Bolsón"), // 1
  "Calcio 200 en Bolsnes": c("Calcio", "#200", "Bolsón"), // 1
  "Calcio 200  en Bolsones": c("Calcio", "#200", "Bolsón"), // 1
  "calcio 200 EN BOLSON": c("Calcio", "#200", "Bolsón"), // 1

  // Dolomita 0-2 Bolsón - 20 ordenes en 4 escrituras
  "Dolomita 02 en Bolsones": c("Dolomita", "0-2", "Bolsón"), // 17
  "dolomita 02 en Bolsones": c("Dolomita", "0-2", "Bolsón"), // 1
  "Dolomita 02 Bolsones": c("Dolomita", "0-2", "Bolsón"), // 1
  "Dolomiita 02 en Bolsones": c("Dolomita", "0-2", "Bolsón"), // 1

  // Calcio 1-2 Bolsón - 17 ordenes en 6 escrituras
  "calcio 1/2 en bolson": c("Calcio", "1-2", "Bolsón"), // 7
  "Calcio 1-2 en Bolsones": c("Calcio", "1-2", "Bolsón"), // 5
  "Calcio 1/2/ en Bolsones": c("Calcio", "1-2", "Bolsón"), // 2
  "Calcio 1/2 en Bolson": c("Calcio", "1-2", "Bolsón"), // 1
  "Calcio 1/2 en Bolsones": c("Calcio", "1-2", "Bolsón"), // 1
  "calcio 1-2 en bolson": c("Calcio", "1-2", "Bolsón"), // 1

  // Cal Tolva - 15 ordenes en 4 escrituras
  "cal en tolva": c("Cal", null, "Tolva"), // 12
  "Cal en Tolva": c("Cal", null, "Tolva"), // 1
  "Cal en tolva": c("Cal", null, "Tolva"), // 1
  "CAL EN TOLVA": c("Cal", null, "Tolva"), // 1

  // Dolomita A granel - 15 ordenes en 2 escrituras
  "Dolomita a granel": c("Dolomita", null, "A granel"), // 13
  "dolomita a granel": c("Dolomita", null, "A granel"), // 2

  // Calcio 0-2 A granel - 14 ordenes en 4 escrituras
  "Calcio 02 a granel": c("Calcio", "0-2", "A granel"), // 8
  "calcio 0-2 a granel": c("Calcio", "0-2", "A granel"), // 4
  "Calcio 02  a granel": c("Calcio", "0-2", "A granel"), // 1
  "calcio 0-2 ea granel": c("Calcio", "0-2", "A granel"), // 1

  // Calcio 0-1 A granel - 11 ordenes en 3 escrituras
  "Calcio 01 a granel": c("Calcio", "0-1", "A granel"), // 6
  "calcio 0-1 a granel": c("Calcio", "0-1", "A granel"), // 4
  "Calcio 01  a granel": c("Calcio", "0-1", "A granel"), // 1

  // Calcio 0-2 Bolsa - 9 ordenes en 2 escrituras
  "Calcio 02 en Bolsa": c("Calcio", "0-2", "Bolsa"), // 5
  "calcio 0-2 en bolsa": c("Calcio", "0-2", "Bolsa"), // 4

  // Calcio #200 Bolsa - 8 ordenes en 6 escrituras
  "Calcio 200 en Bolsa": c("Calcio", "#200", "Bolsa"), // 2
  "calcio 200 en bolsa": c("Calcio", "#200", "Bolsa"), // 2
  "Calcio 200 bolsa": c("Calcio", "#200", "Bolsa"), // 1
  "Calcio 200 Bolsa": c("Calcio", "#200", "Bolsa"), // 1
  "calcio #200 en bolsa": c("Calcio", "#200", "Bolsa"), // 1
  "Calcio 200 en bolsa": c("Calcio", "#200", "Bolsa"), // 1

  // Dolomita #200 Bolsón - 7 ordenes en 3 escrituras
  "Dolomita 200 en Bolsones": c("Dolomita", "#200", "Bolsón"), // 5
  "Dolomita 200  en bolsones": c("Dolomita", "#200", "Bolsón"), // 1
  "Dolomita 200  en Bolson": c("Dolomita", "#200", "Bolsón"), // 1

  // Magnesio 0-2 Bolsón - 6 ordenes en 3 escrituras
  "magnesio 02 en bolson": c("Magnesio", "0-2", "Bolsón"), // 2
  "magnesio 0-2 bolsones": c("Magnesio", "0-2", "Bolsón"), // 2
  "magnesio 0-2 en bolson": c("Magnesio", "0-2", "Bolsón"), // 2

  // Magnesio #200 Bolsa - 6 ordenes en 3 escrituras
  "magnesio 200 en bolsa": c("Magnesio", "#200", "Bolsa"), // 3
  "magnesio #200 en bolsa": c("Magnesio", "#200", "Bolsa"), // 2
  "Magnesio 200 bolsa": c("Magnesio", "#200", "Bolsa"), // 1

  // Calcio #200 A granel - 6 ordenes en 2 escrituras
  "Calcio 200 a granel": c("Calcio", "#200", "A granel"), // 5
  "calcio #200 a granel": c("Calcio", "#200", "A granel"), // 1

  // Magnesio A granel - 5 ordenes en 1 escrituras
  "magnesio a granel": c("Magnesio", null, "A granel"), // 5

  // Dolomita #200 Bolsa - 5 ordenes en 4 escrituras
  "Dolomita 200 en Bolsa": c("Dolomita", "#200", "Bolsa"), // 2
  "Dolomita 200 en bolsa": c("Dolomita", "#200", "Bolsa"), // 1
  "dolomita 200 en Bolsa": c("Dolomita", "#200", "Bolsa"), // 1
  "Dolomita 200 en Bolsa 5 Bolsas": c("Dolomita", "#200", "Bolsa"), // 1

  // Filler Bolsón - 5 ordenes en 4 escrituras
  "Filler en Bolsones": c("Filler", null, "Bolsón"), // 2
  "Filler en Bolson": c("Filler", null, "Bolsón"), // 1
  "filler en bolsones": c("Filler", null, "Bolsón"), // 1
  "filler en bolson": c("Filler", null, "Bolsón"), // 1

  // Magnesio #200 Bolsón - 3 ordenes en 2 escrituras
  "magnesio 200 en bolson": c("Magnesio", "#200", "Bolsón"), // 2
  "magnesio #200 en bolson": c("Magnesio", "#200", "Bolsón"), // 1

  // Calcio A granel - 3 ordenes en 2 escrituras
  "Calcio a granel": c("Calcio", null, "A granel"), // 2
  "calcio a granel": c("Calcio", null, "A granel"), // 1

  // Dolomita Bolsa - 3 ordenes en 3 escrituras
  "600 Bolsas dolomita": c("Dolomita", null, "Bolsa"), // 1
  "Dolomita en Bolsa 15 bolsas": c("Dolomita", null, "Bolsa"), // 1
  "Dolomita en Bolsa": c("Dolomita", null, "Bolsa"), // 1

  // Filler #200 A granel - 2 ordenes en 1 escrituras
  "filler #200 a granel": c("Filler", "#200", "A granel"), // 2

  // Magnesio 0-2 A granel - 1 ordenes en 1 escrituras
  "Magnesio 02 a granel": c("Magnesio", "0-2", "A granel"), // 1

  // Calcio Bolsón - 1 ordenes en 1 escrituras
  "calcio en bolson": c("Calcio", null, "Bolsón"), // 1

  // Magnesio #200 A granel - 1 ordenes en 1 escrituras
  "magnesio #200 a granel": c("Magnesio", "#200", "A granel"), // 1

  // Calcio Bolsa - 1 ordenes en 1 escrituras
  "Bolsas calcio": c("Calcio", null, "Bolsa"), // 1

  // Calcio #200 Tolva - 1 ordenes en 1 escrituras
  "Calcio 200 en Tolva": c("Calcio", "#200", "Tolva"), // 1

  // Dolomita 0-2 Bolsa - 1 ordenes en 1 escrituras
  "Dolomita 02 en Bolsa": c("Dolomita", "0-2", "Bolsa"), // 1

  // Calcio 1-2 A granel - 1 ordenes en 1 escrituras
  "calcio 1/2  a granel": c("Calcio", "1-2", "A granel"), // 1

};

/**
 * La clasificación de una orden importada, por el texto crudo de la planilla.
 *
 * Devuelve null para lo que no está en la tabla, que es lo que corresponde: la
 * pantalla muestra "sin clasificar" y la planilla sigue recibiendo el texto
 * crudo (`filaDeLaPlanilla`), que a quien la lee le dice algo.
 */
export function clasificacionDelHistorico(
  productoRaw: string | null | undefined
): Clasificacion | null {
  if (!productoRaw) return null;
  return EQUIVALENCIAS_DEL_HISTORICO[productoRaw] ?? null;
}
