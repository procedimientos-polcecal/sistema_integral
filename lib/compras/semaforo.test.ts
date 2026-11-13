import { describe, it, expect } from "vitest";
import {
  esReclamable, colorDelPedido, diasEsperando, rangoDeColor,
} from "./semaforo";

describe("esReclamable", () => {
  it("acepta los cuatro estados que esperan a Compras", () => {
    for (const e of ["SIN_INICIAR", "EN_COMPARATIVA", "PARA_COMPRAR", "APROBADO"]) {
      expect(esReclamable({ estado_compra: e, estado_aprobacion: "APROBADA" })).toBe(true);
    }
  });

  it("deja afuera lo ya pedido, lo recibido y lo denegado", () => {
    for (const e of ["PEDIDO", "RECIBIDO", "DENEGADO"]) {
      expect(esReclamable({ estado_compra: e, estado_aprobacion: "APROBADA" })).toBe(false);
    }
  });

  /*
   * Medido el 12/11/2026: 9 de los 10 pedidos más viejos que esperaban a
   * Compras estaban EN_ESPERA. Sin esta línea, lo primero que ve el área
   * arriba de todo son pedidos que alguien congeló a propósito, y el primer
   * reclamo que sale se contesta con «ése está en espera».
   */
  it("deja afuera EN_ESPERA, que es un desvío y no una etapa", () => {
    expect(esReclamable({ estado_compra: "EN_ESPERA", estado_aprobacion: "APROBADA" })).toBe(false);
  });

  it("deja afuera lo denegado por gerencia aunque la compra no se haya tocado", () => {
    expect(esReclamable({ estado_compra: "SIN_INICIAR", estado_aprobacion: "DENEGADA" })).toBe(false);
  });
});

describe("colorDelPedido", () => {
  const hoy = new Date("2026-11-12T10:00:00Z");

  it("verde hasta 30 días", () => {
    expect(colorDelPedido("2026-11-12", hoy)).toBe("verde");
    expect(colorDelPedido("2026-10-13", hoy)).toBe("verde");
  });

  it("amarillo de 31 a 90", () => {
    expect(colorDelPedido("2026-10-12", hoy)).toBe("amarillo");
    expect(colorDelPedido("2026-08-14", hoy)).toBe("amarillo");
  });

  it("rojo a partir de 91", () => {
    expect(colorDelPedido("2026-08-13", hoy)).toBe("rojo");
  });

  // Medido: el pedido más nuevo del día tenía -1 día. Una fecha adelantada no
  // puede abrir un cuarto estado ni reventar la cuenta.
  it("una fecha futura es verde y no un cuarto estado", () => {
    expect(colorDelPedido("2026-11-20", hoy)).toBe("verde");
    expect(diasEsperando("2026-11-20", hoy)).toBeLessThan(0);
  });
});

describe("rangoDeColor", () => {
  const hoy = new Date("2026-11-12T10:00:00Z");

  it("el rojo es todo lo anterior al corte de 90", () => {
    expect(rangoDeColor("rojo", hoy)).toEqual({ hasta: "2026-08-13" });
  });

  it("el amarillo tiene las dos puntas", () => {
    expect(rangoDeColor("amarillo", hoy)).toEqual({ desde: "2026-08-14", hasta: "2026-10-12" });
  });

  it("el verde no tiene tope: una fecha futura entra", () => {
    expect(rangoDeColor("verde", hoy)).toEqual({ desde: "2026-10-13" });
  });

  /*
   * Los bordes de `rangoDeColor` y los de `colorDelPedido` tienen que ser el
   * mismo día. Si se separan, la franja cuenta un pedido en un color y el
   * punto del renglón lo pinta de otro — y nadie vuelve a confiar en ninguno
   * de los dos.
   */
  it("los bordes coinciden con los de colorDelPedido", () => {
    for (const color of ["verde", "amarillo", "rojo"] as const) {
      const r = rangoDeColor(color, hoy);
      if (r.desde) expect(colorDelPedido(r.desde, hoy)).toBe(color);
      if (r.hasta) expect(colorDelPedido(r.hasta, hoy)).toBe(color);
    }
  });
});
