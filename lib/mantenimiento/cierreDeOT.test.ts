import { describe, it, expect } from "vitest";
import {
  estadoSegunElCierre, loQueFaltaParaCerrar, loQueHayQueExportar, loQueImpideCerrar,
} from "./cierreDeOT";

/**
 * Una OT que nace con fecha de cierre es una OT que ya se hizo: se esta
 * cargando trabajo viejo, no pidiendo trabajo nuevo. Elegir ademas el estado a
 * mano es contestar dos veces la misma pregunta, y es donde quedan las OT
 * cerradas figurando "por hacer".
 */
describe("el estado segun la fecha de cierre", () => {
  it("con fecha de cierre, realizada", () => {
    expect(estadoSegunElCierre("2026-10-18", "")).toBe("REALIZADO");
  });

  /** La fecha gana: tener cierre y decir "en proceso" es contradecirse. */
  it("la fecha de cierre le gana al estado que se haya elegido", () => {
    expect(estadoSegunElCierre("2026-10-18", "EN_PROCESO")).toBe("REALIZADO");
    expect(estadoSegunElCierre("2026-10-18", "ATRASADO")).toBe("REALIZADO");
  });

  it("sin cierre vale el que se eligio", () => {
    expect(estadoSegunElCierre("", "EN_PROCESO")).toBe("EN_PROCESO");
    expect(estadoSegunElCierre(null, "ATRASADO")).toBe("ATRASADO");
  });

  /** De donde se parte: una OT sin nada es una OT que falta hacer. */
  it("sin cierre y sin estado, por hacer", () => {
    expect(estadoSegunElCierre(null, "")).toBe("POR_HACER");
    expect(estadoSegunElCierre("", null)).toBe("POR_HACER");
    expect(estadoSegunElCierre("   ", "")).toBe("POR_HACER");
  });
});

/**
 * Y si ya se hizo, tiene que decir cuanto llevo y quien la hizo. Una OT cerrada
 * sin esos datos no se puede usar para nada de lo que vino despues -el MTBF,
 * las horas por sector, el costo- y nadie se entera hasta que el informe sale
 * con la mitad de las filas vacias.
 */
describe("que falta para poder darla por cerrada", () => {
  const hecha = {
    fecha_cierre: "2026-10-18",
    horas: "1",
    quien: "INTERNO",
    contratista: "",
    operario_1: "Aguirre",
    operario_2: "",
    operario_3: "",
  };

  it("completa no falta nada", () => {
    expect(loQueFaltaParaCerrar(hecha)).toEqual([]);
  });

  /** Sin cierre la regla no aplica: se esta pidiendo trabajo, no cargandolo. */
  it("sin fecha de cierre no se exige nada", () => {
    expect(loQueFaltaParaCerrar({
      ...hecha, fecha_cierre: "", horas: "", operario_1: "",
    })).toEqual([]);
  });

  it("sin horas lo dice", () => {
    expect(loQueFaltaParaCerrar({ ...hecha, horas: "" })).toContain("las horas que llevó");
  });

  /** Cero horas es un dato; vacio es que no lo cargaron. */
  it("cero horas es un dato y no un olvido", () => {
    expect(loQueFaltaParaCerrar({ ...hecha, horas: "0" })).toEqual([]);
  });

  it("interno sin ningun operario lo dice", () => {
    expect(loQueFaltaParaCerrar({ ...hecha, operario_1: "" }))
      .toContain("al menos un operario");
  });

  /** Cualquiera de los tres alcanza: no siempre se carga el primero. */
  it("alcanza con cualquiera de los tres operarios", () => {
    expect(loQueFaltaParaCerrar({ ...hecha, operario_1: "", operario_3: "Lopez" })).toEqual([]);
  });

  it("contratado sin contratista lo dice, y no pide operarios", () => {
    const r = loQueFaltaParaCerrar({ ...hecha, quien: "CONTRATADO", operario_1: "" });
    expect(r).toContain("el contratista");
    expect(r.join(" ")).not.toContain("operario");
  });

  it("mixto pide los dos", () => {
    const r = loQueFaltaParaCerrar({
      ...hecha, quien: "MIXTO", operario_1: "", contratista: "",
    });
    expect(r).toContain("el contratista");
    expect(r).toContain("al menos un operario");
  });

  /**
   * TODO junto y no de a uno, que es la vara de `validar()` del nucleo:
   * contestar un formulario tres veces para que te digan tres cosas es lo que
   * hace que la gente lo complete de cualquier manera.
   */
  it("dice todo lo que falta de una sola vez", () => {
    expect(loQueFaltaParaCerrar({
      ...hecha, horas: "", operario_1: "", quien: "MIXTO", contratista: "",
    })).toHaveLength(3);
  });

  it("los espacios no cuentan como cargado", () => {
    expect(loQueFaltaParaCerrar({ ...hecha, horas: "  ", operario_1: " " })).toHaveLength(2);
  });
});

/**
 * QUE HAY QUE MANDARLE A LA PLANILLA de una OT recien creada.
 *
 * Las columnas literales del master -K cierre, M estado, N contratista, O
 * horas, P/Q/R operarios- no las escribe el alta: su fila todavia no existe,
 * llega por IMPORTRANGE y tarda. Queda anotado y lo termina la sincronizacion.
 *
 * Si no hay nada que mandar NO se anota un pendiente: una cola con filas que no
 * tienen nada que hacer deja de decir si algo esta trabado.
 */
describe("que hay que exportarle a la planilla", () => {
  const base = {
    estado: "POR_HACER",
    fecha_cierre: null,
    horas: null,
    contratista: null,
    operario_1: null,
    operario_2: null,
    operario_3: null,
  };

  /**
   * Hasta el 29/10/2026 esto devolvia null: «por hacer» era el unico estado
   * que no se exportaba, porque se creia que la M traia la formula
   * `=IF(J="","",L)` y escribirla la reemplazaria por un literal. La M no
   * tiene esa formula —2.291 de sus 2.299 celdas son literales—, asi que no
   * escribir dejaba la celda EN BLANCO: ocho ordenes sin estado en la
   * planilla, dos ya atrasadas. Ahora viaja, y lo que se escribe es la formula
   * de esa fila (ver `celdaDeEstado`), que se sigue actualizando sola.
   */
  it("una orden que nace por hacer exporta su estado igual", () => {
    expect(loQueHayQueExportar(base)?.estado).toBe("POR_HACER");
  });

  /** Sin estado no hay nada: es el unico caso que sigue dando null. */
  it("sin estado y sin nada cargado no hay nada que exportar", () => {
    expect(loQueHayQueExportar({ ...base, estado: null })).toBeNull();
  });

  /** El estado es lo primero: con la M vacia, el cron la pisa. */
  it("un estado distinto de por hacer si", () => {
    const r = loQueHayQueExportar({ ...base, estado: "REALIZADO" });
    expect(r?.estado).toBe("REALIZADO");
  });

  /**
   * Las horas y los operarios viajan solos, SIN el estado. Escribir "Por hacer"
   * en la M reemplazaria la formula =IF(J="","",L) que la planilla usa para
   * marcar sola lo atrasado: la OT quedaria fija en "por hacer" el dia que se
   * pase de fecha. Por eso POR_HACER es el unico estado que no se exporta.
   */
  it("las horas y los operarios viajan junto con el estado por hacer", () => {
    const r = loQueHayQueExportar({ ...base, horas: 2, operario_1: "Aguirre" });
    expect(r?.horas).toBe(2);
    expect(r?.operario_1).toBe("Aguirre");
    expect(r?.estado).toBe("POR_HACER");
  });

  it("y la fecha de cierre y el contratista", () => {
    const r = loQueHayQueExportar({ ...base, fecha_cierre: "2026-10-18", contratista: "Pérez" });
    expect(r?.fecha_cierre).toBe("2026-10-18");
    expect(r?.contratista).toBe("Pérez");
  });

  /**
   * Lo que esta vacio NO viaja. `celdasParaRegistrar` vacia la celda cuando se
   * le pasa null, y vaciar una celda que nadie lleno es escribir de mas en una
   * planilla que mira gente.
   */
  it("lo vacio no se manda, para no vaciar celdas ajenas", () => {
    const r = loQueHayQueExportar({ ...base, estado: "REALIZADO" });
    expect(r).not.toBeNull();
    expect("horas" in r!).toBe(false);
    expect("operario_1" in r!).toBe(false);
    expect("contratista" in r!).toBe(false);
  });

  /** Cero horas es un dato y tiene que llegar. */
  it("cero horas viaja", () => {
    expect(loQueHayQueExportar({ ...base, horas: 0 })?.horas).toBe(0);
  });

  it("una orden completa manda todo junto", () => {
    const r = loQueHayQueExportar({
      estado: "REALIZADO", fecha_cierre: "2026-10-18", horas: 1,
      contratista: null, operario_1: "Aguirre", operario_2: "Mendizabal", operario_3: null,
    });
    expect(Object.keys(r!).sort()).toEqual(
      ["estado", "fecha_cierre", "horas", "operario_1", "operario_2"]
    );
  });
});

/**
 * Un trabajo no se cierra antes de empezar.
 *
 * Es otra clase de problema que `loQueFaltaParaCerrar`: aca los datos estan y
 * lo que no cierra es lo que dicen entre ellos. Medido el 05/11/2026 sobre las
 * 2.417 ordenes: 63 de las 2.143 cerradas tienen el cierre antes del inicio, y
 * 0 estan cerradas sin fecha de inicio.
 */
describe("lo que impide cerrar una orden", () => {
  it("una ventana al derecho no se queja", () => {
    expect(loQueImpideCerrar("2026-10-20", "2026-10-25")).toEqual([]);
  });

  /** El caso mas comun de todos: se empieza y se termina el mismo dia. */
  it("cerrar el mismo dia que empieza esta bien", () => {
    expect(loQueImpideCerrar("2026-10-20", "2026-10-20")).toEqual([]);
  });

  /** Las dos fechas en el mensaje: la que esta mal puede ser cualquiera. */
  it("el cierre anterior al inicio se nombra con las dos fechas", () => {
    expect(loQueImpideCerrar("2026-10-03", "2026-10-01"))
      .toEqual(["la fecha de cierre (2026-10-01) es anterior a la de inicio (2026-10-03)"]);
  });

  /** La OT 2845, que es de donde salio esto. */
  it("un dia de diferencia tambien se frena", () => {
    expect(loQueImpideCerrar("2026-11-04", "2026-11-03")).toHaveLength(1);
  });

  /**
   * Sin fecha de inicio tampoco se puede cerrar, y el mensaje dice eso y no
   * "falta cargar la fecha de inicio": quien esta registrando el trabajo no
   * tiene ese campo delante — lo tiene que ir a buscar a la orden.
   */
  it("sin fecha de inicio no se puede cerrar", () => {
    expect(loQueImpideCerrar(null, "2026-10-20"))
      .toEqual(["la orden no dice cuándo empezó, y un trabajo no se cierra antes de empezar"]);
    expect(loQueImpideCerrar("", "2026-10-20")).toHaveLength(1);
    expect(loQueImpideCerrar("   ", "2026-10-20")).toHaveLength(1);
  });

  /** Sin cierre no se esta cerrando nada: no mira ni el inicio. */
  it("sin fecha de cierre no opina", () => {
    expect(loQueImpideCerrar("2026-10-20", null)).toEqual([]);
    expect(loQueImpideCerrar("2026-10-20", "")).toEqual([]);
    expect(loQueImpideCerrar(null, null)).toEqual([]);
    expect(loQueImpideCerrar(null, "")).toEqual([]);
  });

  /**
   * Las fechas ISO se comparan como texto a proposito: "2026-02-03" < "2026-05-03"
   * sin construir un `Date`, que es lo que mete la zona horaria en el medio.
   * El cruce de anio es el caso que lo probaria mal si se compararan por dia y mes.
   */
  it("compara el anio y no solo el dia", () => {
    expect(loQueImpideCerrar("2026-01-05", "2025-12-30")).toHaveLength(1);
    expect(loQueImpideCerrar("2025-12-30", "2026-01-05")).toEqual([]);
  });
});
