/**
 * Qué hay que reponer, y qué no hace falta pedir porque ya está pedido.
 *
 * EL FALTANTE NO ES UNA COLA DE TRABAJO. Medido el 02/10/2026: **521 de los
 * 1.159 artículos tienen faltante** —el 45% del catálogo— y sólo 24 tienen un
 * RI abierto. Quedan 497 "pendientes" que nadie cargó en años, así que esa
 * lista es una referencia y no una bandeja.
 *
 * Lo que la vuelve accionable no es el stock sino **el consumo**: 402 de esos
 * 497 no se movieron en seis meses. Con el corte de acá abajo quedan 92, que se
 * parten en 75 para pedir y 17 que ya tienen pedido — una lista que alguien
 * puede terminar.
 *
 * Esto vive aparte de la pantalla porque es la parte que decide. Un corte mal
 * puesto hace que se pida de más o que no se vea lo que se acabó, y ninguna de
 * las dos cosas se nota mirando la pantalla.
 */

/** La ventana de consumo, en días. */
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
  cuantos: number;
  /** Hace cuántos días se pidió. */
  diasDelRi: number;
}

export interface Reposicion {
  paraPedir: Candidato[];
  yaPedidos: ConPedido[];
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

  // Los pedidos abiertos, por código, del más nuevo al más viejo.
  const abiertos = new Map<string, RequerimientoConCodigo[]>();
  for (const r of requerimientos) {
    const c = clave(r.codigo);
    if (!c || !estaAbierto(r)) continue;
    if (!abiertos.has(c)) abiertos.set(c, []);
    abiertos.get(c)!.push(r);
  }
  for (const lista of abiertos.values()) {
    lista.sort((a, b) => String(b.fecha ?? "").localeCompare(String(a.fecha ?? "")));
  }

  const paraPedir: Candidato[] = [];
  const yaPedidos: ConPedido[] = [];

  for (const articulo of articulos) {
    if (articulo.activo === false) continue;
    if (!(Number(articulo.faltante) > 0)) continue;

    const c = clave(articulo.codigo);
    const uso = consumo.get(c);
    if (!uso) continue;

    const base: Candidato = { articulo, salidas: uso.salidas, diasDesdeLaUltima: uso.diasDesdeLaUltima };
    const pedidos = abiertos.get(c);

    if (!pedidos || pedidos.length === 0) {
      paraPedir.push(base);
      continue;
    }

    const ri = pedidos[0];
    yaPedidos.push({
      ...base,
      ri,
      cuantos: pedidos.length,
      diasDelRi: (ri.fecha ? diasEntre(ri.fecha, hoy) : null) ?? 0,
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
