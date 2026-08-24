import { describe, it, expect } from "vitest";
import { fechaISO } from "./sheets";

/**
 * La planilla escribe las fechas en d/m/aaaa, como corresponde al locale del
 * documento.
 *
 * El parser suponía lo contrario —"M/D, que es el formato de la mayoría de las
 * filas"— y daba vuelta el día y el mes en toda fecha cuyo día fuera 12 o menos:
 * el 39% de los requerimientos. Se veía en la secuencia de RI, que es
 * correlativa: los RI 1795 a 1811, del 11 y 12 de agosto, quedaron guardados
 * como noviembre y diciembre, y el 1812 —del 13 de agosto— quedó bien, porque
 * 13 no puede ser un mes y ahí el parser acertaba por descarte.
 */
describe("fechas de la planilla", () => {
  it("lee d/m/aaaa, que es como las escribe la planilla", () => {
    expect(fechaISO("12/08/2026")).toBe("2026-08-12");
    expect(fechaISO("11/08/2026")).toBe("2026-08-11");
    expect(fechaISO("01/09/2026")).toBe("2026-09-01");
  });

  it("no se confunde cuando el día no puede ser un mes", () => {
    expect(fechaISO("13/08/2026")).toBe("2026-08-13");
    expect(fechaISO("31/12/2025")).toBe("2025-12-31");
  });

  it("acepta un solo dígito y el año de dos", () => {
    expect(fechaISO("5/3/26")).toBe("2026-03-05");
  });

  it("tolera que la celda traiga también la hora", () => {
    expect(fechaISO("12/08/2026 14:30:05")).toBe("2026-08-12");
  });

  it("una fecha imposible no se inventa: devuelve null", () => {
    expect(fechaISO("32/08/2026")).toBeNull();
    expect(fechaISO("12/13/2026")).toBeNull();
    expect(fechaISO("")).toBeNull();
    expect(fechaISO(null)).toBeNull();
  });

  it("acepta el formato ISO por si alguna celda viene así", () => {
    expect(fechaISO("2026-08-12")).toBe("2026-08-12");
  });
});
