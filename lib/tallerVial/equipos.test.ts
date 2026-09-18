import { describe, it, expect } from "vitest";
import { codigoDesdeTextoLibre, compararCodigosEM, terminoDePanolDelEquipo, tipoDeCombustible, unidadDeUso } from "./equipos";

describe("tipoDeCombustible", () => {
  it("EM7 y EM9 cargan INFINIA", () => {
    expect(tipoDeCombustible("EM7")).toBe("INFINIA");
    expect(tipoDeCombustible("EM9")).toBe("INFINIA");
  });

  it("el resto carga DIESEL_500", () => {
    expect(tipoDeCombustible("EM1")).toBe("DIESEL_500");
    expect(tipoDeCombustible("EM15")).toBe("DIESEL_500");
  });
});

describe("unidadDeUso", () => {
  it("camiones y camioneta se miden en km", () => {
    expect(unidadDeUso("EM8")).toBe("km");
    expect(unidadDeUso("EM9")).toBe("km");
    expect(unidadDeUso("EM13")).toBe("km");
    expect(unidadDeUso("EM15")).toBe("km");
  });

  it("el resto se mide en horas", () => {
    expect(unidadDeUso("EM1")).toBe("horas");
    expect(unidadDeUso("EM10")).toBe("horas");
  });
});

describe("codigoDesdeTextoLibre", () => {
  it("saca el código EM del principio del texto de la planilla", () => {
    expect(codigoDesdeTextoLibre("EM5 - Doosan SD 300")).toBe("EM5");
    expect(codigoDesdeTextoLibre("em12 - Autoelevador XCMG")).toBe("EM12");
  });

  it("null si el texto no es de un equipo móvil", () => {
    expect(codigoDesdeTextoLibre("compresor axerio taller metalurgico")).toBeNull();
    expect(codigoDesdeTextoLibre("empresa piparo")).toBeNull();
    expect(codigoDesdeTextoLibre("")).toBeNull();
  });
});

describe("compararCodigosEM", () => {
  it("ordena numéricamente, no alfabéticamente", () => {
    const codigos = ["EM10", "EM2", "EM1", "EM11"];
    expect([...codigos].sort(compararCodigosEM)).toEqual(["EM1", "EM2", "EM10", "EM11"]);
  });
});

describe("terminoDePanolDelEquipo", () => {
  it("dos equipos del mismo modelo comparten el término del pañol", () => {
    expect(terminoDePanolDelEquipo("EM3")).toBe("DOOSAN 225");
    expect(terminoDePanolDelEquipo("EM4")).toBe("DOOSAN 225");
    expect(terminoDePanolDelEquipo("EM10")).toBe("AUTOELEVADOR TOYOTA");
    expect(terminoDePanolDelEquipo("EM11")).toBe("AUTOELEVADOR TOYOTA");
  });

  it("un equipo sin ningún artículo relevado en el pañol no tiene término — no se inventa", () => {
    expect(terminoDePanolDelEquipo("EM13")).toBeNull();
    expect(terminoDePanolDelEquipo("EM14")).toBeNull();
    expect(terminoDePanolDelEquipo("EM15")).toBeNull();
  });
});
