import { describe, it, expect } from "vitest";
import { estadoSegunElCierre, loQueFaltaParaCerrar } from "./cierreDeOT";

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
