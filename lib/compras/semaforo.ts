/**
 * El semáforo de los pedidos que esperan a Compras.
 *
 * Pinta de verde, amarillo o rojo un requerimiento según cuántos días lleva
 * desde que se pidió, para que el área sepa por cuál conviene reclamar.
 *
 * ## Por qué los cortes son 30 y 90, y no 10 y 30
 *
 * Medido el 12/11/2026 sobre los 106 pedidos que esperaban a Compras:
 *
 * | cortes | verde | amarillo | rojo | Mantenimiento abre con |
 * |---|---|---|---|---|
 * | 10 / 30 | 37 | 19 | **50** | 33 reclamos |
 * | 30 / 90 | 56 | 35 | **15** | 11 reclamos |
 *
 * Se eligió el segundo. **El rojo tiene que costar poco de atender o deja de
 * significar algo**, y once es una lista que una persona recorre en una
 * mañana. Este módulo ya tiene el ejemplo de qué pasa si no: el 42% de los
 * pedidos abiertos está marcado `URGENTE`, y por eso la prioridad dejó de
 * distinguir.
 *
 * ## Qué entra, y la trampa que esto evita
 *
 * Sólo lo que **espera a Compras**. Quedan afuera los `PEDIDO` —ahí la demora
 * es del proveedor y Compras ya hizo lo suyo— y, sobre todo, los `EN_ESPERA`,
 * que no son una etapa sino un desvío: un pedido frenado a propósito. Medido
 * el mismo día: **9 de los 10 pedidos más viejos de la lista estaban
 * EN_ESPERA**. Sin excluirlos, lo primero que ve el área arriba de todo son
 * pedidos que alguien congeló, y el primer reclamo que sale se contesta con
 * «ése está en espera» — que es como esta función se muere en la primera
 * semana.
 *
 * ## Los dos caminos tienen que dar lo mismo
 *
 * `colorDelPedido` pinta una fila y `rangoDeColor` arma el filtro con el que
 * se cuentan las filas sin traerlas. Son el mismo corte visto de los dos
 * lados, así que los dos salen de `fechaDeCorte()`: si se separan, la franja
 * cuenta un pedido en un color y el punto del renglón lo pinta de otro.
 */

/** Hasta acá es verde. */
export const DIAS_VERDE = 30;

/** Hasta acá es amarillo; de ahí en más, rojo. */
export const DIAS_AMARILLO = 90;

export type ColorDelPedido = "verde" | "amarillo" | "rojo";

/**
 * Los estados de compra en los que el pedido todavía depende de Compras.
 *
 * Se exporta porque la pantalla lo necesita para su `.in()` de PostgREST. Es
 * la misma lista y no una copia a propósito: con dos listas, agregar un quinto
 * estado hace que el punto aparezca en renglones que los chips no cuentan y
 * que el filtro no devuelve, sin que nada lo note.
 */
export const ESPERAN_A_COMPRAS = ["SIN_INICIAR", "EN_COMPARATIVA", "PARA_COMPRAR", "APROBADO"];

/**
 * Si este pedido es de los que el semáforo pinta y se pueden reclamar.
 *
 * Toma las dos columnas de estado porque las dos pueden sacarlo de la cola:
 * un pedido que gerencia denegó no espera a Compras aunque su `estado_compra`
 * siga diciendo `SIN_INICIAR`.
 */
export function esReclamable(p: { estado_compra: string; estado_aprobacion: string }): boolean {
  if (p.estado_aprobacion === "DENEGADA") return false;
  return ESPERAN_A_COMPRAS.includes(p.estado_compra);
}

/** Un día en milisegundos. */
const UN_DIA = 86_400_000;

/**
 * Cuántos días pasaron desde que se pidió.
 *
 * Puede dar negativo: hay pedidos con la fecha adelantada —el más nuevo medido
 * tenía −1— y eso no es un error que haya que tapar acá.
 */
export function diasEsperando(fecha: string, hoy: Date): number {
  return Math.floor((aMedianoche(hoy).getTime() - aMedianoche(new Date(fecha)).getTime()) / UN_DIA);
}

export function colorDelPedido(fecha: string, hoy: Date): ColorDelPedido {
  const dias = diasEsperando(fecha, hoy);
  if (dias <= DIAS_VERDE) return "verde";
  if (dias <= DIAS_AMARILLO) return "amarillo";
  return "rojo";
}

/**
 * El rango de fechas de un color, para filtrar y contar del lado del servidor.
 *
 * **`hastaExclusivo` se consume con `.lt()` y nunca con `.lte()`**, y el
 * nombre lo dice porque confundirlo cuesta caro. `fecha` es un `timestamptz`
 * —no un `date`, aunque se lea como uno—: los RI cargados en la app llevan la
 * hora real (medido: `2026-11-12T13:06:59Z`) y los que entran por la planilla
 * quedan a medianoche. Con un borde superior inclusivo, PostgREST compara
 * `2026-10-12` contra las 00:00 de ese día, así que un pedido de ese mismo día
 * a las 13:00 **no entra en ningún color**: el punto del renglón lo pinta
 * amarillo y los tres chips lo cuentan en ninguno. Por eso el borde de arriba
 * es el primer día del color siguiente, excluido.
 *
 * El verde no tiene borde de arriba a propósito: una fecha adelantada tiene
 * que entrar ahí y no quedarse sin color.
 */
export function rangoDeColor(
  color: ColorDelPedido,
  hoy: Date
): { desde?: string; hastaExclusivo?: string } {
  switch (color) {
    case "verde":
      return { desde: fechaDeCorte(DIAS_VERDE, hoy) };
    case "amarillo":
      return {
        desde: fechaDeCorte(DIAS_AMARILLO, hoy),
        hastaExclusivo: fechaDeCorte(DIAS_VERDE, hoy),
      };
    case "rojo":
      return { hastaExclusivo: fechaDeCorte(DIAS_AMARILLO, hoy) };
  }
}

/**
 * Cómo se dice la espera en pantalla.
 *
 * Cero días es «hoy» y no «0 días», y una fecha adelantada —que las hay— cae
 * en lo mismo: «−3 días» en un renglón se lee como un error del sistema y no
 * como un dato cargado con la fecha corrida.
 */
export function textoDeEspera(dias: number): string {
  if (dias <= 0) return "hoy";
  return `${dias} ${dias === 1 ? "día" : "días"}`;
}

/** La fecha que, mirada desde `hoy`, tiene exactamente esa cantidad de días. */
function fechaDeCorte(dias: number, hoy: Date): string {
  const d = new Date(aMedianoche(hoy).getTime() - dias * UN_DIA);
  return d.toISOString().slice(0, 10);
}

/**
 * La misma fecha a medianoche UTC.
 *
 * `fecha` es un `timestamptz` y trae hora, igual que la de `hoy`. Sin truncar
 * las dos, el mismo pedido cambiaría de color según la hora a la que alguien
 * mire la pantalla. Lo que **no** arregla es el borde del filtro del servidor,
 * que compara los timestamps crudos: de eso se ocupa `hastaExclusivo`.
 */
function aMedianoche(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
