/**
 * El worker de pdf.js no trae tipos, y hay que importarlo igual.
 *
 * `pdfjs-dist` declara `pdf.mjs` pero no `pdf.worker.mjs`, porque del lado del
 * navegador nadie lo importa: se le pasa una URL. En el servidor sí se importa
 * —ver `lib/facturacion/textoDelPdfEnElServidor.ts`, que lo deja en
 * `globalThis.pdfjsWorker` para que la librería no intente resolverlo sola
 * dentro de los chunks de Next—, así que sin esta declaración `tsc` corta el
 * build con un TS7016.
 *
 * Queda como `unknown` a propósito: de este módulo no se usa nada, sólo se lo
 * deja puesto. Tiparlo de más sería inventar una forma que no se verifica.
 */
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  const worker: unknown;
  export default worker;
}
