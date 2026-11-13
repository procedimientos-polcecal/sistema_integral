import type { MontosPorMoneda } from "./embudo";

/**
 * Cómo se escriben los números del CRM en pantalla.
 *
 * Vive acá y no en cada componente porque el mismo monto aparece en cuatro
 * pantallas —el tablero, el embudo, la ficha del cliente y la lista de
 * oportunidades— y cuatro copias de un `toLocaleString` terminan mostrando el
 * mismo número de cuatro formas.
 */

/** Los símbolos. `USD` y no `U$S` porque es lo que usa el resto del sistema. */
const SIMBOLO: Record<keyof MontosPorMoneda, string> = { ARS: "$", USD: "USD " };

/**
 * Un monto con su símbolo, sin decimales.
 *
 * Sin decimales a propósito: son presupuestos de material a granel, donde los
 * centavos son ruido y le sacan lugar a las cifras que importan en una columna
 * angosta de teléfono.
 */
export function comoMonto(valor: number, moneda: keyof MontosPorMoneda): string {
  return `${SIMBOLO[moneda]}${Math.round(valor).toLocaleString("es-AR")}`;
}

/**
 * Los dos montos de un embudo, para una sola línea.
 *
 * **Si una moneda está en cero, no se escribe**: un «$0 · USD 12.000» hace
 * pensar que falta algo en pesos. Y si las dos están en cero devuelve un guión,
 * que es lo que corresponde a una columna vacía — «$0» diría que hay
 * oportunidades por cero pesos, que es otra cosa.
 */
export function comoMontos(montos: MontosPorMoneda): string {
  const partes: string[] = [];
  if (montos.ARS !== 0) partes.push(comoMonto(montos.ARS, "ARS"));
  if (montos.USD !== 0) partes.push(comoMonto(montos.USD, "USD"));
  return partes.length > 0 ? partes.join(" · ") : "—";
}

/**
 * Toneladas con su unidad, o un guión si no hay.
 *
 * El cero es un guión por lo mismo que arriba: «0 t» dice que se midió y dio
 * cero, cuando lo que pasa es que nadie cargó las toneladas.
 */
export function comoToneladas(valor: number | null | undefined): string {
  if (!valor) return "—";
  return `${valor.toLocaleString("es-AR", { maximumFractionDigits: 1 })} t`;
}

/** Una fecha ISO como se lee acá: 12/11/2026. Un valor vacío es un guión. */
export function comoFecha(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  if (!anio || !mes || !dia) return iso;
  return `${dia}/${mes}/${anio}`;
}

/** Cómo se lee cada tipo de actividad. Espejo del `check` de la tabla. */
export const TIPOS_DE_ACTIVIDAD = [
  { clave: "llamado", nombre: "Llamado" },
  { clave: "visita", nombre: "Visita" },
  { clave: "email", nombre: "Correo" },
  { clave: "whatsapp", nombre: "WhatsApp" },
  { clave: "reunion", nombre: "Reunión" },
  { clave: "otro", nombre: "Otro" },
] as const;

/** Cómo se lee un tipo. Uno que no se reconoce se muestra como vino. */
export function nombreDelTipo(clave: string): string {
  return TIPOS_DE_ACTIVIDAD.find((t) => t.clave === clave)?.nombre ?? clave;
}

/** Cómo se lee el estado de un cliente, y de qué color. */
export const ESTADOS_DE_CLIENTE = [
  { clave: "prospecto", nombre: "Prospecto", color: "#7C3AED" },
  { clave: "activo", nombre: "Activo", color: "#15803D" },
  { clave: "inactivo", nombre: "Inactivo", color: "#64748B" },
] as const;

export function estadoDeCliente(clave: string) {
  return ESTADOS_DE_CLIENTE.find((e) => e.clave === clave) ?? null;
}
