/**
 * ¿Lenox rechazó el pedido por exceso de llamadas?
 *
 * Importa distinguirlo porque no es un error nuestro y se resuelve esperando:
 * si la pantalla lo recibe como un 500 genérico, muestra "error del servidor"
 * y la persona vuelve a apretar — que es justo lo que prolonga el bloqueo
 * (medido el 07/10/2026: sondear parece mantenerlo vivo).
 *
 * HOY SE RECONOCE POR EL TEXTO. `cliente.ts` lanza un `Error` común y el único
 * rastro del status es el "(429)" con que termina el mensaje, así que se mira
 * ese final anclado y no un "429" suelto en cualquier lado. Está atado al
 * cliente por un test que provoca el 429 de verdad contra un `fetch` falso:
 * si alguien cambia el mensaje, el test se rompe en vez de que la pantalla
 * vuelva a mostrar un 500 sin que nadie se entere.
 *
 * La salida de fondo es un error propio en el cliente con `status`. Cuando
 * exista, la primera condición lo toma sin tocar nada más.
 */
export function esExcesoDeLlamadas(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if ((e as { status?: unknown }).status === 429) return true;
  return /\(429\)\s*$/.test(e.message);
}
