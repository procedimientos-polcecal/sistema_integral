import { describe, it, expect } from "vitest";
import { filaDeSectorYEquipo } from "./equipos";

describe("una fila de la pestana Sectores/Equipos", () => {
  it("devuelve el par con los dos lados recortados", () => {
    expect(filaDeSectorYEquipo(["  PLANTA TRITURACIÓN 1 ", " PO-A1-01 - ACARREADOR DE PLACAS "]))
      .toEqual({ sector: "PLANTA TRITURACIÓN 1", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" });
  });

  it("descarta la fila que solo trae el sector", () => {
    expect(filaDeSectorYEquipo(["FILLER 1", ""])).toBeNull();
  });

  it("descarta la fila que solo trae el equipo", () => {
    expect(filaDeSectorYEquipo(["", "PO-A1-01 - ACARREADOR DE PLACAS"])).toBeNull();
  });

  it("descarta la fila vacia y la fila corta", () => {
    expect(filaDeSectorYEquipo(["", ""])).toBeNull();
    expect(filaDeSectorYEquipo([])).toBeNull();
  });

  /** El guion es como estas planillas escriben el vacio. */
  it("descarta la fila con un guion suelto de cualquiera de los dos lados", () => {
    expect(filaDeSectorYEquipo(["-", "PO-A1-01 - ACARREADOR DE PLACAS"])).toBeNull();
    expect(filaDeSectorYEquipo(["FILLER 1", "-"])).toBeNull();
  });
});
