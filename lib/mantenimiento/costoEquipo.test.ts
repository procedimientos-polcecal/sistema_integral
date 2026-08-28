import { describe, it, expect } from "vitest";
import {
  costoDelEquipo,
  horasHombreDe,
  operariosPropios,
  tarifaVigente,
  type OrdenDeTrabajo,
  type TarifaHora,
} from "./costoEquipo";

const ot = (p: Partial<OrdenDeTrabajo>): OrdenDeTrabajo => ({
  horas: null,
  operario_1: null,
  operario_2: null,
  operario_3: null,
  contratista: null,
  fecha_ejecucion: null,
  fecha_cierre: null,
  fecha: null,
  ...p,
});

const TARIFAS: TarifaHora[] = [
  { valor: 5000, vigente_desde: "2025-01-01" },
  { valor: 12000, vigente_desde: "2026-03-01" },
];

describe("la tarifa que regia una fecha", () => {
  it("toma la ultima que empezo a regir antes o el mismo dia", () => {
    expect(tarifaVigente(TARIFAS, "2026-02-28")).toBe(5000);
    expect(tarifaVigente(TARIFAS, "2026-03-01")).toBe(12000);
    expect(tarifaVigente(TARIFAS, "2026-08-15")).toBe(12000);
  });

  /**
   * Antes de la primera tarifa no hay con que costear. Devolver cero diria que
   * el trabajo salio gratis; devolver null deja que se cuente aparte.
   */
  it("antes de la primera cargada no hay tarifa, y eso no es cero", () => {
    expect(tarifaVigente(TARIFAS, "2024-12-31")).toBeNull();
  });

  it("sin ninguna tarifa cargada no hay tarifa", () => {
    expect(tarifaVigente([], "2026-05-01")).toBeNull();
  });

  it("sin fecha no se puede saber cual regia", () => {
    expect(tarifaVigente(TARIFAS, null)).toBeNull();
  });

  it("acepta una marca de tiempo completa, no solo el dia", () => {
    expect(tarifaVigente(TARIFAS, "2026-03-01T14:30:00Z")).toBe(12000);
  });
});

describe("cuanta gente propia trabajo", () => {
  it("cuenta los operarios anotados", () => {
    expect(operariosPropios(ot({ operario_1: "Lopez", operario_2: "Piparo" }))).toBe(2);
  });

  /** Un guion suelto es como se escribe "aca no va nada" en la planilla. */
  it("un guion suelto no es un operario", () => {
    expect(operariosPropios(ot({ operario_1: "Lopez", operario_2: "-", operario_3: "  " }))).toBe(1);
  });

  /**
   * Si intervino un tercero esas horas no son nuestras: su costo esta —cuando
   * esta— en una orden de servicio, y contarlas ademas seria contarlas dos
   * veces.
   */
  it("con contratista no hay mano de obra propia, aunque figuren operarios", () => {
    expect(operariosPropios(ot({ contratista: "Candia", operario_1: "Lopez" }))).toBe(0);
  });

  /** "Ambos" quiere decir "los dos" pero no dice cuales: se cuenta como uno. */
  it("«Ambos» cuenta como un operario, y subestima a proposito", () => {
    expect(operariosPropios(ot({ operario_1: "Ambos" }))).toBe(1);
  });
});

/**
 * `horas` es la duracion del trabajo, no horas-hombre: se verifico contra los
 * datos —las OT de tres operarios tienen la misma mediana que las de uno—.
 */
describe("horas-hombre de una orden", () => {
  it("multiplica la duracion por la cantidad de gente", () => {
    expect(horasHombreDe(ot({ horas: 3, operario_1: "a", operario_2: "b", operario_3: "c" }))).toBe(9);
  });

  it("sin operarios anotados no hay horas-hombre", () => {
    expect(horasHombreDe(ot({ horas: 16 }))).toBe(0);
  });

  it("sin horas no hay nada que multiplicar", () => {
    expect(horasHombreDe(ot({ operario_1: "Lopez" }))).toBe(0);
  });
});

describe("el costo de una maquina, por anio", () => {
  it("sin nada cargado no inventa un cero", () => {
    const c = costoDelEquipo([], [], [], TARIFAS);
    expect(c.anios).toEqual([]);
    expect(c.total).toBe(0);
  });

  it("suma las tres fuentes en el anio que corresponde", () => {
    const c = costoDelEquipo(
      [{ costo_iva: 100000, fecha_pedido: "2026-05-01", fecha: null }],
      [{ costo: 500000, fecha: "2026-06-01" }],
      [ot({ horas: 4, operario_1: "Lopez", operario_2: "Piparo", fecha_ejecucion: "2026-04-10" })],
      TARIFAS
    );

    expect(c.anios).toHaveLength(1);
    expect(c.anios[0]).toMatchObject({
      anio: "2026",
      materiales: 100000,
      terceros: 500000,
      manoDeObra: 8 * 12000,
    });
    expect(c.total).toBe(100000 + 500000 + 96000);
    expect(c.horasHombre).toBe(8);
  });

  it("ordena del anio mas reciente al mas viejo", () => {
    const c = costoDelEquipo(
      [
        { costo_iva: 1, fecha_pedido: "2024-01-01", fecha: null },
        { costo_iva: 2, fecha_pedido: "2026-01-01", fecha: null },
        { costo_iva: 3, fecha_pedido: "2025-01-01", fecha: null },
      ],
      [], [], TARIFAS
    );
    expect(c.anios.map((a) => a.anio)).toEqual(["2026", "2025", "2024"]);
  });

  /**
   * Un costo que se presenta como completo y no lo es, es peor que no
   * mostrarlo. Todo lo que no se pudo costear se cuenta aparte.
   */
  it("cuenta aparte lo que no se puede costear, en vez de sumar cero", () => {
    const c = costoDelEquipo(
      [{ costo_iva: null, fecha_pedido: "2026-01-01", fecha: null }],
      [{ costo: null, fecha: "2026-01-01" }],
      [
        ot({ horas: null, fecha_ejecucion: "2026-01-01" }),
        ot({ horas: 30, contratista: "Candia", fecha_ejecucion: "2026-01-01" }),
        ot({ horas: 2, operario_1: "Lopez", fecha_ejecucion: "2024-06-01" }),
      ],
      TARIFAS
    );

    expect(c.huecos).toEqual({
      riSinCosto: 1,
      osSinCosto: 1,
      otSinHoras: 1,
      horasDeContratista: 30,
      horasSinTarifa: 2,
    });
    expect(c.total).toBe(0);
  });

  /** La hora se costea con la tarifa del dia en que se trabajo, no la de hoy. */
  it("cada anio usa la tarifa que regia entonces", () => {
    const c = costoDelEquipo([], [], [
      ot({ horas: 1, operario_1: "Lopez", fecha_ejecucion: "2025-06-01" }),
      ot({ horas: 1, operario_1: "Lopez", fecha_ejecucion: "2026-06-01" }),
    ], TARIFAS);

    expect(c.anios.find((a) => a.anio === "2025")?.manoDeObra).toBe(5000);
    expect(c.anios.find((a) => a.anio === "2026")?.manoDeObra).toBe(12000);
  });

  /**
   * Una OT abierta en diciembre y ejecutada en marzo se trabajo en marzo: es la
   * fecha de ejecucion la que decide el anio y la tarifa.
   */
  it("imputa por la fecha de ejecucion, con cierre y alta como respaldo", () => {
    const c = costoDelEquipo([], [], [
      ot({ horas: 1, operario_1: "Lopez", fecha_ejecucion: "2026-06-01", fecha: "2025-12-01" }),
      ot({ horas: 1, operario_1: "Lopez", fecha_cierre: "2026-07-01", fecha: "2025-12-01" }),
      ot({ horas: 1, operario_1: "Lopez", fecha: "2025-12-01" }),
    ], TARIFAS);

    expect(c.anios.find((a) => a.anio === "2026")?.manoDeObra).toBe(24000);
    expect(c.anios.find((a) => a.anio === "2025")?.manoDeObra).toBe(5000);
  });

  it("sin ninguna tarifa cargada no se costea nada y las horas quedan anotadas", () => {
    const c = costoDelEquipo([], [], [
      ot({ horas: 4, operario_1: "Lopez", operario_2: "Piparo", fecha_ejecucion: "2026-06-01" }),
    ], []);

    expect(c.manoDeObra).toBe(0);
    expect(c.huecos.horasSinTarifa).toBe(8);
    expect(c.horasHombre).toBe(0);
  });
});
