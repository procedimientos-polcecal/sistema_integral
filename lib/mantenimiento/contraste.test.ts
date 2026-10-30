import { describe, it, expect } from "vitest";
import { contrastar, porOrden, type OrdenDelSistema } from "./contraste";
import type { OrdenLeida } from "./ordenes";

const enElSistema = (p: Partial<OrdenDelSistema> & { ot_number: number }): OrdenDelSistema => ({
  sector_raw: "Planta filler 1", equipo_raw: "PY-A2-01 – Válvula rotativa 1",
  especialidad: "ELÉCTRICO", tipo: "CORRECTIVO", quien: "INTERNO",
  descripcion: "Inversión de giro de alimentador",
  fecha_ejecucion: "2026-10-01", fecha_cierre: "2026-10-01",
  estado: "REALIZADO", contratista: null, horas: 1,
  operario_1: "Agosta", operario_2: "Garcia", operario_3: null,
  prioridad: "🟡 Media", sheets_pendiente: null, ...p,
});

const enLaPlanilla = (p: Partial<OrdenLeida> & { ot_number: number }): OrdenLeida => ({
  fecha: "2026-10-21", sector_raw: "Planta filler 1",
  equipo_raw: "PY-A2-01 – Válvula rotativa 1", equipo_code: "PY-A2-01",
  especialidad: "ELÉCTRICO", tipo: "CORRECTIVO", quien: "INTERNO",
  descripcion: "Inversión de giro de alimentador", repuesto: null,
  fecha_ejecucion: "2026-10-01", fecha_cierre: "2026-10-01",
  // `estado` es lo interpretado y `estado_raw` la celda tal cual. Los dos van
  // en el fixture porque la diferencia entre ellos es un caso de prueba: una
  // celda vacía se interpreta «por hacer» y hay que poder distinguirla.
  estado: "REALIZADO", estado_raw: "Realizado", contratista: null, horas: 1,
  operario_1: "Agosta", operario_2: "Garcia", operario_3: null,
  prioridad: "🟡 Media", frecuencia: null, proxima_fecha: null,
  sheets_row: 2225, ...p,
} as OrdenLeida);

describe("cuando los dos lados dicen lo mismo", () => {
  it("no hay nada que mirar", () => {
    const r = contrastar([enElSistema({ ot_number: 2845 })], [enLaPlanilla({ ot_number: 2845 })]);
    expect(r.divergencias).toEqual([]);
    expect(r.enLaCola).toEqual([]);
  });

  it("vacío y nulo son lo mismo", () => {
    const r = contrastar(
      [enElSistema({ ot_number: 1, contratista: null, operario_3: null })],
      [enLaPlanilla({ ot_number: 1, contratista: "", operario_3: "" })]
    );
    expect(r.divergencias).toEqual([]);
  });

  it("los espacios de más no son una diferencia", () => {
    const r = contrastar(
      [enElSistema({ ot_number: 1, operario_1: "Agosta" })],
      [enLaPlanilla({ ot_number: 1, operario_1: "  Agosta " })]
    );
    expect(r.divergencias).toEqual([]);
  });
});

/**
 * EL CASO QUE LO HIZO EXISTIR. La OT 2845, el 21/10/2026: el sistema decía
 * 1/10 y la planilla 3/10, y las horas estaban en el sistema y la celda vacía
 * allá. Las dos mitades se leen en pantallas distintas, así que nadie lo vio.
 */
describe("la OT 2845", () => {
  it("nombra los tres campos, con los dos valores", () => {
    const r = contrastar(
      [enElSistema({ ot_number: 2845 })],
      [enLaPlanilla({
        ot_number: 2845, fecha_ejecucion: "2026-10-03",
        fecha_cierre: "2026-10-03", horas: null,
      })]
    );
    expect(r.divergencias).toEqual([
      { ot_number: 2845, campo: "la fecha de ejecución", enElSistema: "2026-10-01", enLaPlanilla: "2026-10-03" },
      { ot_number: 2845, campo: "la fecha de cierre", enElSistema: "2026-10-01", enLaPlanilla: "2026-10-03" },
      { ot_number: 2845, campo: "las horas", enElSistema: "1", enLaPlanilla: "(vacío)" },
    ]);
  });

  /** Un problema con tres síntomas es una orden, no tres. */
  it("se leen agrupadas por orden", () => {
    const r = contrastar(
      [enElSistema({ ot_number: 2845 })],
      [enLaPlanilla({ ot_number: 2845, fecha_ejecucion: "2026-10-03", horas: null })]
    );
    const m = porOrden(r.divergencias);
    expect(m.size).toBe(1);
    expect(m.get(2845)).toHaveLength(2);
  });
});

describe("lo que NO tiene que sonar", () => {
  /**
   * Una orden en la cola TIENE que diferir: el sistema sabe algo que la
   * planilla todavia no. Contarla como divergencia haria que la lista diga
   * "problema" cada vez que alguien carga una OT realizada.
   */
  it("una orden con la exportación pendiente va aparte, no a la lista", () => {
    const r = contrastar(
      [enElSistema({ ot_number: 2845, sheets_pendiente: "todavía no está en la planilla" })],
      // La planilla devuelve "" y no null cuando la celda está vacía: el
      // estado de `OrdenLeida` no es nullable porque `estadoDeTexto` siempre
      // contesta un texto.
      [enLaPlanilla({ ot_number: 2845, estado: "", horas: null, fecha_cierre: null })]
    );
    expect(r.divergencias).toEqual([]);
    expect(r.enLaCola).toEqual([2845]);
  });

  /**
   * `POR_HACER` es el unico estado que no se exporta nunca: la `M` del master
   * trae `=IF(J="","",L)` y escribirla la reemplaza por un literal. Asi que la
   * planilla calcula sola "Atrasado" cuando se pasa de fecha, y eso es
   * exactamente lo que tiene que pasar.
   */
  it("«por hacer» contra «atrasado» es la fórmula de la planilla, no un error", () => {
    const r = contrastar(
      [enElSistema({ ot_number: 1, estado: "POR_HACER", fecha_cierre: null, horas: null, operario_1: null, operario_2: null })],
      [enLaPlanilla({ ot_number: 1, estado: "ATRASADO", fecha_cierre: null, horas: null, operario_1: null, operario_2: null })]
    );
    expect(r.divergencias).toEqual([]);
  });

  /** Pero al revés sí: el sistema dice realizado y la planilla no se enteró. */
  it("realizado contra atrasado sí se informa", () => {
    const r = contrastar(
      [enElSistema({ ot_number: 1, estado: "REALIZADO" })],
      [enLaPlanilla({ ot_number: 1, estado: "ATRASADO" })]
    );
    expect(r.divergencias.map((d) => d.campo)).toEqual(["el estado"]);
  });
});

describe("las que están de un solo lado", () => {
  it("en la planilla y no en el sistema: falta sincronizar", () => {
    const r = contrastar([], [enLaPlanilla({ ot_number: 2846 }), enLaPlanilla({ ot_number: 2847 })]);
    expect(r.soloEnLaPlanilla).toEqual([2846, 2847]);
    expect(r.divergencias).toEqual([]);
  });

  /** Es el estado normal de una OT recién creada, y por eso no es un error. */
  it("en el sistema y no en la planilla: el alta todavía no llegó", () => {
    const r = contrastar([enElSistema({ ot_number: 2850 })], []);
    expect(r.soloEnElSistema).toEqual([2850]);
    expect(r.divergencias).toEqual([]);
  });

  it("las de un solo lado no se comparan contra nada", () => {
    const r = contrastar(
      [enElSistema({ ot_number: 1 }), enElSistema({ ot_number: 2 })],
      [enLaPlanilla({ ot_number: 2, horas: 99 }), enLaPlanilla({ ot_number: 3 })]
    );
    expect(r.soloEnElSistema).toEqual([1]);
    expect(r.soloEnLaPlanilla).toEqual([3]);
    expect(r.divergencias.map((d) => d.ot_number)).toEqual([2]);
  });
});

/**
 * El defecto que este contraste NO veía, y que lo hizo falta construir.
 *
 * El sistema decía «por hacer» y la celda del ESTADO estaba vacía. Como
 * `estadoDeTexto` lee una celda vacía como «por hacer», los dos lados
 * coincidían y no se informaba nada. Mientras tanto, quien miraba la planilla
 * veía ocho órdenes sin estado — y dos de ellas ya vencidas, sin que la celda
 * fuera a enterarse nunca, porque la fórmula que lo calcula no estaba.
 */
describe("la celda del estado vacía", () => {
  const porHacer = { estado: "POR_HACER", estado_raw: "Por hacer" };

  it("se informa aunque los dos lados se lean igual", () => {
    const r = contrastar(
      [enElSistema({ ot_number: 2896, ...porHacer, fecha_cierre: null, horas: null,
        operario_1: null, operario_2: null })],
      [enLaPlanilla({ ot_number: 2896, ...porHacer, estado_raw: null, fecha_cierre: null,
        horas: null, operario_1: null, operario_2: null })]
    );
    expect(r.divergencias).toHaveLength(1);
    expect(r.divergencias[0].campo).toContain("fórmula");
    expect(r.divergencias[0].ot_number).toBe(2896);
  });

  it("con la fórmula puesta no se informa nada", () => {
    const r = contrastar(
      [enElSistema({ ot_number: 2896, ...porHacer, fecha_cierre: null, horas: null,
        operario_1: null, operario_2: null })],
      [enLaPlanilla({ ot_number: 2896, ...porHacer, fecha_cierre: null, horas: null,
        operario_1: null, operario_2: null })]
    );
    expect(r.divergencias).toEqual([]);
  });

  /**
   * «Atrasado» en la planilla contra «por hacer» en el sistema sigue siendo la
   * fórmula trabajando, no una divergencia: la L pasa sola de una a otra.
   */
  it("atrasado contra por hacer no es una divergencia", () => {
    const r = contrastar(
      [enElSistema({ ot_number: 2914, ...porHacer, fecha_cierre: null, horas: null,
        operario_1: null, operario_2: null })],
      [enLaPlanilla({ ot_number: 2914, estado: "ATRASADO", estado_raw: "Atrasado",
        fecha_cierre: null, horas: null, operario_1: null, operario_2: null })]
    );
    expect(r.divergencias).toEqual([]);
  });

  /**
   * Sin fecha de ejecución la celda vacía es lo correcto: `=IF(J="","",L)` no
   * tiene nada que calcular. Marcarla sería ruido para siempre — es el caso de
   * la OT 622, la única del libro sin fecha.
   */
  it("sin fecha de ejecución, una celda vacía no se marca", () => {
    const r = contrastar(
      [enElSistema({ ot_number: 622, ...porHacer, fecha_ejecucion: null, fecha_cierre: null,
        horas: null, operario_1: null, operario_2: null })],
      [enLaPlanilla({ ot_number: 622, ...porHacer, estado_raw: null, fecha_ejecucion: null,
        fecha_cierre: null, horas: null, operario_1: null, operario_2: null })]
    );
    expect(r.divergencias).toEqual([]);
  });
});

/**
 * La fecha que ya se escribió en «Altas del sistema» y el derrame del master
 * todavía no refleja.
 *
 * Durante esa ventana —de 3 a 53 horas medidas— los dos lados dicen fechas
 * distintas **por construcción**, no por un problema. Sin esto, cada
 * postergación dispararía el push de `mant-divergencias`, que es justo lo
 * contrario de lo que ese aviso existe para hacer.
 */
describe("una fecha de ejecución en camino", () => {
  const enCamino = {
    fecha_ejecucion: "2026-11-05",
    fecha_ejecucion_pendiente: "2026-11-05",
  };

  it("no es una divergencia: va a la cola", () => {
    const r = contrastar(
      [enElSistema({ ot_number: 2896, ...enCamino })],
      [enLaPlanilla({ ot_number: 2896, fecha_ejecucion: "2026-11-02" })]
    );
    expect(r.divergencias).toEqual([]);
    expect(r.enLaCola).toEqual([2896]);
  });

  it("sin la marca, la misma diferencia sí se informa", () => {
    const r = contrastar(
      [enElSistema({ ot_number: 2896, fecha_ejecucion: "2026-11-05" })],
      [enLaPlanilla({ ot_number: 2896, fecha_ejecucion: "2026-11-02" })]
    );
    expect(r.divergencias).toHaveLength(1);
    expect(r.divergencias[0].campo).toBe("la fecha de ejecución");
  });

  /**
   * Y cuando el derrame llega, la marca deja de tapar nada: los dos lados
   * dicen lo mismo y no hay ni divergencia ni cola que informar. Es lo que
   * permite que `sincronizarOrdenes` la limpie sin dejar la OT descubierta.
   */
  it("cuando el derrame llegó, los dos lados coinciden", () => {
    const r = contrastar(
      [enElSistema({ ot_number: 2896, ...enCamino })],
      [enLaPlanilla({ ot_number: 2896, fecha_ejecucion: "2026-11-05" })]
    );
    expect(r.divergencias).toEqual([]);
  });
});
