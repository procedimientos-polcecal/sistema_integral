import { describe, it, expect } from "vitest";
import { armarIndicadores, destinoDeLaEtapa, ETAPAS_DEL_TABLERO } from "./tablero";
import { COLUMNAS_TABLERO } from "./constants";

describe("a donde lleva cada indicador", () => {
  it("las etapas comunes llevan al listado filtrado por su estado", () => {
    expect(destinoDeLaEtapa("SIN_INICIAR", false))
      .toBe("/compras/requerimientos?estado_compra=SIN_INICIAR");
    expect(destinoDeLaEtapa("PEDIDO", true))
      .toBe("/compras/requerimientos?estado_compra=PEDIDO");
  });

  it("Para comprar lleva a la bandeja, que ya es la pantalla de ese estado", () => {
    expect(destinoDeLaEtapa("PARA_COMPRAR", true)).toBe("/compras/para-aprobar");
  });

  it("pero no a quien no aprueba: la bandeja lo rebotaria a /compras", () => {
    expect(destinoDeLaEtapa("PARA_COMPRAR", false))
      .toBe("/compras/requerimientos?estado_compra=PARA_COMPRAR");
  });
});

describe("los indicadores del tablero", () => {
  it("estan las cinco etapas del circuito, y despues la espera", () => {
    const i = armarIndicadores([], false);
    expect(i.map((x) => x.estado)).toEqual([...COLUMNAS_TABLERO, "EN_ESPERA"]);
  });

  it("la espera se muestra pero NO es parte del circuito", () => {
    // COLUMNAS_TABLERO es el recorrido del trabajo; la espera es un desvio.
    // Mezclarlas haria que el circuito diga que despues de PEDIDO se espera.
    expect(COLUMNAS_TABLERO).not.toContain("EN_ESPERA");
    expect(ETAPAS_DEL_TABLERO).toContain("EN_ESPERA");
  });

  it("una etapa sin trabajo va en cero, no desaparece", () => {
    // La vista agrupa: un estado sin filas simplemente no viene. Que el cero
    // se vea es informacion —"no hay nada aca"—, no un hueco.
    const i = armarIndicadores(
      [{ estado_compra: "PEDIDO", cantidad: 1169, monto: 84_000_000 }],
      false
    );
    expect(i.find((x) => x.estado === "PEDIDO")).toMatchObject({
      cantidad: 1169,
      monto: 84_000_000,
    });
    expect(i.find((x) => x.estado === "SIN_INICIAR")).toMatchObject({
      cantidad: 0,
      monto: 0,
    });
  });

  it("ignora los estados que no son columnas del tablero", () => {
    const i = armarIndicadores(
      [{ estado_compra: "DENEGADO", cantidad: 40, monto: 0 }],
      false
    );
    expect(i).toHaveLength(ETAPAS_DEL_TABLERO.length);
    expect(i.some((x) => x.estado === "DENEGADO")).toBe(false);
  });
});
