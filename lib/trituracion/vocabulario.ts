/**
 * Los valores controlados del módulo, en un solo lugar — mismo criterio que
 * `lib/cantera/vocabulario.ts` y `lib/despacho/clasificacion.ts`: la base
 * guarda texto, la validación vive acá.
 */

/** Reusa el vocabulario de Cantera: es la misma piedra, del otro lado del acarreo. */
export { MATERIALES, esMaterialValido } from "@/lib/cantera/vocabulario";

export const ESTADOS_PARTE = ["opero", "no_opero"] as const;
export type EstadoParte = (typeof ESTADOS_PARTE)[number];

export const ETIQUETA_ESTADO: Record<EstadoParte, string> = {
  opero: "Operó",
  no_opero: "No operó",
};

export function esEstadoValido(v: unknown): v is EstadoParte {
  return typeof v === "string" && (ESTADOS_PARTE as readonly string[]).includes(v);
}

/**
 * Orígenes vistos en la planilla real que no son un yacimiento de Cantera:
 * proveedor externo, acopio propio, u otra planta. Es una lista de ayuda para
 * el selector de carga (autocompletar), no una restricción — `origen` es
 * texto libre en la base porque un origen nuevo no tiene que esperar una
 * migración.
 */
export const ORIGENES_SIN_YACIMIENTO = ["LOMA NEGRA", "PEZZUCCHI", "ACOPIO"] as const;
