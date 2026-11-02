import { describe, it, expect } from "vitest";
import { codigoDeSector, numeroDeCinta } from "./cuadernoAbreviaturas";

describe("codigoDeSector", () => {
  it("las tres plantas de trituracion", () => {
    expect(codigoDeSector("Colocar cartelería P/Trit N°1")).toBe("PO-A1");
    expect(codigoDeSector("Reparar rodillos 2/cinta 9 P/Trit N°3")).toBe("PO-A3");
    expect(codigoDeSector("P/TRT Nº2")).toBe("PO-A2");
    expect(codigoDeSector("p/ trit 1")).toBe("PO-A1");
  });

  it("los otros sectores que nombra el cuaderno", () => {
    expect(codigoDeSector("Limpieza techo Molino cal")).toBe("PO-D1");
    expect(codigoDeSector("Reparar cañería agua bomba Idratación")).toBe("PO-C1");
    expect(codigoDeSector("Limpieza techo Filer 02")).toBe("PY-B1");
    expect(codigoDeSector("limpieza techo filer 1")).toBe("PY-A1");
  });

  it("lo que no nombra un sector no inventa uno", () => {
    expect(codigoDeSector("Tranqueras D6")).toBeNull();
    expect(codigoDeSector("Hormigonar Dep 05")).toBeNull();
    expect(codigoDeSector("Clasificar manganeso")).toBeNull();
    expect(codigoDeSector("")).toBeNull();
  });

  it("una planta de trituracion sin numero no se adivina", () => {
    expect(codigoDeSector("Revisar P/Trit")).toBeNull();
    expect(codigoDeSector("Revisar P/Trit N°7")).toBeNull();
  });
});

describe("numeroDeCinta", () => {
  it("saca el numero de la cinta", () => {
    expect(numeroDeCinta("Reparar rodillos 2/cinta 9 P/Trit N°3")).toBe(9);
    expect(numeroDeCinta("Trabajos en cinta 1 P/Trit N°1")).toBe(1);
    expect(numeroDeCinta("1 Empalme cinta (11) P/Trit N°3")).toBe(11);
  });

  it("no confunde otra cosa con una cinta", () => {
    expect(numeroDeCinta("Limpieza tolva de zaranda P/Trit N°3")).toBeNull();
    expect(numeroDeCinta("Reparar paño zaranda 5 P/Trit N°3")).toBeNull();
  });

  it("una cinta sin numero no se adivina", () => {
    expect(numeroDeCinta("Cambiar cinta P/Trit N°2")).toBeNull();
    expect(numeroDeCinta("")).toBeNull();
  });
});
