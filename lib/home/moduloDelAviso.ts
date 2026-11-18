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
 * ── NO ALCANZA CON LA TABLA, Y ESO COSTÓ UNA FUGA ────────────────────────────
 *
 * `MODULO_POR_AVISO` sólo tiene las entradas de `AVISOS`, que son las de
 * conteo. Hay además tres familias cuyo **id se arma en el momento** —el
 * ritmo, la salud y las sospechas de ciclo— y que por lo tanto no pueden estar
 * en ninguna tabla tecleada.
 *
 * `mant-ciclo-sospechoso-${equipo}` es de Mantenimiento y nada en su id lo
 * dice. Mientras cada persona tenía su propia pasada eso no importaba: el
 * aviso se calculaba detrás de `tiene("mantenimiento")`. Con la pasada global
 * ese portón desapareció, el aviso salía sin módulo, y **lo que no tiene
 * módulo pasa siempre**: un push diciendo «puede que se hayan cambiado
 * rodamientos de EM-12 sin avisar al ciclo» a alguien que sólo tiene Remises.
 *
 * Por eso los prefijos se declaran acá y hay un test que **lee
 * `avisos.ts`** —como `sw.test.ts` lee `public/sw.js`— y exige que todo id
 * armado en el momento tenga el suyo. Un productor dinámico nuevo se pone en
 * rojo solo; una lista escrita a mano no puede hacer eso.
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

/** El prefijo de los avisos de ritmo, que llevan su módulo **en el id**. */
const RITMO = "ritmo-";

/**
 * Los demás ids que se arman en el momento, con el módulo que les toca.
 *
 * `salud-` está acá con `null` **a propósito y no por omisión**: es del
 * sistema, y quien la frena es `sinLoQueNoPuedeAtender`, que por el prefijo la
 * manda sólo a `admin_sistema`. Si estuviera sólo por ausencia, nadie sabría
 * si alguien se olvidó de ponerla.
 */
const POR_PREFIJO: { prefijo: string; modulo: Modulo | null }[] = [
  { prefijo: "mant-ciclo-sospechoso-", modulo: "mantenimiento" },
  { prefijo: "salud-", modulo: null },
];

/**
 * Todos los prefijos que esta función sabe reconocer. Lo usa el test que lee
 * `avisos.ts`: ver el encabezado.
 */
export const PREFIJOS_DECLARADOS: readonly string[] = [
  RITMO,
  ...POR_PREFIJO.map((p) => p.prefijo),
];

export function moduloDelAviso(id: string): Modulo | null {
  if (id.startsWith(RITMO)) return id.slice(RITMO.length) as Modulo;
  const porPrefijo = POR_PREFIJO.find((p) => id.startsWith(p.prefijo));
  if (porPrefijo) return porPrefijo.modulo;
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
