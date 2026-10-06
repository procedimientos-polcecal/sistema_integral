import { describe, expect, it } from "vitest";
import { mallasDesdeTexto, normalizarMallas } from "./mallas";

describe("normalizarMallas", () => {
  it("ordena por malla creciente, que es abertura decreciente", () => {
    expect(normalizarMallas([200, 50, 325, 100]).mallas).toEqual([50, 100, 200, 325]);
  });

  it("saca las repetidas", () => {
    expect(normalizarMallas([50, 50, 100]).mallas).toEqual([50, 100]);
  });

  it("acepta números escritos como texto, que es como llegan de un formulario", () => {
    expect(normalizarMallas(["50", "100"]).mallas).toEqual([50, 100]);
  });

  it("una lista vacía es un producto sin juego habitual, no un error", () => {
    expect(normalizarMallas([])).toEqual({ mallas: [] });
  });

  it("rechaza lo que no es una malla, y dice cuál", () => {
    expect(normalizarMallas([50, "cien"]).problema).toContain("cien");
    expect(normalizarMallas([50, 0]).problema).toContain("0");
    expect(normalizarMallas([50, -1]).problema).toContain("-1");
    expect(normalizarMallas([50, 12.5]).problema).toContain("12.5");
  });

  it("lo que no es una lista no tiene mallas", () => {
    expect(normalizarMallas(null)).toEqual({ mallas: [] });
    expect(normalizarMallas("50,100")).toEqual({ mallas: [] });
  });
});

describe("mallasDesdeTexto", () => {
  it("acepta coma, punto y coma o espacios", () => {
    expect(mallasDesdeTexto("50, 100, 200").mallas).toEqual([50, 100, 200]);
    expect(mallasDesdeTexto("50;100;200").mallas).toEqual([50, 100, 200]);
    expect(mallasDesdeTexto("50 100 200").mallas).toEqual([50, 100, 200]);
  });

  it("un campo vacío es un producto sin juego habitual", () => {
    expect(mallasDesdeTexto("   ")).toEqual({ mallas: [] });
  });

  it("una coma de más no rompe nada", () => {
    expect(mallasDesdeTexto("50, 100,").mallas).toEqual([50, 100]);
  });
});
