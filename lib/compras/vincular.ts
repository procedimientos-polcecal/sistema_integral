/**
 * De dónde sale la planilla de comparativa de cada requerimiento.
 *
 * La columna de comparativa de las hojas por área muestra "LINK" y esconde el
 * hipervínculo detrás. La API de Sheets devuelve el texto visible, así que la
 * URL nunca llegó a la base: hay que sacarla de la fórmula `HYPERLINK` o del
 * hipervínculo pegado sobre el texto, según cómo la haya cargado cada uno.
 */

/**
 * La URL detrás de una celda, mirando las tres formas en que puede estar.
 *
 * La fórmula gana sobre el hipervínculo porque es más específica: si alguien
 * escribió `=HYPERLINK(...)`, ése es el destino que quiso.
 */
export function linkDeCelda(
  formula: string | null | undefined,
  hipervinculo: string | null | undefined
): string | null {
  const f = String(formula ?? "").trim();

  const enFormula = f.match(/^=\s*HYPERLINK\s*\(\s*"([^"]+)"/i);
  if (enFormula) return enFormula[1];

  if (hipervinculo && hipervinculo.trim()) return hipervinculo.trim();

  // Alguien pudo pegar la URL como texto plano.
  if (/^https?:\/\//i.test(f)) return f;

  return null;
}

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
