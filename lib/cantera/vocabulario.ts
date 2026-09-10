/**
 * Los valores controlados del módulo, en un solo lugar.
 *
 * En la base son columnas de texto a propósito —un valor de enum nuevo obliga a
 * una migración sola (55P04) y estas listas crecen—, así que la base no rechaza
 * un valor inventado y la validación tiene que estar acá. Misma decisión que
 * `lib/despacho/clasificacion.ts`.
 */

/** El tipo de piedra de un yacimiento. La densidad va con esto. */
export const MATERIALES = ["Dolomita", "Chocolata", "Caliza", "Arcilla"] as const;

/** Cómo se clasifica un renglón de consumo (columna "Tipo" de CONSUMOS). */
export const TIPOS_DE_CONSUMO = ["detonador", "otros_insumos", "voladura"] as const;

export const ETIQUETA_TIPO_CONSUMO: Record<(typeof TIPOS_DE_CONSUMO)[number], string> = {
  detonador: "Detonador",
  otros_insumos: "Otros insumos",
  voladura: "Voladura (servicio)",
};

export function esMaterialValido(v: unknown): v is (typeof MATERIALES)[number] {
  return typeof v === "string" && (MATERIALES as readonly string[]).includes(v);
}

export function esTipoDeConsumoValido(v: unknown): v is (typeof TIPOS_DE_CONSUMO)[number] {
  return typeof v === "string" && (TIPOS_DE_CONSUMO as readonly string[]).includes(v);
}
