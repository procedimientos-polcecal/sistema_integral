import { describe, it, expect } from "vitest";
import { resumenMensualDeReparaciones } from "./reparaciones";

describe("resumenMensualDeReparaciones", () => {
  it("cuenta las reparaciones de cada equipo dentro del mes", () => {
    const resumen = resumenMensualDeReparaciones(
      [
        { equipoId: "EM1", fecha: "2026-09-01" },
        { equipoId: "EM1", fecha: "2026-09-10" },
        { equipoId: "EM2", fecha: "2026-09-05" },
        { equipoId: "EM1", fecha: "2026-08-31" }, // otro mes, no cuenta
      ],
      "2026-09"
    );
    const em1 = resumen.find((r) => r.equipoId === "EM1")!;
    const em2 = resumen.find((r) => r.equipoId === "EM2")!;
    expect(em1.cantidad).toBe(2);
    expect(em2.cantidad).toBe(1);
  });

  it("sin reparaciones ese mes, la lista queda vacía", () => {
    expect(resumenMensualDeReparaciones([{ equipoId: "EM1", fecha: "2026-08-01" }], "2026-09")).toEqual([]);
  });
});
