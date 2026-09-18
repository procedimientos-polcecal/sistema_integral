import { describe, it, expect } from "vitest";
import {
  codigoSheetDesdeEstado, esEstadoDiarioValido, estadoActualPorEquipo, estadoDesdeCodigoSheet,
  resumenDeEstadoActual, resumenMensualDeEstados, type EstadoPlano,
} from "./estados";

describe("estadoDesdeCodigoSheet", () => {
  it("mapea los tres códigos conocidos", () => {
    expect(estadoDesdeCodigoSheet("OP")).toBe("OPERATIVO");
    expect(estadoDesdeCodigoSheet("FS")).toBe("FUERA_DE_SERVICIO");
    expect(estadoDesdeCodigoSheet("OCF")).toBe("OPERATIVO_CON_FALLAS");
  });

  it("no distingue mayúsculas ni espacios", () => {
    expect(estadoDesdeCodigoSheet(" op ")).toBe("OPERATIVO");
    expect(estadoDesdeCodigoSheet("ocf")).toBe("OPERATIVO_CON_FALLAS");
  });

  it("null para un código que no es ninguno de los tres — no se adivina", () => {
    expect(estadoDesdeCodigoSheet("")).toBeNull();
    expect(estadoDesdeCodigoSheet("XX")).toBeNull();
  });
});

describe("codigoSheetDesdeEstado", () => {
  it("es la vuelta exacta de estadoDesdeCodigoSheet", () => {
    expect(codigoSheetDesdeEstado("OPERATIVO")).toBe("OP");
    expect(codigoSheetDesdeEstado("FUERA_DE_SERVICIO")).toBe("FS");
    expect(codigoSheetDesdeEstado("OPERATIVO_CON_FALLAS")).toBe("OCF");
  });
});

describe("esEstadoDiarioValido", () => {
  it("acepta los tres estados", () => {
    expect(esEstadoDiarioValido("OPERATIVO")).toBe(true);
    expect(esEstadoDiarioValido("FUERA_DE_SERVICIO")).toBe(true);
    expect(esEstadoDiarioValido("OPERATIVO_CON_FALLAS")).toBe(true);
  });

  it("rechaza cualquier otra cosa", () => {
    expect(esEstadoDiarioValido("OP")).toBe(false);
    expect(esEstadoDiarioValido("")).toBe(false);
    expect(esEstadoDiarioValido(null)).toBe(false);
  });
});

describe("resumenMensualDeEstados", () => {
  const estados: EstadoPlano[] = [
    { equipoId: "EM1", fecha: "2026-09-01", estado: "OPERATIVO" },
    { equipoId: "EM1", fecha: "2026-09-02", estado: "OPERATIVO" },
    { equipoId: "EM1", fecha: "2026-09-03", estado: "FUERA_DE_SERVICIO" },
    { equipoId: "EM1", fecha: "2026-09-04", estado: "FUERA_DE_SERVICIO" },
    { equipoId: "EM1", fecha: "2026-09-05", estado: "OPERATIVO_CON_FALLAS" },
    { equipoId: "EM1", fecha: "2026-08-31", estado: "OPERATIVO" }, // otro mes, no cuenta
  ];

  it("cuenta los días de cada estado dentro del mes", () => {
    const [resumen] = resumenMensualDeEstados(estados, "2026-09");
    expect(resumen.equipoId).toBe("EM1");
    expect(resumen.diasRegistrados).toBe(5);
    expect(resumen.diasOperativo).toBe(2);
    expect(resumen.diasFueraDeServicio).toBe(2);
    expect(resumen.diasConFallas).toBe(1);
  });

  it("no mezcla equipos", () => {
    const conDosEquipos: EstadoPlano[] = [
      ...estados,
      { equipoId: "EM2", fecha: "2026-09-01", estado: "FUERA_DE_SERVICIO" },
    ];
    const resumen = resumenMensualDeEstados(conDosEquipos, "2026-09");
    expect(resumen).toHaveLength(2);
    const em2 = resumen.find((r) => r.equipoId === "EM2")!;
    expect(em2.diasFueraDeServicio).toBe(1);
    expect(em2.diasOperativo).toBe(0);
  });
});

describe("estadoActualPorEquipo", () => {
  it("toma el estado de la fecha más reciente de cada equipo", () => {
    const mapa = estadoActualPorEquipo([
      { equipoId: "EM1", fecha: "2026-09-01", estado: "OPERATIVO" },
      { equipoId: "EM1", fecha: "2026-09-10", estado: "FUERA_DE_SERVICIO" },
      { equipoId: "EM1", fecha: "2026-09-05", estado: "OPERATIVO_CON_FALLAS" },
    ]);
    expect(mapa.get("EM1")).toBe("FUERA_DE_SERVICIO");
  });

  it("cada equipo puede tener su último dato en una fecha distinta", () => {
    const mapa = estadoActualPorEquipo([
      { equipoId: "EM1", fecha: "2026-09-10", estado: "OPERATIVO" },
      { equipoId: "EM2", fecha: "2026-09-05", estado: "FUERA_DE_SERVICIO" }, // EM2 no tiene dato del 10
    ]);
    expect(mapa.get("EM1")).toBe("OPERATIVO");
    expect(mapa.get("EM2")).toBe("FUERA_DE_SERVICIO");
  });
});

describe("resumenDeEstadoActual", () => {
  it("cuenta cuántos equipos están en cada estado ahora mismo", () => {
    const estadoActual = new Map([
      ["EM1", "OPERATIVO" as const],
      ["EM2", "OPERATIVO" as const],
      ["EM3", "FUERA_DE_SERVICIO" as const],
      ["EM4", "OPERATIVO_CON_FALLAS" as const],
    ]);
    const resumen = resumenDeEstadoActual(estadoActual, ["EM1", "EM2", "EM3", "EM4"]);
    expect(resumen).toEqual({ operativos: 2, fueraDeServicio: 1, conFallas: 1, sinDato: 0, total: 4 });
  });

  it("un equipo sin ningún estado cargado cuenta como sinDato, no como operativo", () => {
    const estadoActual = new Map([["EM1", "OPERATIVO" as const]]);
    const resumen = resumenDeEstadoActual(estadoActual, ["EM1", "EM5"]);
    expect(resumen.sinDato).toBe(1);
    expect(resumen.total).toBe(2);
  });
});
