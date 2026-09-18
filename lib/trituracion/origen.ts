/**
 * Resuelve un `origen` de Trituración a un código de yacimiento de Cantera,
 * sólo cuando coincide exacto. Sirve para cruzar `toneladas_procesadas`
 * contra lo que Cantera ya registró como llegado a esa planta
 * (`lib/trituracion/cruceCantera.ts`) sin inventar un enlace cuando el
 * origen es un proveedor externo, un acopio propio, u otra planta.
 *
 * "Enlazar al que se parece es peor que dejar en null" — mismo criterio que
 * ya usa Cantera con sus fleteros sin resolver.
 */

const YACIMIENTOS_CANTERA = ["D1", "D6", "C1", "C3"] as const;

export function yacimientoDelOrigen(origen: string | null): string | null {
  if (!origen) return null;
  const normalizado = origen.trim().toUpperCase();
  return (YACIMIENTOS_CANTERA as readonly string[]).includes(normalizado) ? normalizado : null;
}
