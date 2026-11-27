/**
 * Cuánto puede abarcar un pedido del calendario de órdenes, en un solo lugar.
 *
 * Son tres puntas que tienen que decidir lo mismo: `/api/mantenimiento/calendario`,
 * `/api/mantenimiento/taller-del-mes` y la hoja impresa (`urlDeImpresion.ts`).
 * La hoja arma el pedido que las dos rutas van a contestar, así que si rechaza
 * menos que ellas manda a pedir datos que vuelven con un 400 que nadie mira, y
 * si rechaza más deja fuera rangos que las rutas habrían servido.
 *
 * Hasta el 24/11/2026 el número estaba escrito tres veces —con su comentario
 * copiado— y **la comparación también**: lo que puede separarse no es sólo el
 * tope sino la expresión, que es donde un `<` se vuelve `<=` en una de las tres
 * sin que nada avise.
 *
 * ── POR QUÉ EL NÚMERO ES 63 Y NO 62 ───────────────────────────────────────
 *
 * Es la misma cuenta de siempre, dicha de la forma que se puede leer en voz
 * alta. Un mes con las semanas parciales de los bordes llega a 42 días (seis
 * semanas) y esto deja margen para quien pida dos meses corridos; más que eso
 * es un pedido que no viene de la grilla.
 *
 * Lo que cambió es **qué nombra el número**. Antes era el desplazamiento que se
 * le suma a `desde` —62—, y el mensaje de error lo imprimía tal cual: decía «no
 * puede pasar de 62 días» sobre una comprobación que aceptaba 63 contando los
 * dos extremos. Quien pedía del 1/11 al 2/1 entraba, y quien pedía un día más
 * leía un número que no era el que acababa de pasar. Ahora el número son los
 * días que entran, contados como los cuenta una persona, y el desplazamiento
 * sale de él.
 *
 * El nombre lleva «del rango» a propósito: en el repo ya hay dos
 * `MAXIMO_DE_DIAS` que son otra cosa —90 en `postergar.ts`, 93 en
 * `disponibilidadPublica.ts`—, y un tercero con el mismo nombre y otro valor es
 * cómo se confunden al leerlos de memoria.
 */
import { sumarDias } from "@/lib/core/fechas";

/** Días que puede abarcar un rango, **contando los dos extremos**. */
export const DIAS_DEL_RANGO_MAS_LARGO = 63;

/** El mensaje que lee una persona. Sale del número para que no puedan discrepar. */
export const ERROR_DE_RANGO_LARGO = `El rango no puede pasar de ${DIAS_DEL_RANGO_MAS_LARGO} días`;

/**
 * Si `desde`–`hasta` pasa el tope. Las dos fechas son `AAAA-MM-DD` y se asume
 * `desde <= hasta`: quién las valida y en qué orden es cosa de cada punta.
 */
export function elRangoEsDemasiadoLargo(desde: string, hasta: string): boolean {
  return sumarDias(desde, DIAS_DEL_RANGO_MAS_LARGO - 1) < hasta;
}
