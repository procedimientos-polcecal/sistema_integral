import { describe, it, expect } from "vitest";
import { comoLeLlego } from "./seguimiento";

describe("comoLeLlego", () => {
  it("dice cuántos días tarde llegó", () => {
    const r = comoLeLlego({
      fecha_estimada_recepcion: "2026-09-06",
      fecha_recepcion: "2026-09-15",
      cantidad: 10, cantidad_comprada: null, cantidad_recibida: 10,
    });
    expect(r.demora).toBe("llegó 9 días tarde");
  });

  it("en o antes de la estimada es a tiempo", () => {
    const r = comoLeLlego({
      fecha_estimada_recepcion: "2026-09-15",
      fecha_recepcion: "2026-09-15",
      cantidad: 1, cantidad_comprada: null, cantidad_recibida: 1,
    });
    expect(r.demora).toBe("llegó a tiempo");
  });

  it("un solo día se dice en singular", () => {
    const r = comoLeLlego({
      fecha_estimada_recepcion: "2026-09-14",
      fecha_recepcion: "2026-09-15",
      cantidad: 1, cantidad_comprada: null, cantidad_recibida: 1,
    });
    expect(r.demora).toBe("llegó 1 día tarde");
  });

  it("sin alguna de las dos fechas no inventa nada", () => {
    expect(comoLeLlego({
      fecha_estimada_recepcion: null, fecha_recepcion: "2026-09-15",
      cantidad: 1, cantidad_comprada: null, cantidad_recibida: 1,
    }).demora).toBeNull();
    expect(comoLeLlego({
      fecha_estimada_recepcion: "2026-09-15", fecha_recepcion: null,
      cantidad: 1, cantidad_comprada: null, cantidad_recibida: 1,
    }).demora).toBeNull();
  });

  it("dice cuánto recibió de cuánto", () => {
    const r = comoLeLlego({
      fecha_estimada_recepcion: null, fecha_recepcion: null,
      cantidad: 1000, cantidad_comprada: null, cantidad_recibida: 500,
    });
    expect(r.cantidad).toBe("recibió 500 de 1000");
  });

  it("compara contra lo comprado y no contra lo pedido en el RI", () => {
    const r = comoLeLlego({
      fecha_estimada_recepcion: null, fecha_recepcion: null,
      cantidad: 100, cantidad_comprada: 95, cantidad_recibida: 95,
    });
    expect(r.cantidad).toBe("recibió todo lo comprado");
  });

  /** Pasa de verdad: el RI 219 recibió 550 de 500. */
  it("recibir de más no se disfraza de completo", () => {
    const r = comoLeLlego({
      fecha_estimada_recepcion: null, fecha_recepcion: null,
      cantidad: 500, cantidad_comprada: null, cantidad_recibida: 550,
    });
    expect(r.cantidad).toBe("recibió 550 de 500: 50 de más");
  });

  it("sin cantidad cargada no dice nada", () => {
    const r = comoLeLlego({
      fecha_estimada_recepcion: null, fecha_recepcion: null,
      cantidad: 500, cantidad_comprada: null, cantidad_recibida: null,
    });
    expect(r.cantidad).toBeNull();
  });

  /**
   * Una fecha que no se puede leer no produce un número: produce nada. Con un
   * `" "` esto devolvía "llegó 46310 días tarde", que es el peor error posible
   * acá —un dato inventado que se lee como cierto— al lado de un juicio que
   * decide una persona.
   */
  it("una fecha ilegible no inventa una demora", () => {
    const base = { cantidad: 1, cantidad_comprada: null, cantidad_recibida: 1 };
    expect(comoLeLlego({ ...base, fecha_estimada_recepcion: " ", fecha_recepcion: "2026-09-15" }).demora).toBeNull();
    expect(comoLeLlego({ ...base, fecha_estimada_recepcion: "31/12/2026", fecha_recepcion: "2026-09-15" }).demora).toBeNull();
    expect(comoLeLlego({ ...base, fecha_estimada_recepcion: "2026-02-30", fecha_recepcion: "2026-09-15" }).demora).toBeNull();
  });

  /**
   * El cero es un valor, no una ausencia: `??` y no `||`. Con `||`, un cero
   * comprado compararía contra la cantidad del pedido original.
   */
  it("compara contra un cero comprado y no contra lo pedido", () => {
    const r = comoLeLlego({
      fecha_estimada_recepcion: null, fecha_recepcion: null,
      cantidad: 100, cantidad_comprada: 0, cantidad_recibida: 0,
    });
    expect(r.cantidad).toBe("recibió todo lo comprado");
  });
});
