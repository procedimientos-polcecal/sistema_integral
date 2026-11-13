import { describe, it, expect } from "vitest";
import { armarEmbudo, tasaDeConversion, type OportunidadDelEmbudo } from "./embudo";

const op = (
  etapa: string,
  monto: number | null = null,
  moneda: string | null = "ARS",
  toneladas: number | null = null
): OportunidadDelEmbudo => ({
  etapa,
  monto_estimado: monto,
  moneda,
  toneladas_estimadas: toneladas,
});

describe("armarEmbudo", () => {
  /**
   * Una etapa que desaparece porque no tiene nada no se nota, y el tapón del
   * embudo es justamente lo que hay que ver.
   */
  it("devuelve siempre las seis columnas, en orden, aunque esté vacío", () => {
    const embudo = armarEmbudo([]);
    expect(embudo.columnas.map((c) => c.etapa.clave)).toEqual([
      "contacto_inicial",
      "relevamiento",
      "cotizada",
      "negociacion",
      "ganada",
      "perdida",
    ]);
    expect(embudo.columnas.every((c) => c.cantidad === 0)).toBe(true);
    expect(embudo.abiertas.cantidad).toBe(0);
  });

  it("cuenta y suma por etapa", () => {
    const embudo = armarEmbudo([
      op("cotizada", 100_000, "ARS", 50),
      op("cotizada", 50_000, "ARS", 20),
      op("negociacion", 200_000, "ARS"),
    ]);
    const cotizada = embudo.columnas.find((c) => c.etapa.clave === "cotizada")!;
    expect(cotizada.cantidad).toBe(2);
    expect(cotizada.monto.ARS).toBe(150_000);
    expect(cotizada.toneladas).toBe(70);
  });

  /**
   * Las dos monedas se suman por separado y no se convierten nunca: una
   * cotización del día haría que el embudo del mes pasado cambie cada vez que
   * se lo mira.
   */
  it("no mezcla pesos con dólares", () => {
    const embudo = armarEmbudo([op("cotizada", 100_000, "ARS"), op("cotizada", 1_000, "USD")]);
    const cotizada = embudo.columnas.find((c) => c.etapa.clave === "cotizada")!;
    expect(cotizada.monto).toEqual({ ARS: 100_000, USD: 1_000 });
  });

  it("una moneda que no se reconoce cae en pesos, que es el default de la tabla", () => {
    const embudo = armarEmbudo([op("cotizada", 100, "EUR"), op("cotizada", 100, null)]);
    expect(embudo.columnas.find((c) => c.etapa.clave === "cotizada")!.monto).toEqual({
      ARS: 200,
      USD: 0,
    });
  });

  it("pondera con la probabilidad de la etapa", () => {
    const embudo = armarEmbudo([op("cotizada", 100_000), op("negociacion", 100_000)]);
    expect(embudo.columnas.find((c) => c.etapa.clave === "cotizada")!.ponderado.ARS).toBe(50_000);
    expect(embudo.columnas.find((c) => c.etapa.clave === "negociacion")!.ponderado.ARS).toBe(75_000);
    // Y el ponderado de una perdida es cero, no su monto.
    expect(armarEmbudo([op("perdida", 100_000)]).columnas[5].ponderado.ARS).toBe(0);
  });

  /**
   * Una oportunidad sin monto se cuenta pero no suma cero: el `sinMonto` al
   * lado es lo que evita leer un embudo chico como «hay poco» cuando lo que
   * pasa es que falta cargar.
   */
  it("cuenta aparte las que no tienen monto", () => {
    const embudo = armarEmbudo([op("cotizada", null), op("cotizada", 10_000)]);
    const cotizada = embudo.columnas.find((c) => c.etapa.clave === "cotizada")!;
    expect(cotizada.cantidad).toBe(2);
    expect(cotizada.sinMonto).toBe(1);
    expect(cotizada.monto.ARS).toBe(10_000);
  });

  it("las toneladas no se ponderan y las que faltan no suman", () => {
    const embudo = armarEmbudo([op("cotizada", null, "ARS", 100), op("cotizada", 1, "ARS", null)]);
    expect(embudo.columnas.find((c) => c.etapa.clave === "cotizada")!.toneladas).toBe(100);
  });

  it("el total de abiertas no incluye ganadas ni perdidas", () => {
    const embudo = armarEmbudo([
      op("relevamiento", 10, "ARS", 1),
      op("negociacion", 20, "ARS", 2),
      op("ganada", 1_000, "ARS", 500),
      op("perdida", 1_000, "ARS", 500),
    ]);
    expect(embudo.abiertas.cantidad).toBe(2);
    expect(embudo.abiertas.monto.ARS).toBe(30);
    expect(embudo.abiertas.toneladas).toBe(3);
  });

  /**
   * Una etapa que no existe es una fila a arreglar, no un dato que se pueda
   * ubicar. Repartirla en alguna columna la escondería.
   */
  it("una etapa desconocida no entra en ninguna columna", () => {
    const embudo = armarEmbudo([op("inventada", 999)]);
    expect(embudo.columnas.reduce((t, c) => t + c.cantidad, 0)).toBe(0);
    expect(embudo.abiertas.monto.ARS).toBe(0);
  });
});

describe("tasaDeConversion", () => {
  /**
   * Sobre lo cerrado y no sobre todo: con las abiertas en el denominador, la
   * tasa baja cada vez que alguien carga una oportunidad nueva, o sea que
   * trabajar más empeora el indicador.
   */
  it("se calcula sobre lo cerrado y las abiertas no entran", () => {
    expect(
      tasaDeConversion([
        { etapa: "ganada" },
        { etapa: "perdida" },
        { etapa: "cotizada" },
        { etapa: "contacto_inicial" },
      ])
    ).toBe(50);
  });

  /**
   * «No hubo cierres» y «se perdieron todos» son cosas distintas, y un 0 % en
   * una pantalla no se distingue del desastre.
   */
  it("sin nada cerrado devuelve null y no cero", () => {
    expect(tasaDeConversion([{ etapa: "cotizada" }])).toBeNull();
    expect(tasaDeConversion([])).toBeNull();
    expect(tasaDeConversion([{ etapa: "perdida" }])).toBe(0);
  });
});
