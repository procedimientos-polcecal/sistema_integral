import { suNumeroSeMuestra, type Notificacion } from "./notificaciones";
import type { Aviso } from "@/lib/core/webpush";

/** Cuántos avisos se nombran en el cuerpo antes de resumir el resto. */
const CUANTOS_SE_NOMBRAN = 3;

/**
 * Los avisos cuya `cantidad` **no cuenta cosas**, y que por lo tanto van sin
 * número: los relojes y las familias de ritmo y de salud.
 *
 * **Es exactamente lo que decide la campana**, y por eso acá no queda más que
 * la negación: el criterio entero vive en `suNumeroSeMuestra`
 * (`./notificaciones.ts`), que es el único módulo de avisos que puede importar
 * también un componente de cliente. Los dos prefijos vivían acá, de modo que el
 * push los callaba y la campana los dibujaba — dos superficies que comen lo
 * mismo diciendo cosas distintas. Si hace falta una familia más, va allá.
 */
const sinNumero = (n: Notificacion) => !suNumeroSeMuestra(n);

const comoLinea = (n: Notificacion) => (sinNumero(n) ? n.titulo : `${n.cantidad} · ${n.titulo}`);

const esDeSalud = (n: Notificacion) => n.id.startsWith("salud-");

/**
 * La salud adelante, y **sólo en el push**.
 *
 * `avisosDeLosModulos` los agrega al final a propósito: en la campana, que
 * muestra la lista entera, los de los módulos son de todos y van primero. Pero
 * el push **nombra tres y resume el resto**, así que «al final» ahí quiere
 * decir «en el "y N más"».
 *
 * Con el resumen diario eso no se notaba —lleva movimiento, los stocks de los
 * módulos casi no se mueven y la lista queda corta—, pero **el de los lunes
 * lleva totales**: la de un `admin_sistema` pasa de diez avisos y la salud
 * quedaba fuera de los tres nombrados **todos los lunes, por construcción**. Y
 * los lunes son la red, no un extra: es el único mensaje que vuelve a nombrar
 * lo que dejó de moverse. Un recurso caído hace semanas no mueve nada, así que
 * si el lunes tampoco lo nombra, no lo nombra nadie.
 *
 * El orden se toca acá y no en `avisosDeUsuario`, que es lo que también le
 * cambiaría el orden a la campana.
 *
 * `sort` es estable desde ES2019, así que lo demás conserva su orden.
 */
const saludPrimero = (avisos: Notificacion[]): Notificacion[] =>
  [...avisos].sort((a, b) => Number(esDeSalud(b)) - Number(esDeSalud(a)));

/**
 * Convierte los avisos de una persona en **una** notificación.
 *
 * Una por aviso sería la forma obvia y es la equivocada: con los números de hoy
 * —ocho módulos parados más las colas de trabajo— alguien se come diez pushes a
 * la mañana, los silencia, y a partir de ahí el sistema no avisa más nada. Una
 * sola que diga cuánto hay y lleve a mirarlo es lo que se puede sostener todos
 * los días.
 *
 * Devuelve `null` cuando no hay nada: **no se manda una notificación para decir
 * que no pasa nada.** Esa es la que enseña a ignorarlas.
 *
 * Con un solo aviso el link va directo a su pantalla. Mandar a la persona al
 * inicio para que vuelva a buscar de qué se trataba es el peor resultado
 * posible de haberla interrumpido.
 */
export function resumirParaPush(avisos: Notificacion[]): Aviso | null {
  if (avisos.length === 0) return null;

  if (avisos.length === 1) {
    const unico = avisos[0];
    return {
      title: unico.titulo,
      body: sinNumero(unico) ? "" : String(unico.cantidad),
      url: unico.href,
    };
  }

  const nombrados = saludPrimero(avisos).slice(0, CUANTOS_SE_NOMBRAN).map(comoLinea);
  const restantes = avisos.length - CUANTOS_SE_NOMBRAN;
  if (restantes > 0) nombrados.push(`y ${restantes} más`);

  return {
    title: `${avisos.length} cosas para mirar`,
    body: nombrados.join("\n"),
    url: "/",
  };
}

/**
 * Lo mismo, pero para un resumen que cuenta **movimiento**: cuánto subió cada
 * aviso desde la foto anterior, no cuánto hay.
 *
 * Lo que recibe ya trae `cantidad` con el delta —se lo da `loQueSeMovio` de
 * `./movimiento.ts`—, así que acá sólo se decide cómo se escribe.
 *
 * **EL NÚMERO NUNCA VA SOLO.** Un «3» que ayer era el total y hoy es el
 * incremento es peor que cualquiera de los dos: quien lo lee no tiene cómo
 * saber cuál está mirando. Por eso va con «más».
 *
 * Y va «más» y no «nuevas» porque los trece títulos mezclan género —«Ausencias
 * sin clasificar» contra «Requerimientos esperando aprobación»—, así que
 * cualquier adjetivo concuerda con la mitad y chirría con la otra. «Más» es
 * invariable y además dice exactamente lo que es: un incremento.
 *
 * El título de varios es «N novedades» y no «N cosas para mirar», que es el de
 * `resumirParaPush`: los dos resúmenes conviven —éste todos los días, aquél los
 * lunes— y tienen que distinguirse de un vistazo.
 */
export function resumirElMovimiento(avisos: Notificacion[]): Aviso | null {
  if (avisos.length === 0) return null;

  if (avisos.length === 1) {
    const unico = avisos[0];
    return {
      title: unico.titulo,
      body: sinNumero(unico) ? "" : `${unico.cantidad} más`,
      url: unico.href,
    };
  }

  const comoLineaDeMovimiento = (n: Notificacion) =>
    sinNumero(n) ? n.titulo : `${n.cantidad} más · ${n.titulo}`;

  const nombrados = saludPrimero(avisos).slice(0, CUANTOS_SE_NOMBRAN).map(comoLineaDeMovimiento);
  const restantes = avisos.length - CUANTOS_SE_NOMBRAN;
  if (restantes > 0) nombrados.push(`y ${restantes} más`);

  return {
    title: `${avisos.length} novedades`,
    body: nombrados.join("\n"),
    url: "/",
  };
}
