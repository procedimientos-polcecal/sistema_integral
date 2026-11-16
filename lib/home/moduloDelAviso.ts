import type { Modulo } from "@/lib/core/types";
import type { Notificacion } from "./notificaciones";
import { MODULO_POR_AVISO } from "./avisos";

/**
 * De qué módulo es un aviso, y cómo quedarse con los de alguien.
 *
 * ── POR QUÉ HIZO FALTA ───────────────────────────────────────────────────────
 *
 * Esta relación **ya existía, pero implícita y en el lugar equivocado**: vivía
 * en la llamada `contarSiTiene(modulo, …)` de `avisosDeLosModulos`, o sea en el
 * call site del conteo. Mientras cada persona tuviera su propia pasada eso
 * alcanzaba: el conteo de un módulo que no ve simplemente no se hacía.
 *
 * El aviso al instante recalcula **una sola vez** para todos —los conteos son
 * globales y lo caro es la vista de ritmo, que da lo mismo para los dieciséis—
 * y después filtra. Ahí ya no hay dónde aplicar aquella condición, así que el
 * módulo pasa a estar declarado en la definición del aviso.
 *
 * ── `null` NO ES UN OLVIDO ───────────────────────────────────────────────────
 *
 * Tres familias no son de ningún módulo, y cada una por su motivo:
 *
 *   - **la salud** (`salud-*`): es del sistema. Quien la frena es
 *     `sinLoQueNoPuedeAtender`, que por el prefijo la manda sólo a
 *     `admin_sistema`. Darle un módulo la dejaría afuera para todos los demás
 *     por dos razones distintas, y la segunda taparía a la primera;
 *   - **la Agenda y la mensajería**: son transversales —no están en
 *     `MODULOS_ORDEN` y las ve cualquiera con sesión—, y son exactamente las
 *     dos de `ES_POR_PERSONA`, que el instantáneo saltea porque su número
 *     depende de quién mira;
 *   - **un id que no existe**: no se inventa un módulo para algo que nadie
 *     declaró.
 *
 * Por eso `soloDeSusModulos` **deja pasar lo que no tiene módulo**: filtrar ahí
 * sería negarle la salud a `admin_sistema` sin que ninguna pantalla lo diga.
 */

/** El prefijo de los avisos de ritmo, que llevan su módulo en el id. */
const RITMO = "ritmo-";

export function moduloDelAviso(id: string): Modulo | null {
  if (id.startsWith(RITMO)) return id.slice(RITMO.length) as Modulo;
  return MODULO_POR_AVISO.get(id) ?? null;
}

/**
 * Los avisos que le corresponden a quien ve estos módulos.
 *
 * Lo que no es de ningún módulo pasa siempre: ver arriba.
 */
export function soloDeSusModulos(avisos: Notificacion[], modulos: Modulo[]): Notificacion[] {
  return avisos.filter((a) => {
    const modulo = moduloDelAviso(a.id);
    return modulo === null || modulos.includes(modulo);
  });
}
