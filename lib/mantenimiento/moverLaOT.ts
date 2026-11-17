/**
 * Mover una OT desde el calendario: quién se puede mover y a qué día.
 *
 * Son las decisiones de `/api/mantenimiento/ordenes/[id]/postergar` contestadas
 * **antes** de llamarla, para que la pantalla no ofrezca un camino que el
 * servidor va a rechazar. El servidor las vuelve a aplicar: una regla que vive
 * sólo acá no es una regla.
 *
 * ── LA TRAMPA QUE HAY QUE SABER ANTES DE TOCAR ESTO ─────────────────────────
 *
 * **El día en el que la grilla pinta una orden NO es el día desde el que la
 * ruta cuenta.** La grilla usa `fechaParaElCalendario` —la pendiente si la hay
 * y si no la de la planilla— mientras que `postergar` recibe *cuántos días* y
 * los suma siempre a `fecha_ejecucion`. En una orden con
 * `fecha_ejecucion_pendiente` puesta las dos difieren, y contar los días contra
 * lo que se ve en pantalla la mandaría a un día que nadie eligió, sin error y
 * sin aviso.
 *
 * Por eso `diasParaLlegarA` pide `fecha_ejecucion` y nada más: es la única
 * fecha contra la que el resultado es el día que se tocó.
 *
 * ── Y POR QUÉ SÓLO HACIA ADELANTE ───────────────────────────────────────────
 *
 * Porque la ruta sólo sabe eso: `loQueFaltaParaPostergar` exige un entero
 * positivo y de hasta `MAXIMO_DE_DIAS`. Adelantar una orden no existe hoy en
 * ninguna punta del sistema, así que el calendario no lo ofrece en vez de
 * ofrecerlo y fallar.
 */

import { MAXIMO_DE_DIAS } from "./postergar";

/**
 * Estados en los que la orden ya no espera nada de nadie, así que correrle la
 * fecha no quiere decir nada.
 *
 * Es la tercera lista con estos dos valores —las otras son `CERRADAS` en
 * `alertas.ts` y `CERRADAS_GUT` en `gut.ts`— y **tampoco se unifica**, por el
 * mismo motivo que aquellas dos no se unifican entre sí: cada una tiene su
 * dueño y decide otra cosa. Si aparece un estado nuevo hay que mirar las tres.
 */
const YA_NO_ESPERA = ["REALIZADO", "SUSPENDIDA"];

/** Lo que la grilla sabe de una orden y hace falta para decidir si se mueve. */
export interface OrdenQueSeMueve {
  app_created: boolean | null;
  estado: string | null;
  /**
   * La fecha desde la que `postergar` cuenta los días. **No es la que pinta la
   * grilla**: ver el encabezado.
   */
  fecha_ejecucion: string | null;
}

/**
 * Por qué esta orden no se puede mover desde el sistema, o `null` si se puede.
 *
 * El texto se muestra tal cual: es lo que contesta «¿y ésta por qué no tiene el
 * botón?» sin que nadie tenga que abrir el código.
 */
export function porQueNoSePuedeMover(o: OrdenQueSeMueve): string | null {
  if (!o.app_created) {
    return (
      "Entró por el formulario: su fecha vive en la pestaña que maneja Google " +
      "Forms y escribir ahí corre las filas de las demás. Se cambia allá."
    );
  }
  if (!o.fecha_ejecucion) {
    return "No tiene fecha de inicio, así que no hay de dónde correrla.";
  }
  if (o.estado && YA_NO_ESPERA.includes(o.estado)) {
    return "Ya está cerrada: correrle la fecha no cambia nada.";
  }
  return null;
}

const UN_DIA = 86_400_000;

/** Los días que hay que sumarle a `desde` para llegar a `hasta`. Puede ser ≤ 0. */
export function diasParaLlegarA(desde: string, hasta: string): number {
  const [a1, m1, d1] = desde.split("-").map(Number);
  const [a2, m2, d2] = hasta.split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / UN_DIA);
}

/**
 * Por qué esta orden no puede ir a ese día, o `null` si puede.
 *
 * Supone que `porQueNoSePuedeMover` ya dijo que sí: una orden sin
 * `fecha_ejecucion` contesta acá el mismo motivo y no revienta.
 */
export function porQueNoSePuedeMoverA(o: OrdenQueSeMueve, dia: string): string | null {
  const trabada = porQueNoSePuedeMover(o);
  if (trabada) return trabada;

  const dias = diasParaLlegarA(o.fecha_ejecucion as string, dia);
  if (dias <= 0) {
    return "Una orden sólo se puede correr hacia adelante.";
  }
  if (dias > MAXIMO_DE_DIAS) {
    return `Son ${dias} días y de una vez no se puede correr más de ${MAXIMO_DE_DIAS}.`;
  }
  return null;
}
