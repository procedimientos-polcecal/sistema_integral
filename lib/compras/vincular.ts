/**
 * De dónde sale la planilla de comparativa de cada requerimiento.
 *
 * La columna de comparativa de las hojas por área muestra "LINK" y esconde el
 * hipervínculo detrás. La API de Sheets devuelve el texto visible, así que la
 * URL nunca llegó a la base: hay que sacarla de la fórmula `HYPERLINK` o del
 * hipervínculo pegado sobre el texto, según cómo la haya cargado cada uno.
 */

// `linkDeCelda` vive en core: la usan Compras y Mantenimiento por igual.
export { linkDeCelda } from "@/lib/core/links";

/** El id del archivo dentro de un link de Google. `null` si no hay ninguno. */
export function idDePlanilla(url: string | null | undefined): string | null {
  const s = String(url ?? "").trim();
  if (!s) return null;

  const enRuta = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (enRuta) return enRuta[1];

  const enQuery = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (enQuery) return enQuery[1];

  return null;
}

/**
 * El link para abrir una planilla a partir de su id.
 *
 * Vive acá y no en drive.ts porque lo usa también la pantalla, y drive.ts
 * arrastra el JWT y las variables de entorno: no puede entrar a un componente
 * cliente.
 */
export const urlDePlanilla = (fileId: string) =>
  `https://docs.google.com/spreadsheets/d/${fileId}`;

/**
 * A qué planilla apunta cada requerimiento, y cuáles no apuntan a ninguna.
 *
 * La celda de comparativa esconde un link cualquiera: casi siempre una planilla
 * de la carpeta, pero también hay doce que llevan a una publicación de
 * MercadoLibre o a un PDF de Drive. De esas no se puede sacar un
 * `comparativa_drive_id`, así que se cuentan aparte en vez de perderse: quien
 * mira la sincronización tiene que poder saber que hay links que el sistema no
 * va a poder abrir como comparativa.
 *
 * Es una función aparte y no dos líneas dentro de la sincronización porque es
 * la regla que decide qué llega a la base, y esa se prueba.
 */
export function planillasPorRi(links: Map<number, string>): {
  ids: Map<number, string>;
  sinPlanilla: number[];
} {
  const ids = new Map<number, string>();
  const sinPlanilla: number[] = [];

  for (const [nroRi, link] of links) {
    const id = idDePlanilla(link);
    if (id) ids.set(nroRi, id);
    else sinPlanilla.push(nroRi);
  }

  return { ids, sinPlanilla };
}

/** Qué sabe el sistema de un requerimiento que la planilla enlazó. */
export interface RiDeUnArchivo {
  /** Si ya tiene guardado ESTE archivo como su comparativa. */
  yaVinculado: boolean;
  /**
   * Si ese archivo ya se abrió para este requerimiento.
   *
   * Se sabe por `comparativa_nombre`: el nombre sale de adentro del archivo, así
   * que tenerlo es la prueba de que se leyó. La sincronización enlaza por el
   * link de la celda y no abre nada, así que deja el nombre en null: eso es
   * justo lo que queda por hacer acá.
   */
  yaLeido: boolean;
}

/**
 * Qué archivos le quedan por procesar a la vinculación en tanda.
 *
 * Sin esto la tanda no avanzaba: con `filas=1` —que es lo que manda el botón de
 * Configuración— el filtro dejaba pasar TODOS los archivos, así que cada vez se
 * releían los mismos veinte primeros y el "quedan N planillas" no bajaba nunca.
 * Los 219 archivos de la planilla se terminan en once tandas; sin arreglar
 * esto, en ninguna cantidad de tandas.
 *
 * Un archivo queda por hacer si alguno de sus requerimientos todavía no lo tiene
 * vinculado, o —cuando además se piden las filas— si a alguno todavía no se le
 * abrió. El corte es "ya se leyó" y no "ya tiene presupuestos": una planilla
 * puede no tener ninguna fila de ese RI, y con esa condición esos archivos
 * quedarían pendientes para siempre, ocupando la tanda y volviendo a tapar la
 * cola. Es el mismo error de antes con otra cara.
 */
export function archivosPorHacer<T extends RiDeUnArchivo>(
  porArchivo: Map<string, T[]>,
  traerFilas: boolean
): [string, T[]][] {
  return [...porArchivo.entries()].filter(([, ris]) =>
    ris.some((r) => !r.yaVinculado || (traerFilas && !r.yaLeido))
  );
}

/**
 * A dónde abre la comparativa de un requerimiento, si abre a alguna parte.
 *
 * Manda el id del archivo, que es el vínculo bueno. `comparativa_url` queda de
 * segunda y sólo si de verdad es una dirección: durante meses esa columna
 * guardó el texto visible de la celda de la planilla, que dice "LINK", y las
 * pantallas lo ponían igual en un `href`. En 1.905 requerimientos el link de la
 * comparativa llevaba a `/compras/requerimientos/LINK`.
 *
 * Devuelve null cuando no hay nada que abrir, para que la pantalla no muestre
 * un enlace que no lleva a ninguna parte.
 */
export function linkDeLaComparativa(r: {
  comparativa_drive_id?: string | null;
  comparativa_url?: string | null;
}): string | null {
  if (r.comparativa_drive_id) return urlDePlanilla(r.comparativa_drive_id);
  const url = String(r.comparativa_url ?? "").trim();
  return /^https?:\/\//i.test(url) ? url : null;
}
