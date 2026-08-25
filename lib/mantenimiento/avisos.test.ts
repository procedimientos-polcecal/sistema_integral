import { describe, it, expect } from "vitest";
import { filaDeAviso } from "./avisos";

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
