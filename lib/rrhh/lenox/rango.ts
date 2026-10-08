import { addUtcDays } from "../dates";

/**
 * Tope del rango que se puede pedir desde el botón.
 *
 * El cliente ya parte el rango en ventanas de 7 días, así que esto no es un
 * límite de la API: es para que un clic no gaste de golpe las llamadas que hay.
 * **Cada 7 días de rango es una llamada**, más una fija del padrón.
 *
 * 31 días son 5 ventanas más el padrón: seis llamadas. El 07/10/2026 bastaron
 * unas doce seguidas para que Lenox bloqueara la cuenta con un 429 que tardó
 * más de veinte minutos en levantarse, así que seis deja margen de verdad.
 *
 * Estuvo en 62 un rato y se bajó: eran diez llamadas, demasiado cerca del
 * límite medido. Y el caso de uso real del botón es traer **un mes**, no dos —
 * para algo más largo, se hace en dos veces.
 */
export const DIAS_MAX_RANGO = 31;

/** Los 7 días que mira el cron, contando hoy: una sola llamada de marcaciones. */
export const DIAS_DEL_CRON = 7;

/** La ventana del cron: de hace 6 días a hoy, o sea 7 días contando hoy. */
export function ventanaDelCron(hoy: Date): { desde: Date; hasta: Date } {
  return { desde: addUtcDays(hoy, -(DIAS_DEL_CRON - 1)), hasta: hoy };
}

/**
 * Revisa un rango ya parseado. Devuelve el mensaje para la pantalla, o `null`
 * si está bien.
 *
 * Que cada fecha sea una fecha de verdad lo resuelve el esquema (`z.iso.date`
 * rechaza el 30 de febrero); acá sólo queda lo que depende de las dos juntas.
 */
export function problemaDelRango(desde: Date, hasta: Date): string | null {
  if (hasta.getTime() < desde.getTime()) {
    return "La fecha de fin es anterior a la de inicio.";
  }
  const dias = Math.round((hasta.getTime() - desde.getTime()) / 86_400_000) + 1;
  if (dias > DIAS_MAX_RANGO) {
    // El mensaje dice el porqué porque si no parece un capricho, y quien lo
    // lee tiene que saber que la salida es partirlo, no insistir.
    return (
      `El rango no puede superar los ${DIAS_MAX_RANGO} días (pediste ${dias}), ` +
      "porque Lenox limita la cantidad de pedidos seguidos. Traelo en dos veces."
    );
  }
  return null;
}
