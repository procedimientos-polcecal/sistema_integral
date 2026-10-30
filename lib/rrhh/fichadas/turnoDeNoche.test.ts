import { describe, it, expect } from "vitest";
import { diaDeLaSalida, problemaDeLaFila } from "./turnoDeNoche";

describe("diaDeLaSalida", () => {
  /** El caso que se repite: turno de 20 a 4. */
  it("una salida anterior a la entrada es del día siguiente", () => {
    expect(diaDeLaSalida("2026-10-20", "19:52", "03:45")).toBe("2026-10-21");
  });

  it("una salida posterior es del mismo día", () => {
    expect(diaDeLaSalida("2026-10-20", "08:00", "16:00")).toBe("2026-10-20");
  });

  /**
   * Igual NO se corre. Un turno de duración cero es un tipeo, y moverlo al día
   * siguiente lo convertiría en uno de 24 horas: callado y peor.
   * `problemaDeLaFila` lo rechaza.
   */
  it("una salida igual a la entrada se deja donde está", () => {
    expect(diaDeLaSalida("2026-10-20", "20:00", "20:00")).toBe("2026-10-20");
  });

  it("cruza el fin de mes sin inventar días", () => {
    expect(diaDeLaSalida("2026-10-31", "20:00", "04:00")).toBe("2026-11-01");
  });

  it("cruza el fin de año", () => {
    expect(diaDeLaSalida("2026-12-31", "20:00", "04:00")).toBe("2027-01-01");
  });

  /** Mientras se tipea la hora llega a medias: no se toca nada. */
  it("una hora incompleta deja la fecha como estaba", () => {
    expect(diaDeLaSalida("2026-10-20", "19:52", "0")).toBe("2026-10-20");
    expect(diaDeLaSalida("2026-10-20", "19:52", "")).toBe("2026-10-20");
    expect(diaDeLaSalida("2026-10-20", "", "03:45")).toBe("2026-10-20");
  });

  it("una fecha que no es una fecha vuelve tal cual", () => {
    expect(diaDeLaSalida("", "19:52", "03:45")).toBe("");
  });
});

describe("problemaDeLaFila", () => {
  // El mismo ISO que produce `instanteDePared`, que es quien la llama.
  const t = (iso: string) => iso;

  it("sin entrada no se puede guardar", () => {
    expect(problemaDeLaFila(null, null)).toContain("entrada");
  });

  it("una fila normal no tiene problema", () => {
    expect(problemaDeLaFila(t("2026-10-20T11:00:00Z"), t("2026-10-20T19:00:00Z"))).toBeNull();
  });

  it("una entrada sin salida es válida: el turno sigue abierto", () => {
    expect(problemaDeLaFila(t("2026-10-20T22:52:00Z"), null)).toBeNull();
  });

  /** Las 18 filas que hay en la base, que nada impedía guardar. */
  it("una salida anterior a la entrada se rechaza", () => {
    const r = problemaDeLaFila(t("2026-10-20T22:52:00Z"), t("2026-10-20T06:45:00Z"));
    expect(r).toContain("no puede ser anterior");
  });

  it("una salida igual a la entrada también", () => {
    expect(problemaDeLaFila(t("2026-10-20T23:00:00Z"), t("2026-10-20T23:00:00Z"))).not.toBeNull();
  });

  /** El turno de noche bien cargado sí pasa: la salida es del día siguiente. */
  it("un turno que cruza medianoche pasa", () => {
    expect(problemaDeLaFila(t("2026-10-20T22:52:00Z"), t("2026-10-21T06:45:00Z"))).toBeNull();
  });
});
