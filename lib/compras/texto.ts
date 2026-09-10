/**
 * Normalización de textos que vienen de la planilla.
 *
 * Los encabezados y los valores llegan con acentos, grados, puntos y espacios
 * de más según quién los escribió. Comparar sin normalizar es la fuente más
 * común de "esa columna no existe" cuando existe.
 */
export const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toUpperCase().replace(/[°º.]/g, "").replace(/\s+/g, " ");

/**
 * Un motivo de la planilla, recortado para que entre en un cartel.
 *
 * Los motivos del alta llevan el mensaje de Google **sin traducir**, y ése puede
 * ser un párrafo con una URL de activación de la API adentro: doscientos
 * caracteres sin un solo espacio. En el bloque ámbar del formulario eso son diez
 * renglones que tapan el resto de la pantalla, y como no corta, además rompe el
 * ancho del bloque.
 *
 * Se recorta **sólo para la pantalla**. El texto completo queda en
 * `sheets_pendiente`, que es de donde lo lee /compras/configuracion cuando hay
 * que ir a mirar de verdad: recortar lo que se guarda sería perder el
 * diagnóstico, que es exactamente lo que el módulo no permite.
 */
export function recortarParaPantalla(motivo: unknown, maximo = 240): string {
  const limpio = String(motivo ?? "").replace(/\s+/g, " ").trim();
  if (limpio.length <= maximo) return limpio;

  // Se corta en el último espacio para no partir una palabra al medio, salvo
  // que ese espacio esté tan al principio que el recorte pierda casi todo — el
  // caso de un mensaje que es una sola URL larga, donde conviene cortar seco.
  const duro = limpio.slice(0, maximo);
  const espacio = duro.lastIndexOf(" ");
  return (espacio > maximo * 0.6 ? duro.slice(0, espacio) : duro) + "…";
}
