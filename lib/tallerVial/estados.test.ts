import { describe, it, expect } from "vitest";
import { estadoDesdeCodigoSheet, resumenMensualDeEstados, type EstadoPlano } from "./estados";

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
