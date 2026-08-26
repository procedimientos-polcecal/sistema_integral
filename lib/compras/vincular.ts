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
