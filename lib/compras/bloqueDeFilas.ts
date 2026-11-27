import { letraDeColumna } from "@/lib/core/columnaDeSheets";

/**
 * El rango A1 que cubre un bloque de filas que empieza en `filaInicial`.
 *
 * Se mide por la fila MÁS ANCHA y no por la primera: si el rango queda más
 * corto que lo que se manda, Google rechaza la escritura entera.
 * `letraDeColumna` es 0-based (el 0 es la A), de ahí el `ancho - 1`.
 */
export function rangoDelBloque(pestana: string, filaInicial: number, filas: string[][]): string {
  if (filas.length === 0) throw new Error("No hay filas que escribir");
  const ancho = Math.max(...filas.map((f) => f.length));
  if (ancho === 0) throw new Error("Las filas a escribir no tienen columnas");
  const ultimaFila = filaInicial + filas.length - 1;
  return `${pestana}!A${filaInicial}:${letraDeColumna(ancho - 1)}${ultimaFila}`;
}
