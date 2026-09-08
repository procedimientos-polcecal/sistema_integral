import { numeroArgentino } from "@/lib/core/numeroArgentino";

/**
 * Interpretar las cantidades que llegan a mano en el parte de un turno.
 *
 * `Number(x) || 0` y un `numero()` que hacía `Number(v)` convertían cualquier
 * error de tipeo en un cero o en un null, sin avisar:
 *
 *   - `Number("1.234,5") || 0` da 0 — un depósito de mil doscientos entra como
 *     cero, y la producción de ese producto sale como el negativo del stock
 *     anterior, exportada a la planilla sin que nada la frene.
 *   - `Number("abc") || 0` también da 0. Mismo silencio.
 *   - `numero("abc")` da `NaN`, y `JSON.stringify(NaN)` es `null`: supabase-js
 *     manda NULL, la columna queda vacía y `bultos ?? 0` en
 *     `totalesDeDespacho` hace que ese renglón desaparezca del total del día
 *     sin dejar rastro.
 *   - `numero("   ")` da 0, no null: el chequeo `v === ""` no cubre el
 *     espacio en blanco.
 *
 * Acá nada se convierte en cero o en null por no haberse podido interpretar:
 * o se entiende el número, o se devuelve un motivo en castellano para que la
 * ruta lo transforme en un 400 con el renglón y el campo. `numeroArgentino`
 * decide si el punto es de miles o el decimal; este archivo decide qué hacer
 * con vacío, con lo que no es un número, y con negativos.
 */

export type ResultadoCantidad<T> =
  | { ok: true; valor: T }
  | { ok: false; error: string };

function limpio(v: unknown): string {
  // Cubre el espacio en blanco que numero("   ") dejaba pasar como si fuera
  // vacío de verdad: acá "vacío" es siempre el resultado de este trim.
  return String(v ?? "").trim();
}

/**
 * Una cantidad **obligatoria y no negativa**: la del depósito al cerrar el
 * turno. Vacío falta, un texto que no es un número es un error (nunca un
 * cero), y un negativo tampoco existe — el depósito es lo que hay, no un
 * movimiento.
 */
export function interpretarCantidadDeDeposito(v: unknown): ResultadoCantidad<number> {
  const texto = limpio(v);
  if (texto === "") return { ok: false, error: "Falta la cantidad." };

  const n = numeroArgentino(texto);
  if (n === null) return { ok: false, error: `"${texto}" no es un número.` };
  if (n < 0) return { ok: false, error: "La cantidad no puede ser negativa." };

  return { ok: true, valor: n };
}

/**
 * Una cantidad **opcional**: kilos, bultos, cantidad de pallets. Vacío o sólo
 * espacios es un `null` legítimo — el papel no siempre trae ese dato—, pero un
 * texto que no se puede leer como número es un error, no un `null` que se
 * confunda con "no se anotó nada".
 */
export function interpretarCantidadOpcional(v: unknown): ResultadoCantidad<number | null> {
  const texto = limpio(v);
  if (texto === "") return { ok: true, valor: null };

  const n = numeroArgentino(texto);
  if (n === null) return { ok: false, error: `"${texto}" no es un número.` };

  return { ok: true, valor: n };
}

/**
 * Una rotura: en la base es `not null default 0`. Ausente es 0 —la mayoría de
 * los renglones no rompen nada—, pero un texto inválido sigue siendo un
 * error: si se tipeó algo, tiene que poder leerse. Tampoco existe una rotura
 * negativa.
 */
export function interpretarRotura(v: unknown): ResultadoCantidad<number> {
  const texto = limpio(v);
  if (texto === "") return { ok: true, valor: 0 };

  const n = numeroArgentino(texto);
  if (n === null) return { ok: false, error: `"${texto}" no es un número.` };
  if (n < 0) return { ok: false, error: "La rotura no puede ser negativa." };

  return { ok: true, valor: n };
}
