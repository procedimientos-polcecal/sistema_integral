import { ErrorDeLenox } from "./cliente";

/**
 * ¿Lenox rechazó el pedido por exceso de llamadas?
 *
 * Importa distinguirlo porque no es un error nuestro y se resuelve esperando:
 * si la pantalla lo recibe como un 500 genérico, muestra "error del servidor"
 * y la persona vuelve a apretar — que es justo lo que prolonga el bloqueo
 * (medido el 07/10/2026: con la cuenta bloqueada, doce minutos después sin
 * tocar nada seguía devolviendo 429).
 *
 * Se mira el `status` del error y no el texto del mensaje. La versión por
 * texto funcionaba, pero fallaba en la dirección peligrosa: alguien reescribe
 * el mensaje, el 429 pasa a salir como un 500, y nadie se entera hasta que
 * alguien se queja de que el botón "se rompe sin motivo".
 */
export function esExcesoDeLlamadas(e: unknown): boolean {
  return e instanceof ErrorDeLenox && e.status === 429;
}
