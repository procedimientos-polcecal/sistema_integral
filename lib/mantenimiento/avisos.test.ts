import { describe, it, expect } from "vitest";
import { fechaDeSheets, codigoDeEquipo, filaDeAviso } from "./avisos";

/**
 * La planilla se lee sin formato, asi que las fechas llegan como serial de
 * Sheets. El texto formateado depende del locale de la planilla, y confundir
 * el dia con el mes ya costo corregir 885 registros en Compras.
 */
describe("fechas de la planilla de avisos", () => {
  it("convierte el serial de Sheets", () => {
    // 45992 = 2025-12-01
    expect(fechaDeSheets(45992)).toBe("2025-12-01");
  });

  it("acepta texto d/m/aaaa como respaldo", () => {
    expect(fechaDeSheets("1/12/2025")).toBe("2025-12-01");
    expect(fechaDeSheets("25/8/2026")).toBe("2026-08-25");
  });

  it("acepta ISO", () => {
    expect(fechaDeSheets("2026-08-25")).toBe("2026-08-25");
  });

  it("lo que no es una fecha no se inventa", () => {
    expect(fechaDeSheets("")).toBeNull();
    expect(fechaDeSheets(null)).toBeNull();
    expect(fechaDeSheets("proximamente")).toBeNull();
  });
});

describe("codigo del equipo dentro del texto", () => {
  it("lo saca de un texto que lo trae adelante", () => {
    expect(codigoDeEquipo("PO-A1-01 Compresor A1")).toBe("PO-A1-01");
  });

  it("tolera parentesis y separadores", () => {
    expect(codigoDeEquipo("Compresor (PO-A1-01)")).toBe("PO-A1-01");
    expect(codigoDeEquipo("PO-A1-01 - Compresor")).toBe("PO-A1-01");
  });

  it("sin codigo devuelve null", () => {
    expect(codigoDeEquipo("Compresor grande")).toBeNull();
    expect(codigoDeEquipo("")).toBeNull();
  });
});

describe("una fila de la planilla como aviso", () => {
  /**
   * El encabezado real de la planilla AVISOS, verificado contra ella:
   * N OA | FECHA | SECTOR | EQUIPO | DESCRIPCION | URGENCIA | QUIEN AVISO |
   * Column 10 | Column 11 | OT ASIGNADA | Imagen | Observaciones
   *
   * Las columnas 7 y 8 son restos de una formula que parte el nombre en dos, y
   * no se leen.
   */
  const fila = [
    "A12", 45992, "Molienda", "PO-A1-01 Compresor A1", "Pierde aceite",
    "Alta", "Francisco Varela", "Francisco", "Varela", "si",
    "https://drive.google.com/open?id=ABC", "Se reviso el lunes",
  ];

  it("lee cada columna por su posicion", () => {
    const a = filaDeAviso(fila, 7);
    expect(a).not.toBeNull();
    if (!a) return;
    expect(a.oa_number).toBe("A12");
    expect(a.fecha).toBe("2025-12-01");
    expect(a.sector_raw).toBe("Molienda");
    expect(a.equipo_raw).toBe("PO-A1-01 Compresor A1");
    expect(a.equipo_code).toBe("PO-A1-01");
    expect(a.descripcion).toBe("Pierde aceite");
    expect(a.quien_aviso).toBe("Francisco Varela");
    expect(a.ot_asignada).toBe("si");
    expect(a.sheets_row).toBe(7);
  });

  /**
   * El codigo de origen leia las observaciones de la columna 10, que en la
   * planilla de hoy es "Imagen": los avisos con foto se guardaban con la URL
   * de Drive en el campo de observaciones.
   */
  it("la columna 10 es la imagen y la 11 las observaciones", () => {
    const a = filaDeAviso(fila, 7);
    expect(a?.observaciones).toBe("Se reviso el lunes");
    expect(a?.reference_photos).toEqual(["https://drive.google.com/open?id=ABC"]);
  });

  it("sin imagen no inventa un arreglo vacio", () => {
    const sinFoto = [...fila];
    sinFoto[10] = "";
    expect(filaDeAviso(sinFoto, 7)?.reference_photos).toBeNull();
  });

  /**
   * La planilla tiene una formula rota que deja "#REF! (...)" en la celda de
   * quien aviso. Guardarla seria guardar el mensaje de error como si fuera un
   * nombre.
   */
  it("una celda con error de formula se lee como vacia", () => {
    const conError = ["A1", "", "", "", "", "", "#REF! (Array result was not expanded)"];
    const a = filaDeAviso(conError, 2);
    expect(a?.quien_aviso).toBeNull();
    expect(a?.oa_number).toBe("A1");
  });

  it("una fila sin numero de aviso no es un aviso", () => {
    expect(filaDeAviso(["", 45992, "Molienda"], 8)).toBeNull();
    expect(filaDeAviso([], 9)).toBeNull();
  });

  it("las celdas vacias quedan en null, no en cadena vacia", () => {
    const a = filaDeAviso(["A13", "", "", "", "", "", "", "", "", "", "", ""], 10);
    expect(a?.sector_raw).toBeNull();
    expect(a?.descripcion).toBeNull();
    expect(a?.fecha).toBeNull();
  });
});
