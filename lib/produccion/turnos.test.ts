import { describe, it, expect } from "vitest";
import { parteAnterior, comoSeLeeElTurno, esTurno, TURNOS } from "./turnos";

describe("cual es el parte anterior", () => {
  it("el anterior al turno de la tarde es el de la manana del mismo dia", () => {
    expect(parteAnterior({ fecha: "2026-09-03", turno: "12_20" }))
      .toEqual({ fecha: "2026-09-03", turno: "4_12" });
  });

  it("el anterior al turno de la manana es la tarde del dia previo", () => {
    expect(parteAnterior({ fecha: "2026-09-03", turno: "4_12" }))
      .toEqual({ fecha: "2026-09-02", turno: "12_20" });
  });

  it("cruza el mes", () => {
    expect(parteAnterior({ fecha: "2026-09-01", turno: "4_12" }))
      .toEqual({ fecha: "2026-08-31", turno: "12_20" });
  });

  it("cruza el ano", () => {
    expect(parteAnterior({ fecha: "2026-01-01", turno: "4_12" }))
      .toEqual({ fecha: "2025-12-31", turno: "12_20" });
  });
});

describe("como se muestran los turnos", () => {
  it("son dos y en el orden en que ocurren", () => {
    expect(TURNOS).toEqual(["4_12", "12_20"]);
  });

  it("se leen con las horas", () => {
    expect(comoSeLeeElTurno("4_12")).toBe("4 a 12");
    expect(comoSeLeeElTurno("12_20")).toBe("12 a 20");
  });
});

describe("si el valor es uno de los dos turnos", () => {
  it("acepta los dos turnos validos", () => {
    expect(esTurno("4_12")).toBe(true);
    expect(esTurno("12_20")).toBe(true);
  });

  it("rechaza cualquier otra cosa, incluido lo que llega mal formado por la URL", () => {
    expect(esTurno("20_4")).toBe(false);
    expect(esTurno("")).toBe(false);
    expect(esTurno(null)).toBe(false);
    expect(esTurno(undefined)).toBe(false);
  });
});
