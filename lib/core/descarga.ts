/**
 * La cabecera con la que el navegador guarda un archivo.
 *
 * Parece un detalle y no lo es: el primer archivo que el sistema hace bajar
 * —el PDF de la orden de compra de Odoo— se llama `Solicitud de cotización -
 * P02429.pdf`, o sea **con acentos y con espacios**. Un `Content-Disposition`
 * armado a mano con ese nombre se rompe de dos formas distintas:
 *
 * - Las cabeceras HTTP son latin-1. Un nombre con `ó` en el `filename=` común
 *   llega mojibake (`cotizaciÃ³n`) o hace que el runtime rechace la respuesta.
 * - Una comilla doble en el nombre cierra el valor antes de tiempo y el resto
 *   se interpreta como otro parámetro.
 *
 * La forma correcta es la de la RFC 6266: `filename=` con una versión sin
 * acentos, para el navegador viejo, **y** `filename*=UTF-8''…` percent-encoded,
 * que es la que todos los navegadores actuales prefieren.
 */

/** Lo que se puede dejar tal cual en un `filename=` sin comillas problemáticas. */
const SIN_ACENTOS: Record<string, string> = {
  á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n",
  Á: "A", É: "E", Í: "I", Ó: "O", Ú: "U", Ü: "U", Ñ: "N",
};

/**
 * El nombre reducido a ASCII, para el `filename=` de respaldo.
 *
 * Los acentos se transliteran en vez de borrarse —`cotización` da `cotizacion`,
 * no `cotizacin`—. Lo que no se puede transliterar se reemplaza por `_`: un
 * nombre con un carácter perdido sigue sirviendo para guardar el archivo, y un
 * nombre vacío no.
 */
export function nombreAscii(nombre: string): string {
  const sinAcentos = [...nombre].map((c) => SIN_ACENTOS[c] ?? c).join("");

  // Se van las comillas y las barras (cierran el valor o confunden la ruta) y
  // todo lo que no sea ASCII imprimible.
  const limpio = sinAcentos.replace(/["\\/\r\n]/g, "_").replace(/[^\x20-\x7E]/g, "_");

  return limpio.trim() || "archivo";
}

/**
 * El valor completo del `Content-Disposition` para hacer bajar un archivo.
 *
 * `attachment` y no `inline`: esto es un documento que se guarda, no una página
 * que se mira dentro del sistema.
 */
export function cabeceraDeDescarga(nombre: string): string {
  return `attachment; filename="${nombreAscii(nombre)}"; filename*=UTF-8''${encodeURIComponent(
    nombre
  )}`;
}
