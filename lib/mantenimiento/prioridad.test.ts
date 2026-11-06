import { describe, it, expect } from "vitest";
import {
  ordenSugerido, moverEnLista, asignarOrden, aplicarOrdenManual, ESTA_PENDIENTE,
  prioridadParaLaPlanilla, prioridadDeGut, prioridadEfectiva,
  filtroDePrioridadConGut, CORTE_DE_PRIORIDAD,
  PRIORIDAD_ALTA, PRIORIDAD_MEDIA, PRIORIDAD_BAJA,
} from "./prioridad";
import { PRIORIDADES_DE_OT } from "./filtrosOt";

const HOY = "2026-08-26";

describe("ESTA_PENDIENTE", () => {
  it("son los estados en los que la orden todavía espera algo", () => {
    expect(ESTA_PENDIENTE).toEqual(["ATRASADO", "EN_PROCESO", "POR_HACER"]);
  });
});

describe("ordenSugerido", () => {
  /**
   * Desde el 21/10/2026 el orden no lee la columna `prioridad` —ALTA/MEDIA/BAJA,
   * que el 92% de las órdenes nunca tuvo— sino las tres notas del GUT. Los
   * puntajes de abajo: a = 2·2·3 = 12, b = 1·1·1 = 1, c = 4·4·5 = 80 y
   * d = 5·4·4 = 80.
   */
  const ordenes = [
    { id: "a", ot_number: 10, estado: "POR_HACER", prioridad: "BAJA", gut_gravedad: 2, gut_urgencia: 2, gut_tendencia: 3, fecha: "2026-08-01", proxima_fecha: null },
    { id: "b", ot_number: 11, estado: "ATRASADO", prioridad: "BAJA", gut_gravedad: 1, gut_urgencia: 1, gut_tendencia: 1, fecha: "2026-08-20", proxima_fecha: null },
    { id: "c", ot_number: 12, estado: "POR_HACER", prioridad: "ALTA", gut_gravedad: 4, gut_urgencia: 4, gut_tendencia: 5, fecha: "2026-08-15", proxima_fecha: null },
    { id: "d", ot_number: 13, estado: "EN_PROCESO", prioridad: "ALTA", gut_gravedad: 5, gut_urgencia: 4, gut_tendencia: 4, fecha: "2026-08-10", proxima_fecha: null },
  ];

  it("lo atrasado sigue yendo primero, aunque tenga el puntaje más bajo", () => {
    // Ya se pasó de fecha: no importa con qué puntaje nació.
    expect(ordenSugerido(ordenes, HOY)[0].id).toBe("b");
  });

  it("entre dos que no están atrasadas, primero la de más puntaje", () => {
    // `a` es la más vieja (08-01) pero vale 12; `c` vale 80 y es más nueva.
    const [, segundo, tercero, cuarto] = ordenSugerido(ordenes, HOY);
    expect(segundo.id).toBe("d");
    expect(tercero.id).toBe("c");
    expect(cuarto.id).toBe("a");
  });

  it("con el mismo puntaje, la que espera hace más", () => {
    // c y d valen 80: va primero d, que es de 08-10 contra el 08-15 de c.
    const sinAtraso = ordenes.filter((o) => o.id !== "b");
    expect(ordenSugerido(sinAtraso, HOY).map((o) => o.id)).toEqual(["d", "c", "a"]);
  });

  it("deja las de menos puntaje al final", () => {
    const sinAtraso = ordenes.filter((o) => o.id !== "b");
    expect(ordenSugerido(sinAtraso, HOY).at(-1)!.id).toBe("a");
  });

  /**
   * LA RAZÓN DEL 27. Sin puntaje no es cero: con cero, las pendientes sin
   * puntuar se irían al fondo y nadie las miraría más. Vale 3·3·3, la nota del
   * medio en cada eje, así que queda entre las de más de 27 y las de menos.
   */
  it("la que no tiene puntaje queda entre las de más y las de menos de 27", () => {
    const base = { estado: "POR_HACER", fecha: "2026-08-01", proxima_fecha: null };
    const alta   = { ...base, id: "alta",   ot_number: 1, gut_gravedad: 5, gut_urgencia: 3, gut_tendencia: 2 }; // 30
    const sin    = { ...base, id: "sin",    ot_number: 2 };
    const baja   = { ...base, id: "baja",   ot_number: 3, gut_gravedad: 4, gut_urgencia: 3, gut_tendencia: 2 }; // 24
    // Entran en el peor orden para que el resultado no sea casualidad.
    expect(ordenSugerido([baja, sin, alta], HOY).map((o) => o.id)).toEqual(["alta", "sin", "baja"]);
  });

  it("la que no tiene puntaje no se hunde por debajo de una de 25", () => {
    // Si valiera 0 iría al final; vale 27 y le gana a una de menos.
    const base = { estado: "POR_HACER", fecha: "2026-08-01", proxima_fecha: null };
    const sin  = { ...base, id: "sin", ot_number: 1 };
    const casi = { ...base, id: "casi", ot_number: 2, gut_gravedad: 5, gut_urgencia: 5, gut_tendencia: 1 }; // 25
    expect(ordenSugerido([casi, sin], HOY)[0].id).toBe("sin");
  });

  it("una orden cerrada con puntaje alto no pasa por delante de una abierta", () => {
    // La clave lleva el +1000 de lo abierto: una REALIZADO de 125 va después de
    // una abierta sin puntuar (27) y de una abierta de 12. Con sólo el puntaje
    // saldría primera. Hoy la lista que llega es de pendientes, pero el orden
    // no debe depender de eso.
    const base = { fecha: "2026-08-01", proxima_fecha: null };
    const hecha   = { ...base, id: "hecha",   ot_number: 1, estado: "REALIZADO",  gut_gravedad: 5, gut_urgencia: 5, gut_tendencia: 5 }; // 125
    const suspend = { ...base, id: "suspend", ot_number: 2, estado: "SUSPENDIDA", gut_gravedad: 5, gut_urgencia: 5, gut_tendencia: 4 }; // 100
    const sin     = { ...base, id: "sin",     ot_number: 3, estado: "POR_HACER" };
    const baja    = { ...base, id: "baja",    ot_number: 4, estado: "POR_HACER",  gut_gravedad: 2, gut_urgencia: 2, gut_tendencia: 3 }; // 12
    expect(ordenSugerido([hecha, suspend, baja, sin], HOY).map((o) => o.id))
      .toEqual(["sin", "baja", "hecha", "suspend"]);
  });

  it("con sólo dos de las tres notas cuenta como sin puntaje", () => {
    // Dos de tres es 5·5·(falta): si se multiplicara lo que hay, valdría 25 y
    // quedaría debajo de la de 27. Es sin puntaje, así que vale 27 y va antes.
    const base = { estado: "POR_HACER", fecha: "2026-08-01", proxima_fecha: null };
    const dosDeTres = { ...base, id: "dos", ot_number: 1, gut_gravedad: 5, gut_urgencia: 5, gut_tendencia: null };
    const casi      = { ...base, id: "casi", ot_number: 2, gut_gravedad: 5, gut_urgencia: 5, gut_tendencia: 1 }; // 25
    expect(ordenSugerido([casi, dosDeTres], HOY)[0].id).toBe("dos");
  });

  /**
   * La columna `prioridad` ya no ordena. Dos órdenes iguales salvo en ella
   * salen en el orden en que entraron: el desempate por fecha no las separa y
   * el sort es estable.
   */
  it("la prioridad de la planilla ya no cambia el orden", () => {
    const comoVienen = [
      { id: "baja",  ot_number: 1, estado: "POR_HACER", prioridad: "🟢 Baja",  fecha: "2026-08-01", proxima_fecha: null },
      { id: "alta",  ot_number: 2, estado: "POR_HACER", prioridad: "🟠 Alta",  fecha: "2026-08-01", proxima_fecha: null },
      { id: "media", ot_number: 3, estado: "POR_HACER", prioridad: "🟡 Media", fecha: "2026-08-01", proxima_fecha: null },
    ];
    expect(ordenSugerido(comoVienen, HOY).map((o) => o.id)).toEqual(["baja", "alta", "media"]);
  });

  it("una prioridad alta no le gana a un puntaje más alto ni a una fecha más vieja", () => {
    const base = { estado: "POR_HACER", proxima_fecha: null };
    const altaNueva = { ...base, id: "altaNueva", ot_number: 1, prioridad: "🟠 Alta", fecha: "2026-08-20", gut_gravedad: 3, gut_urgencia: 3, gut_tendencia: 3 };
    const bajaVieja = { ...base, id: "bajaVieja", ot_number: 2, prioridad: "🟢 Baja", fecha: "2026-08-01", gut_gravedad: 3, gut_urgencia: 3, gut_tendencia: 3 };
    const bajaFuerte = { ...base, id: "bajaFuerte", ot_number: 3, prioridad: "🟢 Baja", fecha: "2026-08-25", gut_gravedad: 5, gut_urgencia: 5, gut_tendencia: 5 };
    expect(ordenSugerido([altaNueva, bajaVieja, bajaFuerte], HOY).map((o) => o.id))
      .toEqual(["bajaFuerte", "bajaVieja", "altaNueva"]);
  });

  it("no rompe con prioridad desconocida o vacía", () => {
    const raras = [
      { id: "x", ot_number: 1, estado: "POR_HACER", prioridad: null, fecha: "2026-08-01" },
      { id: "y", ot_number: 2, estado: "POR_HACER", prioridad: "URGENTÍSIMO", fecha: "2026-08-02" },
    ];
    expect(ordenSugerido(raras, HOY)).toHaveLength(2);
  });
});

describe("moverEnLista", () => {
  const lista = ["a", "b", "c", "d"];

  it("mueve un elemento hacia abajo", () => {
    expect(moverEnLista(lista, 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("mueve un elemento hacia arriba", () => {
    expect(moverEnLista(lista, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("no toca la lista original", () => {
    moverEnLista(lista, 0, 3);
    expect(lista).toEqual(["a", "b", "c", "d"]);
  });

  it("moverlo a su mismo lugar no cambia nada", () => {
    expect(moverEnLista(lista, 1, 1)).toEqual(lista);
  });

  it("ignora posiciones que no existen", () => {
    expect(moverEnLista(lista, 9, 1)).toEqual(lista);
    expect(moverEnLista(lista, 1, -3)).toEqual(lista);
  });
});

describe("asignarOrden", () => {
  it("numera de arriba hacia abajo desde cero", () => {
    expect(asignarOrden([{ id: "a" }, { id: "b" }, { id: "c" }])).toEqual([
      { id: "a", orden: 0 },
      { id: "b", orden: 1 },
      { id: "c", orden: 2 },
    ]);
  });
});

describe("aplicarOrdenManual", () => {
  const ordenes = [
    { id: "a", ot_number: 10, estado: "POR_HACER", prioridad: "ALTA", fecha: "2026-08-01", orden_manual: 2 },
    { id: "b", ot_number: 11, estado: "POR_HACER", prioridad: "BAJA", fecha: "2026-08-02", orden_manual: 0 },
    { id: "c", ot_number: 12, estado: "POR_HACER", prioridad: "MEDIA", fecha: "2026-08-03", orden_manual: 1 },
  ];

  it("manda el orden que alguien puso a mano", () => {
    // Aunque "a" sea la de prioridad alta: si alguien la puso tercera, va
    // tercera. Para eso existe el orden manual.
    expect(aplicarOrdenManual(ordenes, HOY).map((o) => o.id)).toEqual(["b", "c", "a"]);
  });

  it("las que nadie ordenó van después, por el orden sugerido", () => {
    const conSuelta = [
      ...ordenes,
      { id: "d", ot_number: 13, estado: "ATRASADO", prioridad: "BAJA", fecha: "2026-08-04", orden_manual: null },
    ];
    // "d" está atrasada, pero las ordenadas a mano van primero igual.
    expect(aplicarOrdenManual(conSuelta, HOY).map((o) => o.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("sin ninguna ordenada a mano, queda el orden sugerido", () => {
    const sueltas = ordenes.map((o) => ({ ...o, orden_manual: null }));
    expect(aplicarOrdenManual(sueltas, HOY).map((o) => o.id)).toEqual(
      ordenSugerido(sueltas, HOY).map((o) => o.id)
    );
  });

  it("desempata por número de OT si dos quedaron con el mismo orden", () => {
    // Pasa cuando se ordenó una lista filtrada: las de afuera conservan el suyo.
    const empatadas = [
      { id: "x", ot_number: 20, estado: "POR_HACER", prioridad: "BAJA", fecha: "2026-08-01", orden_manual: 0 },
      { id: "y", ot_number: 19, estado: "POR_HACER", prioridad: "BAJA", fecha: "2026-08-01", orden_manual: 0 },
    ];
    expect(aplicarOrdenManual(empatadas, HOY).map((o) => o.id)).toEqual(["y", "x"]);
  });
});

/**
 * EL BUG DEL 16/10/2026. `NuevaOTModal` tenia su propia copia del vocabulario
 * -["ALTA","MEDIA","BAJA"]- y el alta la escribia tal cual. La planilla dice
 * "🟡 Media" en sus 130 filas con prioridad, y el filtro del listado usa esa
 * forma. Resultado: una OT creada desde la app no aparecia al filtrar por
 * "Media". La 2796 fue la primera y la unica: 36 filas decian "🟡 Media" y una
 * sola "MEDIA".
 *
 * Es el mismo caso que el estado, que si se traduce al escribir -la app guarda
 * EN_PROCESO y la planilla dice "En proceso"-. A la prioridad le faltaba.
 */
describe("la prioridad como la escribe la planilla", () => {
  it("traduce la palabra sola al vocabulario de la planilla", () => {
    expect(prioridadParaLaPlanilla("ALTA")).toBe("🟠 Alta");
    expect(prioridadParaLaPlanilla("MEDIA")).toBe("🟡 Media");
    expect(prioridadParaLaPlanilla("BAJA")).toBe("🟢 Baja");
  });

  /** Lo que ya viene bien no se toca: es lo que llega de la planilla. */
  it("lo que ya esta en el vocabulario queda igual", () => {
    expect(prioridadParaLaPlanilla("🟠 Alta")).toBe("🟠 Alta");
    expect(prioridadParaLaPlanilla("🟡 Media")).toBe("🟡 Media");
  });

  /** Acentos, minusculas y adornos: lo mismo que resuelve `soloLaPalabra`. */
  it("no se deja confundir por como este escrita", () => {
    expect(prioridadParaLaPlanilla("media")).toBe("🟡 Media");
    expect(prioridadParaLaPlanilla("  Alta ")).toBe("🟠 Alta");
  });

  it("sin prioridad es null, no un texto vacio", () => {
    expect(prioridadParaLaPlanilla(null)).toBeNull();
    expect(prioridadParaLaPlanilla("")).toBeNull();
    expect(prioridadParaLaPlanilla("   ")).toBeNull();
  });

  /**
   * Una palabra que no conocemos pasa tal cual, igual que hace el estado con
   * `EN_LA_PLANILLA[v] ?? v`. Inventarle un emoji seria decidir por la
   * planilla, y perderla seria peor.
   */
  it("una prioridad que no conocemos pasa tal cual", () => {
    expect(prioridadParaLaPlanilla("URGENTE")).toBe("URGENTE");
  });
});

/**
 * LA PRIORIDAD QUE SALE DEL GUT, pedida el 23/10/2026: mas de 80 es Alta, de 30
 * a 80 es Media, menos de 30 es Baja. Y manda el GUT: si la orden tiene las
 * tres notas, su prioridad sale del puntaje aunque la planilla diga otra cosa.
 *
 * El motivo, medido: de 2.264 ordenes, 2.081 no tienen prioridad cargada. Solo
 * 183 la tienen, asi que el filtro dejaba afuera al 92%.
 */
describe("la prioridad que sale del GUT", () => {
  it("corta donde se pidio: mas de 80, de 30 a 80, menos de 30", () => {
    expect(prioridadDeGut(125)).toBe(PRIORIDAD_ALTA);
    expect(prioridadDeGut(100)).toBe(PRIORIDAD_ALTA);
    expect(prioridadDeGut(81)).toBe(PRIORIDAD_ALTA);
    expect(prioridadDeGut(80)).toBe(PRIORIDAD_MEDIA);
    expect(prioridadDeGut(30)).toBe(PRIORIDAD_MEDIA);
    expect(prioridadDeGut(29)).toBe(PRIORIDAD_BAJA);
    expect(prioridadDeGut(1)).toBe(PRIORIDAD_BAJA);
  });

  /**
   * LO QUE NO SE DEDUCE DEL NUMERO, y que conviene que este escrito antes de
   * que alguien se pregunte por que casi nada sale Alta: el GUT es el producto
   * de tres notas de 1 a 5, asi que **no es un continuo**. Entre 81 y 99 no hay
   * ningun producto posible, de modo que con el corte en "mas de 80" las unicas
   * Alta son 100 (4·5·5) y 125 (5·5·5).
   *
   * Y el 80 exacto (4·4·5) cae en Media aunque `bandaDeGut` lo llame banda 5:
   * las bandas y las prioridades son dos escalas distintas.
   */
  it("los unicos puntajes posibles que dan Alta son 100 y 125", () => {
    const posibles = new Set<number>();
    for (let g = 1; g <= 5; g++) {
      for (let u = 1; u <= 5; u++) {
        for (let t = 1; t <= 5; t++) posibles.add(g * u * t);
      }
    }
    const altas = [...posibles].filter((p) => prioridadDeGut(p) === PRIORIDAD_ALTA).sort((a, b) => a - b);
    expect(altas).toEqual([100, 125]);
    // Y no hay ningun producto posible entre el corte y el 100.
    expect([...posibles].filter((p) => p > CORTE_DE_PRIORIDAD.alta && p < 100)).toEqual([]);
  });

  it("devuelve la forma de la planilla, con su emoji", () => {
    expect(prioridadDeGut(125)).toBe("🟠 Alta");
    expect(PRIORIDADES_DE_OT).toContain(prioridadDeGut(50));
  });
});

describe("cual prioridad vale para una orden", () => {
  /** EL PEDIDO: con las tres notas puestas, manda el GUT. */
  it("el GUT le gana a lo que diga la planilla", () => {
    expect(prioridadEfectiva({
      prioridad: "🟢 Baja", gut_gravedad: 5, gut_urgencia: 5, gut_tendencia: 5,
    })).toBe(PRIORIDAD_ALTA);
  });

  /** Sin las tres notas no hay puntaje, y ahi vale la celda. */
  it("sin puntaje vale la planilla", () => {
    expect(prioridadEfectiva({
      prioridad: "🟠 Alta", gut_gravedad: 5, gut_urgencia: 5, gut_tendencia: null,
    })).toBe("🟠 Alta");
    expect(prioridadEfectiva({ prioridad: "🟡 Media" })).toBe("🟡 Media");
  });

  /** Y sin ninguna de las dos, null: no se inventa una prioridad. */
  it("sin puntaje y sin celda no hay prioridad", () => {
    expect(prioridadEfectiva({ prioridad: null })).toBeNull();
    expect(prioridadEfectiva({ prioridad: "   " })).toBeNull();
    expect(prioridadEfectiva({})).toBeNull();
  });

  /** 3·3·3 = 27 es un puntaje de verdad y cae en Baja, no en "sin puntaje". */
  it("un 3-3-3 es Baja y no es lo mismo que sin puntuar", () => {
    expect(prioridadEfectiva({
      prioridad: "🟠 Alta", gut_gravedad: 3, gut_urgencia: 3, gut_tendencia: 3,
    })).toBe(PRIORIDAD_BAJA);
  });
});

describe("el filtro de prioridad que manda a la base", () => {
  it("sin nada elegido no filtra", () => {
    expect(filtroDePrioridadConGut([])).toBeNull();
    expect(filtroDePrioridadConGut(["", "  "])).toBeNull();
  });

  /**
   * Dos clases de condicion en un `or`: el rango de puntaje de cada prioridad
   * elegida, y las que no tienen puntaje, que se deciden por la celda.
   */
  it("junta el rango del puntaje y lo que dice la planilla", () => {
    expect(filtroDePrioridadConGut(["🟠 Alta"])).toBe(
      'gut_puntaje.gt.80,and(gut_puntaje.is.null,prioridad.in.("🟠 Alta"))'
    );
    expect(filtroDePrioridadConGut(["🟢 Baja"])).toBe(
      'gut_puntaje.lt.30,and(gut_puntaje.is.null,prioridad.in.("🟢 Baja"))'
    );
  });

  /** Media es un rango cerrado de los dos lados: el 30 y el 80 entran. */
  it("media va entre los dos cortes, con los dos adentro", () => {
    expect(filtroDePrioridadConGut(["🟡 Media"])).toBe(
      'and(gut_puntaje.gte.30,gut_puntaje.lte.80),and(gut_puntaje.is.null,prioridad.in.("🟡 Media"))'
    );
  });

  it("con varias elegidas suma los rangos y una sola lista de la planilla", () => {
    expect(filtroDePrioridadConGut(["🟠 Alta", "🟢 Baja"])).toBe(
      'gut_puntaje.gt.80,gut_puntaje.lt.30,' +
      'and(gut_puntaje.is.null,prioridad.in.("🟠 Alta","🟢 Baja"))'
    );
  });

  it("no repite una elegida dos veces", () => {
    expect(filtroDePrioridadConGut(["🟠 Alta", "🟠 Alta"])).toBe(
      'gut_puntaje.gt.80,and(gut_puntaje.is.null,prioridad.in.("🟠 Alta"))'
    );
  });

  /**
   * Los valores llevan emoji y espacio, asi que van entre comillas: un `in.()`
   * sin comillas los parte por el espacio y el filtro deja de encontrar nada.
   */
  it("los valores van entre comillas", () => {
    expect(filtroDePrioridadConGut(["🟡 Media"])).toContain('"🟡 Media"');
  });

  /**
   * LA GUARDA: las tres prioridades tienen rango. Si manana se agrega una
   * cuarta, el `Record` de `RANGO_DE_PRIORIDAD` deja de compilar — pero este
   * test ademas comprueba que ninguna quede sin su condicion de puntaje, que es
   * lo que la haria aparecer solo cuando la planilla la diga.
   */
  it("las tres prioridades aportan su rango de puntaje", () => {
    for (const p of PRIORIDADES_DE_OT) {
      const filtro = filtroDePrioridadConGut([p])!;
      expect(filtro).toContain("gut_puntaje");
      // Dos partes: el rango y el "sin puntaje". Nunca una sola.
      expect(filtro.startsWith("and(gut_puntaje.is.null")).toBe(false);
    }
  });
});
