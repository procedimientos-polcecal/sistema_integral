/**
 * La pila de modales abiertos: decide cuál responde a Escape.
 *
 * `Modal` escucha Escape en `document`, y un modal puede abrir otro desde
 * adentro (el calendario de fecha dentro de «Nueva OT»). Sin coordinación, un
 * solo Escape cerraba **los dos**: el calendario y el formulario de atrás, que
 * es justo lo que el componente existe para que no pase. Responde sólo el de
 * arriba, y el de arriba es el último que se montó y todavía sigue abierto.
 *
 * **Límite:** «el de arriba» es el último en **montarse**, y React corre los
 * efectos de los hijos antes que los del padre. Si dos `Modal` se montan en el
 * mismo commit —un modal anidado cuyo estado de visibilidad arranca en `true`, o
 * un padre que renderiza los dos en su primer render— queda arriba el padre y
 * el de adentro no responde a Escape, sin ningún error. El anidado tiene que
 * abrirse después, por una acción posterior (un toque), como hacen hoy el
 * calendario dentro de Nueva OT y el requerimiento dentro de Repuestos.
 *
 * Es una lista de fichas y no un contador: un modal se puede desmontar estando
 * otro todavía abierto, y en ese caso hay que sacar **ése** de en medio sin
 * mover a los demás.
 */
const pila: symbol[] = [];

/** Anota un modal recién montado y devuelve su ficha. */
export function apilarModal(): symbol {
  const ficha = Symbol("modal");
  pila.push(ficha);
  return ficha;
}

/** Lo saca de la pila, esté donde esté. Sacar dos veces la misma ficha no hace nada. */
export function desapilarModal(ficha: symbol): void {
  const i = pila.indexOf(ficha);
  if (i !== -1) pila.splice(i, 1);
}

/** Verdadero si esta ficha es la del modal que está arriba de todos. */
export function esElModalDeArriba(ficha: symbol): boolean {
  return pila.length > 0 && pila[pila.length - 1] === ficha;
}
