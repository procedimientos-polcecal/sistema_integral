import { describe, it, expect } from "vitest";
import { estadoDeTexto, filaDeOrden } from "./ordenes";

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
