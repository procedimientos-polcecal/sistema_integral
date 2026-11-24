import { describe, it, expect } from "vitest";
import {
  clasificarParaReponer, estaAbierto, altaDeReposicion, pedidosAbiertosPorCodigo,
  avisoDePedidoAbierto, ordenarParaReponer, filtrarParaReponer, cuantoFalta,
  riConEntrada,
  ORDENES_DE_REPOSICION, ORDEN_POR_DEFECTO,
  DIAS_DE_CONSUMO,
} from "./reponer";
import type {
  ArticuloConFaltante, MovimientoDelConsumo, RequerimientoConCodigo,
  Candidato, OrdenDeReposicion, EntradaDeRequerimiento,
} from "./reponer";

const HOY = "2026-10-02";

const art = (p: Partial<ArticuloConFaltante> = {}): ArticuloConFaltante => ({
  id: "a1",
  codigo: "00018",
  descripcion: "AIRE COMPRIMIDO AEROSOL",
  stock_actual: 0,
  stock_seguridad: 2,
  faltante: 2,
  activo: true,
  ...p,
});

const salida = (codigo: string, fecha: string): MovimientoDelConsumo =>
  ({ codigo, tipo: "salida", fecha });

const ri = (p: Partial<RequerimientoConCodigo> = {}): RequerimientoConCodigo => ({
  id: "r1",
  nro_ri: 2015,
  codigo: "00018",
  fecha: "2026-09-22",
  estado_aprobacion: "APROBADA",
  estado_compra: "PEDIDO",
  ...p,
});

/**
 * "No llego nada todavia", que es el caso de casi todos estos tests.
 *
 * Se nombra en vez de escribir `new Set()` cuarenta veces porque el dato que
 * importa no es que este vacio sino que el test habla del estado y no de la
 * recepcion. Los que si hablan de ella arman el suyo con `recibido()`.
 */
const NADA: ReadonlySet<string> = new Set<string>();

describe("que RI esta abierto", () => {
  it("un pedido en curso esta abierto", () => {
    expect(estaAbierto(ri({ estado_compra: "PEDIDO" }), NADA)).toBe(true);
    expect(estaAbierto(ri({ estado_compra: "SIN_INICIAR" }), NADA)).toBe(true);
    expect(estaAbierto(ri({ estado_compra: "PARA_COMPRAR" }), NADA)).toBe(true);
  });

  it("recibido y denegado lo cierran", () => {
    expect(estaAbierto(ri({ estado_compra: "RECIBIDO" }), NADA)).toBe(false);
    expect(estaAbierto(ri({ estado_compra: "DENEGADO" }), NADA)).toBe(false);
  });

  it("una aprobacion denegada lo cierra aunque la compra no diga nada", () => {
    expect(estaAbierto(ri({ estado_aprobacion: "DENEGADA", estado_compra: null }), NADA)).toBe(false);
  });

  /** Sin estado de compra es un pedido que recien entra, no uno cerrado. */
  it("sin estado de compra sigue abierto", () => {
    expect(estaAbierto(ri({ estado_compra: null }), NADA)).toBe(true);
  });
});

describe("que entra en para reponer", () => {
  it("faltante y consumo reciente entra", () => {
    const r = clasificarParaReponer([art()], [salida("00018", "2026-09-20")], [], HOY, NADA);
    expect(r.paraPedir.map((c) => c.articulo.codigo)).toEqual(["00018"]);
    expect(r.yaPedidos).toEqual([]);
  });

  it("sin faltante no entra, aunque se haya usado ayer", () => {
    const r = clasificarParaReponer(
      [art({ faltante: 0, stock_actual: 5 })],
      [salida("00018", "2026-10-01")],
      [],
      HOY,
      NADA
    );
    expect(r.paraPedir).toEqual([]);
    expect(r.yaPedidos).toEqual([]);
  });

  /**
   * El caso de los 402: con faltante, en cero, y sin moverse en seis meses.
   * Es el ruido que esta pantalla existe para no mostrar.
   */
  it("con faltante pero sin salidas en la ventana no entra, aunque este en cero", () => {
    const r = clasificarParaReponer([art()], [salida("00018", "2026-03-01")], [], HOY, NADA);
    expect(r.paraPedir).toEqual([]);
  });

  it("un articulo sin ningun movimiento no entra", () => {
    const r = clasificarParaReponer([art()], [], [], HOY, NADA);
    expect(r.paraPedir).toEqual([]);
  });

  it("una salida de hace exactamente 90 dias entra; una de 91 no", () => {
    const justo = clasificarParaReponer([art()], [salida("00018", "2026-07-04")], [], HOY, NADA);
    expect(justo.paraPedir).toHaveLength(1);

    const tarde = clasificarParaReponer([art()], [salida("00018", "2026-07-03")], [], HOY, NADA);
    expect(tarde.paraPedir).toEqual([]);
  });

  /** Una entrada repone, no consume: no puede justificar que haya que pedir mas. */
  it("una entrada no cuenta como consumo", () => {
    const r = clasificarParaReponer(
      [art()],
      [{ codigo: "00018", tipo: "entrada", fecha: "2026-09-20" }],
      [],
      HOY,
      NADA
    );
    expect(r.paraPedir).toEqual([]);
  });

  it("un ajuste tampoco cuenta", () => {
    const r = clasificarParaReponer(
      [art()],
      [{ codigo: "00018", tipo: "ajuste", fecha: "2026-09-20" }],
      [],
      HOY,
      NADA
    );
    expect(r.paraPedir).toEqual([]);
  });

  it("un articulo inactivo no entra en ninguno de los dos", () => {
    const r = clasificarParaReponer(
      [art({ activo: false })],
      [salida("00018", "2026-09-20")],
      [ri()],
      HOY,
      NADA
    );
    expect(r.paraPedir).toEqual([]);
    expect(r.yaPedidos).toEqual([]);
  });

  it("una salida con fecha en el futuro no cuenta", () => {
    const r = clasificarParaReponer([art()], [salida("00018", "2026-10-20")], [], HOY, NADA);
    expect(r.paraPedir).toEqual([]);
  });

  it("una salida sin fecha no rompe ni cuenta", () => {
    const r = clasificarParaReponer(
      [art()],
      [{ codigo: "00018", tipo: "salida", fecha: null }],
      [],
      HOY,
      NADA
    );
    expect(r.paraPedir).toEqual([]);
  });

  it("cuenta las salidas y dice hace cuanto fue la ultima", () => {
    const r = clasificarParaReponer(
      [art()],
      [salida("00018", "2026-09-20"), salida("00018", "2026-09-30"), salida("00018", "2026-08-01")],
      [],
      HOY,
      NADA
    );
    expect(r.paraPedir[0].salidas).toBe(3);
    expect(r.paraPedir[0].diasDesdeLaUltima).toBe(2);
  });
});

describe("lo que ya esta pedido", () => {
  it("con un RI abierto va a yaPedidos y no a paraPedir", () => {
    const r = clasificarParaReponer([art()], [salida("00018", "2026-09-20")], [ri()], HOY, NADA);
    expect(r.paraPedir).toEqual([]);
    expect(r.yaPedidos).toHaveLength(1);
    expect(r.yaPedidos[0].ri.nro_ri).toBe(2015);
    expect(r.yaPedidos[0].cuantosAbiertos).toBe(1);
    expect(r.yaPedidos[0].diasDelRi).toBe(10);
  });

  /**
   * Como llega de PostgREST: `fecha` es timestamptz, no date. El `slice(0,10)`
   * es lo que hace andar la produccion y ningun test lo tocaba.
   */
  it("una fecha en forma de timestamp se lee igual", () => {
    const r = clasificarParaReponer(
      [art()],
      [salida("00018", "2026-09-20")],
      [ri({ fecha: "2026-09-22T00:00:00+00:00" })],
      HOY,
      NADA
    );
    expect(r.yaPedidos[0].diasDelRi).toBe(10);
  });

  /**
   * Un RI cargado a las 21:30 de Argentina cae en el dia UTC siguiente. Sin el
   * clamp la pantalla diria "hace -1 dias".
   */
  it("un pedido cargado de noche no da una antiguedad negativa", () => {
    const r = clasificarParaReponer(
      [art()],
      [salida("00018", "2026-09-20")],
      [ri({ fecha: "2026-10-03T00:30:00+00:00" })],
      HOY,
      NADA
    );
    expect(r.yaPedidos[0].diasDelRi).toBe(0);
  });

  it("si su unico RI esta recibido vuelve a paraPedir", () => {
    const r = clasificarParaReponer(
      [art()],
      [salida("00018", "2026-09-20")],
      [ri({ estado_compra: "RECIBIDO" })],
      HOY,
      NADA
    );
    expect(r.paraPedir).toHaveLength(1);
    expect(r.yaPedidos).toEqual([]);
  });

  it("si su unico RI esta denegado vuelve a paraPedir", () => {
    const r = clasificarParaReponer(
      [art()],
      [salida("00018", "2026-09-20")],
      [ri({ estado_aprobacion: "DENEGADA" })],
      HOY,
      NADA
    );
    expect(r.paraPedir).toHaveLength(1);
  });

  /**
   * El caso del 00666, que tiene tres abiertos: el 1956 de hace 22 dias y los
   * 983/984 de hace 175. Se informa el mas nuevo y cuantos hay.
   */
  it("con varios RI abiertos informa el mas nuevo y cuantos son", () => {
    const r = clasificarParaReponer(
      [art({ codigo: "00666" })],
      [salida("00666", "2026-09-20")],
      [
        ri({ id: "viejo", nro_ri: 983, codigo: "00666", fecha: "2026-04-10" }),
        ri({ id: "nuevo", nro_ri: 1956, codigo: "00666", fecha: "2026-09-10" }),
        ri({ id: "otro", nro_ri: 984, codigo: "00666", fecha: "2026-04-10" }),
      ],
      HOY,
      NADA
    );
    expect(r.yaPedidos[0].ri.nro_ri).toBe(1956);
    expect(r.yaPedidos[0].cuantosAbiertos).toBe(3);
  });

  it("un RI de otro codigo no lo afecta", () => {
    const r = clasificarParaReponer(
      [art()],
      [salida("00018", "2026-09-20")],
      [ri({ codigo: "99999" })],
      HOY,
      NADA
    );
    expect(r.paraPedir).toHaveLength(1);
  });

  it("un RI sin codigo no lo afecta", () => {
    const r = clasificarParaReponer(
      [art()],
      [salida("00018", "2026-09-20")],
      [ri({ codigo: null })],
      HOY,
      NADA
    );
    expect(r.paraPedir).toHaveLength(1);
  });

  it("el codigo se compara sin espacios de sobra", () => {
    const r = clasificarParaReponer(
      [art({ codigo: " 00018 " })],
      [salida("00018", "2026-09-20")],
      [ri({ codigo: "00018 " })],
      HOY,
      NADA
    );
    expect(r.yaPedidos).toHaveLength(1);
  });
});

describe("el orden", () => {
  it("paraPedir va por cantidad de salidas, de mayor a menor", () => {
    const r = clasificarParaReponer(
      [art({ id: "a", codigo: "A" }), art({ id: "b", codigo: "B" }), art({ id: "c", codigo: "C" })],
      [
        salida("A", "2026-09-20"),
        salida("B", "2026-09-20"), salida("B", "2026-09-21"), salida("B", "2026-09-22"),
        salida("C", "2026-09-20"), salida("C", "2026-09-21"),
      ],
      [],
      HOY,
      NADA
    );
    expect(r.paraPedir.map((c) => c.articulo.codigo)).toEqual(["B", "C", "A"]);
  });

  /** Empatados en salidas, primero el que se uso hace menos. */
  it("a igual cantidad de salidas, primero el mas reciente", () => {
    const r = clasificarParaReponer(
      [art({ id: "a", codigo: "A" }), art({ id: "b", codigo: "B" })],
      [salida("A", "2026-08-01"), salida("B", "2026-09-30")],
      [],
      HOY,
      NADA
    );
    expect(r.paraPedir.map((c) => c.articulo.codigo)).toEqual(["B", "A"]);
  });

  it("empatados en todo, por codigo, para que el orden no dependa de la consulta", () => {
    const r = clasificarParaReponer(
      [art({ id: "b", codigo: "B" }), art({ id: "a", codigo: "A" })],
      [salida("A", "2026-09-20"), salida("B", "2026-09-20")],
      [],
      HOY,
      NADA
    );
    expect(r.paraPedir.map((c) => c.articulo.codigo)).toEqual(["A", "B"]);
  });

  it("yaPedidos usa el mismo orden", () => {
    const r = clasificarParaReponer(
      [art({ id: "a", codigo: "A" }), art({ id: "b", codigo: "B" })],
      [salida("A", "2026-09-20"), salida("B", "2026-09-20"), salida("B", "2026-09-21")],
      [ri({ id: "ra", codigo: "A" }), ri({ id: "rb", codigo: "B" })],
      HOY,
      NADA
    );
    expect(r.yaPedidos.map((c) => c.articulo.codigo)).toEqual(["B", "A"]);
  });
});

describe("con que valores se abre el alta", () => {
  it("propone el stock de seguridad y no el faltante", () => {
    // Se compra por lote y no por diferencia: de los pedidos reales que
    // corresponden a un faltante -falta 2 pidio 4, falta 15 pidio 30- ninguno
    // pidio la diferencia exacta. Proponer el faltante propondria de menos.
    const a = altaDeReposicion(art({ stock_actual: 1, stock_seguridad: 5, faltante: 4 }));
    expect(a.cantidad).toBe("5");
  });

  it("la cantidad va como texto, que es lo que espera el formulario", () => {
    expect(typeof altaDeReposicion(art()).cantidad).toBe("string");
  });

  it("lleva la descripcion y el codigo del articulo", () => {
    const a = altaDeReposicion(art({ codigo: "00600", descripcion: "MINI PLAFON LED 18 W" }));
    expect(a.codigo).toBe("00600");
    expect(a.descripcion).toBe("MINI PLAFON LED 18 W");
  });

  it("el detalle dice los numeros reales, para que quien aprueba no tenga que buscarlos", () => {
    const a = altaDeReposicion(art({ stock_actual: 0, stock_seguridad: 4 }));
    expect(a.detalle).toBe("Reposición de stock. Había 0 de un mínimo de 4.");
  });
});

describe("los pedidos abiertos por codigo", () => {
  it("un codigo sin RI no esta en el mapa", () => {
    const m = pedidosAbiertosPorCodigo([ri({ codigo: "00018" })], HOY, NADA);
    expect(m.has("00999")).toBe(false);
  });

  it("un RI cerrado no cuenta", () => {
    const m = pedidosAbiertosPorCodigo([ri({ estado_compra: "RECIBIDO" })], HOY, NADA);
    expect(m.size).toBe(0);
  });

  it("una aprobacion denegada tampoco", () => {
    const m = pedidosAbiertosPorCodigo([ri({ estado_aprobacion: "DENEGADA" })], HOY, NADA);
    expect(m.size).toBe(0);
  });

  it("con varios abiertos informa el mas nuevo y cuantos hay", () => {
    // El caso real del 00666, que el 2/10/2026 tenia tres abiertos a la vez.
    const m = pedidosAbiertosPorCodigo([
      ri({ id: "v", nro_ri: 983, codigo: "00666", fecha: "2026-04-10" }),
      ri({ id: "n", nro_ri: 1956, codigo: "00666", fecha: "2026-09-28" }),
      ri({ id: "m", nro_ri: 984, codigo: "00666", fecha: "2026-04-11" }),
    ], HOY, NADA);
    const p = m.get("00666")!;
    expect(p.ri.nro_ri).toBe(1956);
    expect(p.cuantosAbiertos).toBe(3);
    expect(p.diasDelRi).toBe(4);
  });

  it("los cerrados no inflan la cuenta de abiertos", () => {
    const m = pedidosAbiertosPorCodigo([
      ri({ id: "a", nro_ri: 1, fecha: "2026-09-30" }),
      ri({ id: "b", nro_ri: 2, fecha: "2026-10-01", estado_compra: "RECIBIDO" }),
    ], HOY, NADA);
    expect(m.get("00018")!.cuantosAbiertos).toBe(1);
    expect(m.get("00018")!.ri.nro_ri).toBe(1);
  });

  it("un RI cargado de noche no puede tener antiguedad negativa", () => {
    // `fecha` es timestamptz: uno cargado 21:30 en Argentina cae en el dia UTC
    // siguiente, y sin el clamp daria -1.
    const m = pedidosAbiertosPorCodigo([ri({ fecha: "2026-10-03" })], HOY, NADA);
    expect(m.get("00018")!.diasDelRi).toBe(0);
  });

  it("sin fecha dice hoy, que es lo que no inventa una antiguedad", () => {
    const m = pedidosAbiertosPorCodigo([ri({ fecha: null })], HOY, NADA);
    expect(m.get("00018")!.diasDelRi).toBe(0);
  });

  it("ignora el codigo vacio, que no se puede cruzar con nada", () => {
    expect(pedidosAbiertosPorCodigo([ri({ codigo: null })], HOY, NADA).size).toBe(0);
    expect(pedidosAbiertosPorCodigo([ri({ codigo: "  " })], HOY, NADA).size).toBe(0);
  });
});

describe("el aviso de que ya esta pedido", () => {
  const abierto = (p = {}) => ({ id: "r1", nro_ri: 2015, cuantosAbiertos: 1, diasDelRi: 3, ...p });

  it("dice cual es el pedido y hace cuanto", () => {
    const a = avisoDePedidoAbierto(abierto({ nro_ri: 2051, diasDelRi: 3 }));
    expect(a.message).toContain("El RI 2051");
    expect(a.message).toContain("hace 3 días");
  });

  it("en singular dice un dia, no 1 dias", () => {
    expect(avisoDePedidoAbierto(abierto({ diasDelRi: 1 })).message).toContain("hace 1 día");
    expect(avisoDePedidoAbierto(abierto({ diasDelRi: 1 })).message).not.toContain("1 días");
  });

  it("el mismo dia dice hoy y no hace 0 dias", () => {
    const m = avisoDePedidoAbierto(abierto({ diasDelRi: 0 })).message;
    expect(m).toContain("hoy");
    expect(m).not.toContain("0 día");
  });

  it("con varios abiertos lo dice, porque cambia la decision", () => {
    // El caso del 00666: con tres abiertos, pedir un cuarto casi nunca es lo
    // que alguien quiere, y sin este dato el cartel se lee igual que con uno.
    expect(avisoDePedidoAbierto(abierto({ cuantosAbiertos: 3 })).message)
      .toContain("3 abiertos en total");
  });

  it("con uno solo no habla de la cantidad, que seria ruido", () => {
    expect(avisoDePedidoAbierto(abierto({ cuantosAbiertos: 1 })).message)
      .not.toContain("en total");
  });

  it("los botones dicen que hace cada uno, no si y no", () => {
    const a = avisoDePedidoAbierto(abierto());
    expect(a.confirmText).toBe("Pedir igual");
    expect(a.cancelText).toBe("No pedir");
  });

  it("avisa que el resultado es un segundo pedido, que es la consecuencia real", () => {
    expect(avisoDePedidoAbierto(abierto()).message).toContain("segundo pedido");
  });
});

describe("la ventana", () => {
  it("son 90 dias", () => {
    expect(DIAS_DE_CONSUMO).toBe(90);
  });
});

describe("ordenar la lista", () => {
  const cand = (p: Partial<ArticuloConFaltante> & {
    salidas?: number; diasDesdeLaUltima?: number;
  } = {}): Candidato => {
    const { salidas = 1, diasDesdeLaUltima = 10, ...resto } = p;
    return { articulo: art(resto), salidas, diasDesdeLaUltima };
  };

  const codigos = (lista: Candidato[]) => lista.map((c) => c.articulo.codigo);

  it("por descripcion ignora mayusculas y acentos", () => {
    // Sin normalizar, `localeCompare` deja «arbol» despues de «Zapata» porque
    // compara el caso antes que la letra, y ese es justo el error que se ve en
    // pantalla sin que nadie lo pueda explicar.
    const lista = [
      cand({ codigo: "00003", descripcion: "zapata de freno" }),
      cand({ codigo: "00001", descripcion: "Árbol de levas" }),
      cand({ codigo: "00002", descripcion: "BUJE DE BRONCE" }),
    ];
    expect(codigos(ordenarParaReponer(lista, "descripcion")))
      .toEqual(["00001", "00002", "00003"]);
  });

  it("por descripcion el 9 va antes que el 10", () => {
    const lista = [
      cand({ codigo: "00002", descripcion: "BUJE 10" }),
      cand({ codigo: "00001", descripcion: "BUJE 9" }),
    ];
    expect(codigos(ordenarParaReponer(lista, "descripcion")))
      .toEqual(["00001", "00002"]);
  });

  it("por codigo, en el orden del catalogo", () => {
    const lista = [cand({ codigo: "00345" }), cand({ codigo: "00018" }), cand({ codigo: "01002" })];
    expect(codigos(ordenarParaReponer(lista, "codigo")))
      .toEqual(["00018", "00345", "01002"]);
  });

  it("por uso, lo que mas se movio arriba", () => {
    const lista = [
      cand({ codigo: "00001", salidas: 2 }),
      cand({ codigo: "00002", salidas: 9 }),
      cand({ codigo: "00003", salidas: 5 }),
    ];
    expect(codigos(ordenarParaReponer(lista, "uso")))
      .toEqual(["00002", "00003", "00001"]);
  });

  it("por lo que mas falta usa la proporcion y no el faltante crudo", () => {
    // El caso que justifica la funcion: faltan 30 bolsas de un minimo de 500 y
    // falta 1 rodamiento de un minimo de 1. Ordenado por faltante crudo, el
    // rodamiento —del que no queda ninguno— queda ultimo.
    const lista = [
      cand({ codigo: "00001", stock_actual: 470, stock_seguridad: 500, faltante: 30 }),
      cand({ codigo: "00002", stock_actual: 0, stock_seguridad: 1, faltante: 1 }),
    ];
    expect(codigos(ordenarParaReponer(lista, "falta"))).toEqual(["00002", "00001"]);
  });

  it("cuantoFalta es 1 cuando no queda nada y no se pasa de 1", () => {
    expect(cuantoFalta(art({ stock_actual: 0, stock_seguridad: 4, faltante: 4 }))).toBe(1);
    // Un minimo en cero no puede pasar, pero si pasara la fila no se esconde.
    expect(cuantoFalta(art({ stock_seguridad: 0, faltante: 3 }))).toBe(1);
  });

  it("por la salida mas reciente", () => {
    const lista = [
      cand({ codigo: "00001", diasDesdeLaUltima: 40 }),
      cand({ codigo: "00002", diasDesdeLaUltima: 2 }),
    ];
    expect(codigos(ordenarParaReponer(lista, "ultima"))).toEqual(["00002", "00001"]);
  });

  it("los cinco criterios desempatan por codigo, asi la lista no se reacomoda sola", () => {
    // Todo igual menos el codigo: sin desempate, cada uno de los cinco devuelve
    // el orden en que vino la consulta, que cambia entre dos cargas.
    for (const { valor } of ORDENES_DE_REPOSICION) {
      const lista = [cand({ codigo: "00345", id: "b" }), cand({ codigo: "00018", id: "a" })];
      expect(codigos(ordenarParaReponer(lista, valor))).toEqual(["00018", "00345"]);
    }
  });

  it("no toca la lista que recibe", () => {
    // Ordenar en el lugar lo que llega del servidor hace que React vea el mismo
    // arreglo y no vuelva a dibujar: la pantalla se queda como estaba.
    const lista = [cand({ codigo: "00345" }), cand({ codigo: "00018" })];
    const copia = [...lista];
    ordenarParaReponer(lista, "codigo");
    expect(lista).toEqual(copia);
  });

  it("un orden que no existe cae en el por defecto en vez de romper", () => {
    const lista = [
      cand({ codigo: "00001", salidas: 2 }),
      cand({ codigo: "00002", salidas: 9 }),
    ];
    const inventado = "lo-que-alguien-pego" as OrdenDeReposicion;
    expect(codigos(ordenarParaReponer(lista, inventado)))
      .toEqual(codigos(ordenarParaReponer(lista, ORDEN_POR_DEFECTO)));
  });

  it("el por defecto es uno de los cinco y es el uso", () => {
    expect(ORDENES_DE_REPOSICION.map((o) => o.valor)).toContain(ORDEN_POR_DEFECTO);
    expect(ORDEN_POR_DEFECTO).toBe("uso");
  });

  it("clasificar devuelve los dos grupos ya ordenados por el por defecto", () => {
    const articulos = [
      art({ id: "a", codigo: "00001" }),
      art({ id: "b", codigo: "00002" }),
    ];
    const movimientos = [
      salida("00001", "2026-09-30"),
      salida("00002", "2026-09-30"),
      salida("00002", "2026-09-29"),
    ];
    const { paraPedir } = clasificarParaReponer(articulos, movimientos, [], HOY, NADA);
    expect(paraPedir.map((c) => c.articulo.codigo)).toEqual(["00002", "00001"]);
  });
});

describe("buscar en la lista", () => {
  const cand = (p: Partial<ArticuloConFaltante> = {}): Candidato =>
    ({ articulo: art(p), salidas: 1, diasDesdeLaUltima: 10 });

  const codigos = (lista: Candidato[]) => lista.map((c) => c.articulo.codigo);

  const lista: Candidato[] = [
    cand({ codigo: "00018", descripcion: "BUJE DE BRONCE 40MM" }),
    cand({ codigo: "00345", descripcion: "CORREA TRAPEZOIDAL B-75" }),
    cand({ codigo: "00733", descripcion: "VALVULA ESFERICA 1/2" }),
  ];

  it("encuentra por descripcion", () => {
    expect(codigos(filtrarParaReponer(lista, "bronce"))).toEqual(["00018"]);
  });

  it("encuentra por codigo, que es el otro dato que la fila muestra", () => {
    expect(codigos(filtrarParaReponer(lista, "00345"))).toEqual(["00345"]);
  });

  it("acepta las palabras en cualquier orden", () => {
    // Quien busca se acuerda de dos pedazos del nombre, no de como estaban
    // ordenados. Es lo que ya hacen los desplegables y el listado de OS.
    expect(codigos(filtrarParaReponer(lista, "bronce buje")))
      .toEqual(codigos(filtrarParaReponer(lista, "buje bronce")));
  });

  it("ignora los acentos y las mayusculas, porque nadie los escribe", () => {
    const con = [cand({ codigo: "00900", descripcion: "Válvula de alivio" })];
    expect(codigos(filtrarParaReponer(con, "valvula"))).toEqual(["00900"]);
    expect(codigos(filtrarParaReponer(con, "VÁLVULA"))).toEqual(["00900"]);
  });

  it("lo que no esta devuelve vacio y no la lista entera", () => {
    // El caso que convierte un buscador en un adorno: filtrar mal y mostrar
    // todo es indistinguible de no filtrar.
    expect(filtrarParaReponer(lista, "turbina")).toHaveLength(0);
  });

  it("sin consulta devuelve la misma lista, no una copia", () => {
    // La pantalla la pasa por `useMemo`: un arreglo nuevo en cada tecla
    // redibuja las 92 filas sin que haya cambiado nada.
    expect(filtrarParaReponer(lista, "")).toBe(lista);
    expect(filtrarParaReponer(lista, "   ")).toBe(lista);
  });

  it("filtrar y ordenar se combinan sin pisarse", () => {
    const dos = [
      cand({ codigo: "00002", descripcion: "BUJE DE BRONCE 40MM" }),
      cand({ codigo: "00001", descripcion: "BUJE DE BRONCE 20MM" }),
      cand({ codigo: "00003", descripcion: "CORREA B-75" }),
    ];
    expect(codigos(ordenarParaReponer(filtrarParaReponer(dos, "buje"), "descripcion")))
      .toEqual(["00001", "00002"]);
  });
});

describe("un RI que ya recibio mercaderia", () => {
  const entrada = (requerimiento_id: string | null): EntradaDeRequerimiento =>
    ({ requerimiento_id, tipo: "entrada" });

  it("junta los RI que ya tienen entrada", () => {
    expect([...riConEntrada([entrada("r1"), entrada("r2")])]).toEqual(["r1", "r2"]);
  });

  it("una salida no es una recepcion", () => {
    // Hoy los 766 movimientos con `requerimiento_id` son entradas, asi que esto
    // no saca ninguno. Esta para el dia que la forma de cargar cambie.
    expect(riConEntrada([{ requerimiento_id: "r1", tipo: "salida" }]).size).toBe(0);
  });

  it("un movimiento sin requerimiento no aporta nada", () => {
    expect(riConEntrada([entrada(null), entrada("  ")]).size).toBe(0);
  });

  it("no cuenta dos veces el RI que llego en dos entregas", () => {
    expect(riConEntrada([entrada("r1"), entrada("r1")]).size).toBe(1);
  });

  it("deja de estar abierto aunque la planilla siga diciendo PEDIDO", () => {
    // El caso reportado: el RI 2082 pidio 8 correas el 06/10, entraron el
    // 21/10 nombrandolo, y la columna `Estado` de la planilla nunca se movio.
    const pedido = ri({ id: "r2082", nro_ri: 2082, estado_compra: "PEDIDO" });
    expect(estaAbierto(pedido, NADA)).toBe(true);
    expect(estaAbierto(pedido, new Set(["r2082"]))).toBe(false);
  });

  it("el que recibio no figura entre los pedidos abiertos de su codigo", () => {
    const abiertos = pedidosAbiertosPorCodigo(
      [ri({ id: "r2082", codigo: "00288" })], HOY, new Set(["r2082"])
    );
    expect(abiertos.size).toBe(0);
  });

  it("con dos RI del mismo codigo, el recibido sale y el otro queda", () => {
    // Importa porque la cuenta de «N pedidos abiertos» sale de aca: con el
    // recibido adentro el cartel diria dos donde hay uno.
    const abiertos = pedidosAbiertosPorCodigo(
      [
        ri({ id: "viejo", nro_ri: 2082, fecha: "2026-09-01" }),
        ri({ id: "nuevo", nro_ri: 2200, fecha: "2026-09-28" }),
      ],
      HOY,
      new Set(["viejo"])
    );
    expect(abiertos.get("00018")?.cuantosAbiertos).toBe(1);
    expect(abiertos.get("00018")?.ri.nro_ri).toBe(2200);
  });

  it("vuelve a «para pedir» el articulo cuyo pedido ya llego", () => {
    const r = clasificarParaReponer(
      [art({ codigo: "00288" })],
      [salida("00288", "2026-09-20")],
      [ri({ id: "r2082", codigo: "00288" })],
      HOY,
      new Set(["r2082"])
    );
    expect(r.yaPedidos).toHaveLength(0);
    expect(r.paraPedir.map((c) => c.articulo.codigo)).toEqual(["00288"]);
  });

  it("y sigue en «ya pedidos» mientras no haya llegado nada", () => {
    const r = clasificarParaReponer(
      [art({ codigo: "00288" })],
      [salida("00288", "2026-09-20")],
      [ri({ id: "r2082", codigo: "00288" })],
      HOY,
      NADA
    );
    expect(r.paraPedir).toHaveLength(0);
    expect(r.yaPedidos.map((c) => c.ri.nro_ri)).toEqual([2015]);
  });

  it("una entrada de OTRO pedido no cierra este", () => {
    // El enlace es el RI resuelto y nunca "una entrada del mismo codigo": leerlo
    // asi cerraria 96 en vez de 85, y las 11 de diferencia son entradas que no
    // dicen de que pedido vienen.
    const r = clasificarParaReponer(
      [art({ codigo: "00288" })],
      [salida("00288", "2026-09-20")],
      [ri({ id: "r2082", codigo: "00288" })],
      HOY,
      new Set(["otro-ri"])
    );
    expect(r.yaPedidos).toHaveLength(1);
  });
});
