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
   * La fecha ISO de la más vieja de todas las que se cuentan, para poder decir
   * desde cuándo. Es null cuando ninguna tiene una fecha que se entienda: ahí
   * no hay nada cierto que afirmar sobre el cuándo, y la barra dice sólo el
   * cuánto.
   */
  laMasVieja: string | null;
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
    laMasVieja: laMasVieja([...demoradas, ...detenidas]),
  };
}

/**
 * La `creadaEn` más vieja de las que se entienden.
 *
 * Una fecha ilegible se saltea en vez de arrastrar un `NaN` que haría que la
 * comparación diera siempre falso y la más vieja terminara siendo cualquiera.
 * Puede llegar: `paradas` no mira la fecha —no tiene por qué, su criterio es el
 * estado—, así que una carga con el `creadaEn` roto entra igual a la cuenta.
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
