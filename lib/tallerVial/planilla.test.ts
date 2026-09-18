import { describe, it, expect } from "vitest";
import { columnaDelEquipoEnEstados, esEcoDeCargaDelSistema, filaDeLaFechaEnEstados } from "./planilla";

describe("filaDeLaFechaEnEstados", () => {
  const columnaA = [["FECHA"], ["16/09/2026"], ["17/09/2026"], ["18/09/2026"]];

  it("la fila de Sheets de una fecha que está una sola vez", () => {
    expect(filaDeLaFechaEnEstados(columnaA, "2026-09-17")).toEqual({ fila: 3 });
  });

  it("no_existe si la fecha no está — se agrega una fila nueva", () => {
    expect(filaDeLaFechaEnEstados(columnaA, "2026-09-20")).toEqual({ fila: null, motivo: "no_existe" });
  });

  it("ambigua si la fecha está repetida — no se elige la primera ni se agrega una tercera", () => {
    const conRepetida = [...columnaA, ["17/09/2026"]];
    expect(filaDeLaFechaEnEstados(conRepetida, "2026-09-17")).toEqual({ fila: null, motivo: "ambigua" });
  });
});

describe("columnaDelEquipoEnEstados", () => {
  const encabezado = ["FECHA", "EM1 - Caterpillar 320 B", "EM2 - Caterpillar 320 C", "EM3 - Doosan 225 1"];

  it("la columna de un equipo que está una sola vez", () => {
    expect(columnaDelEquipoEnEstados(encabezado, "EM2")).toBe(2);
  });

  it("null si el equipo no tiene columna", () => {
    expect(columnaDelEquipoEnEstados(encabezado, "EM9")).toBeNull();
  });

  it("null si el código aparece en más de una columna", () => {
    const conRepetida = [...encabezado, "EM2 - duplicada a mano"];
    expect(columnaDelEquipoEnEstados(conRepetida, "EM2")).toBeNull();
  });
});

describe("esEcoDeCargaDelSistema", () => {
  it("true cuando la columna H (índice 7) tiene algo", () => {
    const fila = ["17/9/2026", "EM3 - Doosan 225 1", "100", "8000", "DIESEL 500", "10", "10", "uuid-de-la-carga"];
    expect(esEcoDeCargaDelSistema(fila)).toBe(true);
  });

  it("false cuando la fila viene de la planilla, sin id de sistema", () => {
    const fila = ["17/9/2026", "EM3 - Doosan 225 1", "100", "8000", "DIESEL 500", "10", "10"];
    expect(esEcoDeCargaDelSistema(fila)).toBe(false);
  });

  it("false con una fila corta, sin llegar a la columna H", () => {
    expect(esEcoDeCargaDelSistema(["17/9/2026", "EM3 - Doosan 225 1"])).toBe(false);
  });
});
