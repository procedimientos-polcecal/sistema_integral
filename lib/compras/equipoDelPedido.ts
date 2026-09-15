/**
 * Cuál es el equipo de un pedido, cuando hay dos formas de saberlo.
 *
 * Desde el 15/09/2026 conviven dos:
 *
 *   - **el declarado**: la columna EQUIPO de la planilla, que ahora pregunta el
 *     formulario, y el desplegable del alta en el sistema;
 *   - **el inferido**: el equipo al que apunta la ubicación del pedido
 *     (`compras_ubicaciones.equipo_id`), que es de donde salían hasta hoy el
 *     filtro por equipo y el gasto por equipo.
 *
 * **Gana el declarado.** Lo contestó la persona que hizo el pedido sobre su
 * propio pedido; lo otro es una deducción a partir de un lugar, y un lugar
 * puede servir a varios equipos. Cuando no hay declarado se sigue infiriendo,
 * que es lo que mantiene en pie a los 1.968 requerimientos anteriores a la
 * columna: si el declarado reemplazara a la inferencia en vez de anteponerse,
 * el filtro y el tablero se habrían vaciado de golpe.
 *
 * La regla vive acá y no adentro de cada consulta justamente porque son varios
 * los lugares que la necesitan —el filtro, el gasto por equipo, la ficha— y una
 * regla de precedencia repartida en tres lados es una regla que en algún lado
 * está distinta.
 *
 * Ojo con lo que **no** es null acá. `equipo_id` en null no significa "este
 * pedido no es de ningún equipo": significa que no se lo pudo reconocer, y para
 * eso está `equipo_raw`. Por eso `equipoDelPedido` puede devolver un origen
 * `"declarado-sin-enlazar"`: hay un equipo dicho, no se lo pudo enlazar al
 * catálogo, y eso **no** habilita a caer en la inferencia — la persona ya
 * contestó, y taparlo con una deducción sería mostrar un equipo que nadie dijo.
 */

export interface PedidoConEquipo {
  /** Lo que declaró quien pidió, tal como vino de la planilla o del alta. */
  equipo_raw?: string | null;
  /** El equipo declarado, enlazado al catálogo del núcleo. */
  equipo_id?: string | null;
  /** El equipo al que apunta la ubicación del pedido. */
  ubicacion_equipo_id?: string | null;
}

export type OrigenDelEquipo =
  | "declarado"
  | "declarado-sin-enlazar"
  | "ubicacion"
  | "ninguno";

export interface EquipoResuelto {
  /** El id con el que hay que filtrar y agrupar. Null si no hay ninguno usable. */
  id: string | null;
  /** De dónde salió, que es lo que hay que poder explicar en pantalla. */
  origen: OrigenDelEquipo;
  /** El texto declarado, cuando lo hay. Sirve para mostrarlo sin enlace. */
  texto: string | null;
}

const limpio = (v: string | null | undefined): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

/** El equipo de un pedido y de dónde salió. */
export function equipoDelPedido(p: PedidoConEquipo): EquipoResuelto {
  const texto = limpio(p.equipo_raw);

  if (p.equipo_id) return { id: p.equipo_id, origen: "declarado", texto };

  // Hay equipo dicho pero sin enlazar. No se cae a la inferencia: la persona ya
  // contestó y taparlo con una deducción mostraría un equipo que nadie dijo.
  if (texto) return { id: null, origen: "declarado-sin-enlazar", texto };

  if (p.ubicacion_equipo_id) {
    return { id: p.ubicacion_equipo_id, origen: "ubicacion", texto: null };
  }

  return { id: null, origen: "ninguno", texto: null };
}

/**
 * Si un pedido cuenta para un equipo dado.
 *
 * Es lo que necesitan el filtro y el gasto por equipo, y se apoya en la misma
 * precedencia: un pedido que declaró otro equipo **no** entra por su ubicación,
 * aunque la ubicación apunte al equipo buscado. Sin esa segunda mitad, un
 * pedido declarado para el molino seguiría sumando al equipo del galpón donde
 * se lo entrega, y el número dejaría de querer decir lo que dice.
 */
export function esDelEquipo(p: PedidoConEquipo, equipoId: string): boolean {
  return equipoDelPedido(p).id === equipoId;
}
