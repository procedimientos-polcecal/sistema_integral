/**
 * Qué presupuestos del sistema todavía no están en la planilla del artículo.
 *
 * Las dos rutas que cargan un presupuesto —la ficha del pedido y
 * `/compras/presupuestos`— escriben **sólo la fila que están creando en ese
 * momento**, y si el pedido no tenía comparativa vinculada no escriben nada: el
 * presupuesto se guarda, el cartel lo dice y nadie vuelve por él. Vincular la
 * planilla después tampoco lo sube, porque las dos rutas que vinculan —la de un
 * pedido y la de `/compras/configuracion`— **leen** la planilla hacia la base y
 * no al revés.
 *
 * El caso no es raro y por eso existe este archivo: el vínculo suele llegar por
 * la sincronización, que lo lee del hipervínculo escondido detrás del "LINK" del
 * master, y eso puede pasar **después** de que alguien cargó la respuesta del
 * proveedor. Medido el 27/11/2026: de 13 presupuestos cargados por la app, uno
 * estaba así —el RI 2367, con la planilla CORREAS ya vinculada—.
 */

/** Lo que hace falta de una cotización para decidir si va a la planilla. */
export interface CotizacionPorSubir {
  id: string;
  /** `app` = cargada en el sistema; `drive` = leída de la planilla. */
  origen: string;
  /** La fila donde está escrita. Nula = no llegó a la planilla. */
  drive_fila: number | null;
  created_at?: string | null;
}

/**
 * Las que faltan subir, en el orden en que se cargaron.
 *
 * **Sólo las de origen `app`**, y eso no es una precaución: una `drive` nació de
 * una fila de la planilla, así que escribirla sería devolverle a la planilla lo
 * que ella misma dictó —un duplicado del presupuesto de otro proveedor, en la
 * comparativa que después alguien usa para elegir a quién comprar—. Si una
 * `drive` tiene `drive_fila` nulo lo que hay es un dato roto, y subirla lo
 * empeora.
 *
 * El orden sale de `created_at` y desempata por id: la planilla recibe los
 * presupuestos en el orden en que los cargaron, y dos llamadas seguidas escriben
 * lo mismo en el mismo orden. Un `created_at` ausente va al final, que es donde
 * no desordena a los que sí lo tienen.
 */
export function loQueFaltaSubir<T extends CotizacionPorSubir>(cotizaciones: T[]): T[] {
  return cotizaciones
    .filter((c) => c.origen === "app" && c.drive_fila === null)
    .sort((a, b) => {
      const cuando = (c: T) => c.created_at ?? "";
      if (cuando(a) !== cuando(b)) {
        if (cuando(a) === "") return 1;
        if (cuando(b) === "") return -1;
        return cuando(a) < cuando(b) ? -1 : 1;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/** Lo que hace falta para saber si el precio se puede escribir en pesos. */
export interface CotizacionConMoneda {
  moneda?: string | null;
  /** El dólar con el que se congeló al elegirla. Nula mientras se compara. */
  cotizacion?: number | null;
}

/**
 * Un presupuesto en dólares que no se puede pasar a pesos.
 *
 * La planilla es toda en pesos: un unitario en dólares escrito tal cual se suma
 * con los que están en pesos y el más barato pasa a ser el que está en otra
 * moneda. Es la misma regla que la carga —`filaParaPlanilla` deja el precio
 * vacío sin cotización—, con la diferencia de que acá sirve para **no escribir
 * la fila**: una fila sin precio en una comparativa es peor que la ausencia,
 * porque parece un presupuesto que el proveedor no coticó.
 */
export function faltaLaConversion(
  c: CotizacionConMoneda,
  dolarDelDia: number | null
): boolean {
  return c.moneda === "USD" && !c.cotizacion && dolarDelDia === null;
}
