import { esperandoDesdeAyer, paradas } from "@/public/cola/colaOffline.js";
import type { CargaEnCola } from "@/public/cola/colaOffline.js";

/**
 * Lo que la barra de «había algo esperando» tiene para decir, en números.
 *
 * SON DOS COSAS DISTINTAS Y POR ESO SON DOS CAMPOS. Una carga `demorada` lleva
 * más de un día en el teléfono pero **no está perdida**: sale sola en cuanto
 * haya señal y un disparo la tome. Una `detenida` no sale sola nunca más por su
 * cuenta —necesita que una persona la mire— y es la que urge. Sumarlas en un
 * solo número obligaría a redactar una frase que vale para las dos, y la única
 * que vale para las dos no dice ninguna de las dos cosas.
 *
 * Las dos listas **no se pisan**: `esperandoDesdeAyer` sólo mira las de estado
 * `esperando` y `paradas` sólo las de estado `parada`, que son excluyentes. Un
 * test lo fija, porque si algún día se solaparan la barra contaría dos veces la
 * misma carga.
 */
export type LoQueNoEntro = {
  /** Cuántas llevan más de un día esperando señal. */
  demoradas: number;
  /** Cuántas no salen solas: ver `paradas` en `colaOffline.js`. */
  detenidas: number;
  /**
   * La fecha ISO de la más vieja **de las demoradas**, para poder decir desde
   * cuándo en la frase de ésas.
   *
   * EL NOMBRE DICE «QUE ESPERA» Y ES LO ÚNICO QUE IMPORTA DE ESTE CAMPO.
   * Salía de las dos listas juntas, y así una parada de hace ocho días le
   * prestaba su fecha a la frase de las que esperan: «una espera desde hace más
   * de un día; la más vieja se cargó hace 8 días. No se perdieron: salen solas
   * cuando haya señal» — los ocho días eran de la que no sale sola nunca. Es el
   * mismo cruce que el tipo entero existe para evitar, un escalón más abajo: no
   * alcanza con separar los números si después una frase toma prestado un dato
   * de la otra.
   *
   * Es null cuando no hay demoradas, o cuando ninguna tiene una fecha que se
   * entienda: ahí no hay nada cierto que afirmar sobre el cuándo, y la barra
   * dice sólo el cuánto.
   */
  laMasViejaQueEspera: string | null;
};

/**
 * Qué hay para avisar sobre la cola de este teléfono, o null si no hay nada.
 *
 * `null` y no un objeto en cero: la barra no se dibuja, y un objeto que hay que
 * mirar por dentro para saber si se dibuja es la forma de que algún día se
 * dibuje vacía.
 *
 * No filtra por persona, a propósito. La cola es del aparato y puede tener
 * cargas de otra sesión —en la planta el teléfono se presta—, y una carga ajena
 * que lleva tres días sin entrar es **exactamente** lo que nadie se entera: su
 * dueño podría no volver a abrir la app en una semana. Quien mire la barra no
 * va a poder mandarla (eso lo impide `puedeMandarse`, y está bien que lo
 * impida: la planilla queda firmada con quien la cargó), pero sí puede ir a
 * `/cargar`, ver de quién es y avisarle. Enterarse es el objetivo entero.
 */
export function loQueNoEntro(cargas: CargaEnCola[], ahora: Date): LoQueNoEntro | null {
  const demoradas = esperandoDesdeAyer(cargas, ahora);
  const detenidas = paradas(cargas);
  if (demoradas.length === 0 && detenidas.length === 0) return null;
  return {
    demoradas: demoradas.length,
    detenidas: detenidas.length,
    laMasViejaQueEspera: laMasVieja(demoradas),
  };
}

/**
 * La `creadaEn` más vieja de las que se entienden.
 *
 * Una fecha ilegible se saltea en vez de arrastrar un `NaN` que haría que la
 * comparación diera siempre falso y la más vieja terminara siendo cualquiera.
 * Hoy la llama sólo `loQueNoEntro` con las demoradas, que `esperandoDesdeAyer`
 * ya filtró por fecha, así que no debería llegar ninguna rota; se contempla
 * igual porque el día que esto se use sobre otra lista —las paradas, que no
 * miran la fecha— el error sería mudo.
 *
 * **Y por eso mismo ese `continue` no lo ejercita ningún test**: desde la
 * entrada pública es inalcanzable, y un test que lo tocara tendría que llamar a
 * esta función directamente, o sea probar una rama que hoy no existe. Queda
 * anotado para que no se lo lea como código cubierto: el día que se lo use
 * sobre las paradas, hay que traerle su test.
 */
function laMasVieja(cargas: CargaEnCola[]): string | null {
  let masVieja: string | null = null;
  let suMomento = Infinity;
  for (const carga of cargas) {
    const momento = new Date(carga.creadaEn).getTime();
    if (Number.isNaN(momento)) continue;
    if (momento < suMomento) {
      suMomento = momento;
      masVieja = carga.creadaEn;
    }
  }
  return masVieja;
}
