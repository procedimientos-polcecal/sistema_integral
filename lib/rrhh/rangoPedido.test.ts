import { describe, it, expect } from "vitest";
import { rangoPedido } from "./rangoPedido";

function params(q: Record<string, string>) {
  return new URLSearchParams(q);
}

describe("rangoPedido", () => {
  it("devuelve lo que pidieron cuando las dos fechas son válidas", () => {
    expect(rangoPedido(params({ desde: "2026-10-01", hasta: "2026-10-31" }))).toEqual({
      desde: "2026-10-01",
      hasta: "2026-10-31",
    });
  });

  it("sin parámetros toma el mes en curso, en hora de Argentina", () => {
    /*
     * 00:30 UTC del 1 de noviembre son las 21:30 del 31 de octubre acá. Sin la
     * cuenta de Argentina el rango saltaría a noviembre a las nueve y media de
     * la noche, y la pantalla mostraría un mes vacío.
     */
    expect(rangoPedido(params({}), new Date("2026-11-01T00:30:00Z"))).toEqual({
      desde: "2026-10-01",
      hasta: "2026-10-31",
    });
  });

  it("una fecha mal escrita cae al valor por defecto en vez de dar error", () => {
    const r = rangoPedido(params({ desde: "ayer", hasta: "2026-10-31" }), new Date("2026-10-20T15:00:00Z"));
    expect(r).toEqual({ desde: "2026-10-01", hasta: "2026-10-31" });
  });

  it("rechaza un día que no existe", () => {
    // 2026-02-30 pasa cualquier regex de forma y no es una fecha.
    const r = rangoPedido(params({ hasta: "2026-02-30" }), new Date("2026-10-20T15:00:00Z"));
    expect(r.hasta).toBe("2026-10-20");
  });

  it("cada fecha se decide sola: una mala no arrastra a la otra", () => {
    const r = rangoPedido(params({ desde: "2026-09-15", hasta: "nada" }), new Date("2026-10-20T15:00:00Z"));
    expect(r).toEqual({ desde: "2026-09-15", hasta: "2026-10-20" });
  });
});
