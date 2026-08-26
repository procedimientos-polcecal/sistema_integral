import { describe, it, expect } from "vitest";
import { estadoDeTexto, filaDeOrden, celdasParaRegistrar } from "./ordenes";

/**
 * Los cuatro estados que usa la planilla, verificados contra ella:
 * Realizado | Atrasado | Por hacer | En proceso.
 */
describe("estado de la planilla", () => {
  it("traduce los cuatro que se usan", () => {
    expect(estadoDeTexto("Realizado")).toBe("REALIZADO");
    expect(estadoDeTexto("En proceso")).toBe("EN_PROCESO");
    expect(estadoDeTexto("Atrasado")).toBe("ATRASADO");
    expect(estadoDeTexto("Por hacer")).toBe("POR_HACER");
  });

  it("no depende de mayusculas ni espacios", () => {
    expect(estadoDeTexto("  REALIZADO ")).toBe("REALIZADO");
    expect(estadoDeTexto("en Proceso")).toBe("EN_PROCESO");
  });

  /**
   * Una OT que la planilla no clasifica todavia es una OT por hacer: es el
   * estado del que se parte, no un dato faltante.
   */
  it("lo que no reconoce queda por hacer", () => {
    expect(estadoDeTexto("")).toBe("POR_HACER");
    expect(estadoDeTexto(null)).toBe("POR_HACER");
    expect(estadoDeTexto("cualquier cosa")).toBe("POR_HACER");
  });
});

describe("una fila de la planilla como orden de trabajo", () => {
  /**
   * Fila real de la planilla OT. La columna L —"Column 19"— es un "Atrasado /
   * al dia" calculado y NO es el estado: el estado esta en M.
   */
  const fila = [
    623, 45992.40406341436, "Planta de trituración 1", "PO-A1-07 – Rompedora de cono",
    "MECÁNICO", "PROGRAMADO", "INTERNO", "Cambio de rodamientos del eje",
    "Dos rodamientos 32222", 45992, 45994, "Atrasado", "Realizado", "-", "-",
  ];

  it("lee cada columna por su posicion", () => {
    const o = filaDeOrden(fila, 3);
    expect(o).not.toBeNull();
    if (!o) return;
    expect(o.ot_number).toBe(623);
    expect(o.fecha).toBe("2025-12-01");
    expect(o.sector_raw).toBe("Planta de trituración 1");
    expect(o.equipo_raw).toBe("PO-A1-07 – Rompedora de cono");
    expect(o.equipo_code).toBe("PO-A1-07");
    expect(o.especialidad).toBe("MECÁNICO");
    expect(o.tipo).toBe("PROGRAMADO");
    expect(o.descripcion).toBe("Cambio de rodamientos del eje");
    expect(o.fecha_ejecucion).toBe("2025-12-01");
    expect(o.fecha_cierre).toBe("2025-12-03");
    expect(o.sheets_row).toBe(3);
  });

  it("el estado sale de M, no de la columna calculada de al lado", () => {
    expect(filaDeOrden(fila, 3)?.estado).toBe("REALIZADO");
  });

  it("una fila sin numero de OT no es una orden", () => {
    expect(filaDeOrden(["", 45992], 4)).toBeNull();
    expect(filaDeOrden(["texto", 45992], 5)).toBeNull();
    expect(filaDeOrden([], 6)).toBeNull();
  });

  it("las horas se leen como numero, y lo que no lo es queda en null", () => {
    const conHoras = [...fila]; conHoras[14] = "3,5";
    expect(filaDeOrden(conHoras, 3)?.horas).toBe(3.5);
    const sinHoras = [...fila]; sinHoras[14] = "-";
    expect(filaDeOrden(sinHoras, 3)?.horas).toBeNull();
  });

  it("un guion en un campo de texto es vacio, no un guion", () => {
    const o = filaDeOrden(fila, 3);
    expect(o?.contratista).toBeNull();
    expect(o?.operario_1).toBeNull();
  });
});

describe("celdasParaRegistrar", () => {
  const registro = {
    estado: "REALIZADO",
    fecha_cierre: "2026-08-25",
    horas: 3.5,
    contratista: "ConMet",
    operario_1: "Pérez",
    operario_2: null,
    operario_3: null,
    observaciones: "Se cambió el rodamiento",
    foto_url: null,
  };

  it("manda cada dato a su columna", () => {
    const celdas = celdasParaRegistrar(registro);
    const de = (letra: string) => celdas.find((c) => c.letra === letra)?.valor;

    // Verificado contra la planilla: M estado, K cierre, O horas, W observaciones.
    expect(de("M")).toBe("Realizado");
    expect(de("K")).toBe("25/08/2026");
    expect(de("O")).toBe("3.5");
    expect(de("N")).toBe("ConMet");
    expect(de("P")).toBe("Pérez");
    expect(de("W")).toBe("Se cambió el rodamiento");
  });

  it("no escribe la columna L, que es una fórmula", () => {
    // "Column 19" calcula atrasado/al día. Pisarla rompería el cálculo de
    // toda la planilla.
    expect(celdasParaRegistrar(registro).map((c) => c.letra)).not.toContain("L");
  });

  it("escribe el estado como lo escribe la planilla, no como lo guarda la app", () => {
    expect(celdasParaRegistrar({ estado: "EN_PROCESO" }).find((c) => c.letra === "M")?.valor)
      .toBe("En proceso");
    expect(celdasParaRegistrar({ estado: "POR_HACER" }).find((c) => c.letra === "M")?.valor)
      .toBe("Por hacer");
  });

  it("sólo manda lo que se pasó", () => {
    const celdas = celdasParaRegistrar({ observaciones: "sólo esto" });
    expect(celdas).toHaveLength(1);
    expect(celdas[0].letra).toBe("W");
  });

  it("vaciar un campo lo vacía en la planilla", () => {
    // Distinto de no pasarlo: pasarlo en null es "sacá lo que había".
    expect(celdasParaRegistrar({ contratista: null })).toEqual([
      { letra: "N", columna: 13, valor: "" },
    ]);
  });
});
