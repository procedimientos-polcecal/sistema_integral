import { describe, it, expect } from "vitest";
import { COLUMNAS_TABLERO, SIGUIENTE_ESTADO, ACCION_SIGUIENTE, COMPRA_LABELS } from "./constants";
import type { EstadoCompra } from "./types";

/**
 * El circuito real, según quienes lo usan:
 *
 *   RI aprobado → comparativa → para comprar → aprobado → pedido
 *
 * Antes estaba invertido (para comprar antes que comparativa) y sin el paso de
 * aprobación de la compra. Este test fija el orden para que no se vuelva a dar
 * vuelta sin querer.
 */
describe("circuito de compra", () => {
  it("las columnas del tablero van en el orden del trabajo", () => {
    expect(COLUMNAS_TABLERO).toEqual([
      "SIN_INICIAR", "EN_COMPARATIVA", "PARA_COMPRAR", "APROBADO", "PEDIDO",
    ]);
  });

  it("cada paso lleva al siguiente sin saltearse ninguno", () => {
    const recorrido: EstadoCompra[] = [];
    let actual: EstadoCompra | undefined = "SIN_INICIAR";
    while (actual) {
      recorrido.push(actual);
      actual = SIGUIENTE_ESTADO[actual];
    }
    expect(recorrido).toEqual([
      "SIN_INICIAR", "EN_COMPARATIVA", "PARA_COMPRAR", "APROBADO", "PEDIDO",
    ]);
  });

  it("cada paso del tablero dice qué acción ofrece", () => {
    for (const estado of COLUMNAS_TABLERO) {
      if (!SIGUIENTE_ESTADO[estado]) continue;
      expect(ACCION_SIGUIENTE[estado], `falta la acción de ${estado}`).toBeTruthy();
    }
  });

  it("todos los estados tienen etiqueta, incluido el nuevo APROBADO", () => {
    expect(COMPRA_LABELS.APROBADO.label).toBe("Compra aprobada");
    for (const e of COLUMNAS_TABLERO) expect(COMPRA_LABELS[e]).toBeTruthy();
  });

  it("PEDIDO es el final del tablero: lo que sigue es el seguimiento", () => {
    expect(SIGUIENTE_ESTADO.PEDIDO).toBeUndefined();
  });
});
