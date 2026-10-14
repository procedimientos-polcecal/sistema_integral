/**
 * Qué hay que reponer, y qué no hace falta pedir porque ya está pedido.
 *
 * EL FALTANTE NO ES UNA COLA DE TRABAJO. Medido el 02/10/2026: **521 de los
 * 1.159 artículos tienen faltante** —el 45% del catálogo— y sólo 24 tienen un
 * RI abierto. Quedan 497 "pendientes" que nadie cargó en años, así que esa
 * lista es una referencia y no una bandeja.
 *
 * Lo que la vuelve accionable no es el stock sino **el consumo**: con una
 * ventana de seis meses, 402 de esos 497 no se movieron. El corte de acá abajo
 * es más corto (90 días) y deja 92 artículos, que no salen todos de los 497: son
 * 75 de los que no tenían pedido, para pedir, más 17 de los 24 que ya tenían un
 * RI abierto — una lista que alguien puede terminar.
 *
 * Esto vive aparte de la pantalla porque es la parte que decide. Un corte mal
 * puesto hace que se pida de más o que no se vea lo que se acabó, y ninguna de
 * las dos cosas se nota mirando la pantalla.
 */

/**
 * La ventana de consumo, en días. Medido el 02/10/2026 sobre los 497 faltantes
 * sin pedido: con 30 días quedan 28, con 90 quedan 75 y con 180 quedan 95. Se
 * eligió un trimestre porque un repuesto que se usa cada dos meses tiene que
 * entrar. Es un corte y no un hecho: si resulta corto o largo, se mueve acá.
 */
export const DIAS_DE_CONSUMO = 90;

/**
 * Qué estados cierran un pedido. Todo lo demás —`SIN_INICIAR`,
 * `PARA_COMPRAR`, `EN_COMPARATIVA`, `EN_ESPERA`, `APROBADO`, `PEDIDO`— cuenta
 * como abierto.
 */
const COMPRA_CERRADA = new Set(["RECIBIDO", "DENEGADO"]);

export interface ArticuloConFaltante {
  id: string;
  codigo: string;
  descripcion: string;
  stock_actual: number;
  stock_seguridad: number;
  faltante: number;
  activo?: boolean | null;
}

/**
 * Un movimiento con su tipo, **no una salida ya filtrada**.
 *
 * El filtro va adentro a propósito: que una entrada no justifique un pedido es
 * una de las decisiones de esta función, y si la consulta la filtrara, acá no
 * habría nada que probar.
 */
export interface MovimientoDelConsumo {
  codigo: string;
  tipo: string;
  /** ISO `2026-09-30`, o null: el kardex tiene filas sin fecha. */
  fecha: string | null;
}

export interface RequerimientoConCodigo {
  id: string;
  nro_ri: number;
  codigo: string | null;
  fecha: string | null;
  estado_aprobacion: string | null;
  estado_compra: string | null;
}

export interface Candidato {
  articulo: ArticuloConFaltante;
  /** Cuántas salidas tuvo dentro de la ventana. */
  salidas: number;
  /** Hace cuántos días fue la última. */
  diasDesdeLaUltima: number;
}

export interface ConPedido extends Candidato {
  /** El RI abierto más nuevo. */
  ri: RequerimientoConCodigo;
  /** Cuántos abiertos tiene ese código. Más de uno ya pasa: el 00666 tiene tres. */
  cuantosAbiertos: number;
  /** Hace cuántos días se pidió. */
  diasDelRi: number;
}

export interface Reposicion {
  paraPedir: Candidato[];
  yaPedidos: ConPedido[];
}

/** El pedido abierto más nuevo de un código, y cuántos hay. */
export interface PedidoAbierto {
  ri: RequerimientoConCodigo;
  /** Cuántos abiertos tiene ese código. Más de uno ya pasa: el 00666 tiene tres. */
  cuantosAbiertos: number;
  /** Hace cuántos días se pidió. */
  diasDelRi: number;
}

/** Los valores con los que se abre el formulario de alta, ya precargado. */
export interface AltaDeReposicion {
  descripcion: string;
  codigo: string;
  cantidad: string;
  detalle: string;
}

/**
 * Si un pedido sigue en curso.
 *
 * `estado_compra` en null es un pedido que recién entra, no uno cerrado: la
 * fila nace así hasta que Compras la toma.
 */
export function estaAbierto(
  ri: Pick<RequerimientoConCodigo, "estado_aprobacion" | "estado_compra">
): boolean {
  if (ri.estado_aprobacion === "DENEGADA") return false;
  return !COMPRA_CERRADA.has(String(ri.estado_compra ?? ""));
}

/** Días entre dos fechas ISO, en UTC para que no dependa del huso de quien mire. */
function diasEntre(desde: string, hasta: string): number | null {
  const a = Date.parse(`${desde.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${hasta.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

const clave = (v: string | null | undefined) => String(v ?? "").trim();

/**
 * Los pedidos en curso, por código de artículo.
 *
 * Lo usan las dos pantallas que pueden pedir: `/inventario/reponer`, para
 * separar lo que ya está pedido de lo que no, y `/inventario/stock`, para
 * avisar antes de pedir de nuevo. Vive acá y no en cada una porque el cálculo
 * de la antigüedad tiene una trampa medida que no se puede reinventar bien dos
 * veces — está en el comentario del clamp, abajo.
 *
 * Los abiertos de cada código vienen **del más nuevo al más viejo**: lo que
 * interesa contestar es "¿esto se pidió recién?", no cuál fue el primero.
 */
export function pedidosAbiertosPorCodigo(
  requerimientos: RequerimientoConCodigo[],
  hoy: string
): Map<string, PedidoAbierto> {
  const abiertos = new Map<string, RequerimientoConCodigo[]>();
  for (const r of requerimientos) {
    const c = clave(r.codigo);
    if (!c || !estaAbierto(r)) continue;
    if (!abiertos.has(c)) abiertos.set(c, []);
    abiertos.get(c)!.push(r);
  }

  const porCodigo = new Map<string, PedidoAbierto>();
  for (const [c, lista] of abiertos) {
    lista.sort((a, b) => String(b.fecha ?? "").localeCompare(String(a.fecha ?? "")));
    const ri = lista[0];
    porCodigo.set(c, {
      ri,
      cuantosAbiertos: lista.length,
      // `Math.max(0, …)` cubre dos cosas, y la segunda es la que importa.
      //
      // `compras_requerimientos.fecha` es `timestamptz`, no `date`. Los RI que
      // vienen de la planilla guardan el día como medianoche UTC, así que su día
      // UTC es el correcto; pero el alta del SdG toma el `now()` por defecto, y
      // uno cargado a las 21:30 de Argentina cae en el día UTC siguiente y daría
      // -1. Dura hasta la próxima sincronización, que le reescribe la fecha con
      // el día de la planilla — o sea justo la ventana en la que esto existe
      // para que nadie vuelva a pedir lo que se acaba de pedir.
      //
      // Y una fecha ausente o ilegible: hoy no se da —la columna es `not null` y
      // el 02/10/2026 hay 0 RI con código sin fecha— pero si llegara saldría
      // "hoy", que es la lectura más optimista y no inventa una antigüedad.
      diasDelRi: Math.max(0, (ri.fecha ? diasEntre(ri.fecha, hoy) : null) ?? 0),
    });
  }
  return porCodigo;
}

/**
 * El pedido abierto **tal como viaja a la pantalla**, aplanado.
 *
 * `PedidoAbierto` lleva el RI entero, que del otro lado nadie usa; esto es lo
 * único que la fila necesita para dibujarse y para armar el cartel. Vive acá y
 * no en cada pantalla porque lo arman la ruta y lo leen dos clientes: escrito
 * tres veces a mano, basta que uno agregue un campo para que se separen.
 */
export interface RiAbierto {
  id: string;
  nro_ri: number;
  diasDelRi: number;
  cuantosAbiertos: number;
}

/** Lo que de un pedido abierto le sirve a la pantalla. */
export function riAbiertoDe(pedido: PedidoAbierto): RiAbierto {
  return {
    id: pedido.ri.id,
    nro_ri: pedido.ri.nro_ri,
    diasDelRi: pedido.diasDelRi,
    cuantosAbiertos: pedido.cuantosAbiertos,
  };
}

/** Lo que muestra el cartel antes de pedir algo que ya tiene pedido. */
export interface AvisoDePedido {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
}

/**
 * El cartel que sale al pedir algo que ya tiene un RI abierto.
 *
 * **Avisa, no bloquea.** Desde el stock y desde el catálogo el caso legítimo
 * existe —el pedido viejo quedó trabado, o hace falta más cantidad— y la
 * persona eligió ese artículo a propósito. Y bloquear sería peor que inútil:
 * hay RI abiertos de hace más de 350 días (el `00004`, el `00244`), así que
 * esos artículos quedarían imposibles de pedir para siempre. Lo que no puede
 * pasar es pedir de nuevo **sin enterarse**, que es lo que hace hoy el Apps
 * Script de la planilla y por lo que seis códigos acumulan más de un RI.
 *
 * En `/inventario/reponer` la regla es la otra —lo ya pedido va a un grupo sin
 * botón— y la diferencia es deliberada: esa lista propone, las otras dos no.
 *
 * Vive acá y no en la pantalla porque lo arman dos, y un cartel duplicado es un
 * cartel que se separa. Los botones dicen qué hace cada uno en vez de «Sí» y
 * «No»: lo que se está confirmando no es una pregunta de sí o no, es una
 * acción con consecuencia.
 */
export function avisoDePedidoAbierto(pedido: RiAbierto): AvisoDePedido {
  const cuando =
    pedido.diasDelRi === 0
      ? "hoy"
      : `hace ${pedido.diasDelRi} día${pedido.diasDelRi === 1 ? "" : "s"}`;
  // Con uno solo la cuenta no agrega nada; con tres cambia la decisión.
  const cuantos =
    pedido.cuantosAbiertos > 1 ? ` (y hay ${pedido.cuantosAbiertos} abiertos en total)` : "";

  return {
    title: "Esto ya está pedido",
    message:
      `El RI ${pedido.nro_ri} se pidió ${cuando} y sigue abierto${cuantos}. ` +
      `Si pedís de nuevo vas a crear un segundo pedido del mismo artículo.`,
    confirmText: "Pedir igual",
    cancelText: "No pedir",
  };
}

/**
 * Con qué valores se abre el formulario de alta para reponer un artículo.
 *
 * **La cantidad es el stock de seguridad y no el faltante**, que es lo que ya
 * hace el Apps Script de la planilla, y lo medido le da la razón: se compra por
 * lote y no por diferencia —falta 2 pidió 4, falta 15 pidió 30, falta 1 pidió
 * 10—. Ninguno de los pedidos reales pidió el faltante exacto, así que proponer
 * la diferencia propondría sistemáticamente menos de lo que se termina
 * comprando.
 *
 * Todo es editable antes de enviar: esto propone, no decide. Y vive acá porque
 * lo arman dos pantallas: con una copia en cada una, este texto y esta regla se
 * separan sin que nadie lo note.
 */
export function altaDeReposicion(articulo: ArticuloConFaltante): AltaDeReposicion {
  return {
    descripcion: articulo.descripcion,
    codigo: articulo.codigo,
    cantidad: String(articulo.stock_seguridad),
    detalle:
      `Reposición de stock. Había ${articulo.stock_actual} ` +
      `de un mínimo de ${articulo.stock_seguridad}.`,
  };
}

/**
 * Parte los artículos en los dos grupos de la pantalla.
 *
 * Entra el que tiene faltante, está activo y tuvo **al menos una salida** en la
 * ventana. Se ordena por cantidad de salidas: lo que más se mueve queda arriba,
 * que es como se corta una lista larga sin tener que decidir dónde termina.
 *
 * El que además tiene un RI abierto va a `yaPedidos` y no a `paraPedir`, con
 * cuál es y de cuándo. No se oculta: quien busca algo que sabe que falta tiene
 * que poder distinguir "el sistema no lo vio" de "ya está pedido", que son dos
 * problemas con dos arreglos distintos.
 */
export function clasificarParaReponer(
  articulos: ArticuloConFaltante[],
  movimientos: MovimientoDelConsumo[],
  requerimientos: RequerimientoConCodigo[],
  hoy: string
): Reposicion {
  // El consumo, por código: cuántas salidas y cuál fue la última.
  const consumo = new Map<string, { salidas: number; diasDesdeLaUltima: number }>();
  for (const m of movimientos) {
    if (m.tipo !== "salida") continue;
    const c = clave(m.codigo);
    if (!c || !m.fecha) continue;

    const d = diasEntre(m.fecha, hoy);
    // Fuera de la ventana, o en el futuro —que es una fila mal cargada y no un
    // consumo—, no cuenta.
    if (d === null || d < 0 || d > DIAS_DE_CONSUMO) continue;

    const previo = consumo.get(c);
    consumo.set(c, {
      salidas: (previo?.salidas ?? 0) + 1,
      diasDesdeLaUltima: Math.min(previo?.diasDesdeLaUltima ?? d, d),
    });
  }

  // Los pedidos abiertos, por código. La misma función que usa el stock para
  // avisar antes de pedir de nuevo: una sola definición de "ya está pedido".
  const abiertos = pedidosAbiertosPorCodigo(requerimientos, hoy);

  const paraPedir: Candidato[] = [];
  const yaPedidos: ConPedido[] = [];

  for (const articulo of articulos) {
    if (articulo.activo === false) continue;
    if (!(Number(articulo.faltante) > 0)) continue;

    const c = clave(articulo.codigo);
    const uso = consumo.get(c);
    if (!uso) continue;

    const base: Candidato = { articulo, salidas: uso.salidas, diasDesdeLaUltima: uso.diasDesdeLaUltima };
    const pedido = abiertos.get(c);

    if (!pedido) {
      paraPedir.push(base);
      continue;
    }

    yaPedidos.push({
      ...base,
      ri: pedido.ri,
      cuantosAbiertos: pedido.cuantosAbiertos,
      diasDelRi: pedido.diasDelRi,
    });
  }

  // Primero lo que más se mueve; a igual uso, lo más reciente; y a igual todo,
  // por código — si no, el orden lo decide en qué orden vino la consulta y la
  // pantalla se reordena sola entre dos cargas.
  const orden = (a: Candidato, b: Candidato) =>
    b.salidas - a.salidas ||
    a.diasDesdeLaUltima - b.diasDesdeLaUltima ||
    clave(a.articulo.codigo).localeCompare(clave(b.articulo.codigo));

  paraPedir.sort(orden);
  yaPedidos.sort(orden);

  return { paraPedir, yaPedidos };
}
