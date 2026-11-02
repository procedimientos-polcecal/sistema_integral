import { describe, expect, it } from "vitest";
import { costoParaElCampo, horasParaElCampo, leerNumeroDelCampo } from "./cuadernoNumero";

const num = (t: string, dinero: boolean) => {
  const r = leerNumeroDelCampo(t, dinero);
  return r.tipo === "numero" ? r.valor : r.tipo;
};

describe("leerNumeroDelCampo — precio", () => {
  it("el punto de miles no se lee como decimal: 920.000 son novecientos veinte mil", () => {
    expect(num("920.000", true)).toBe(920000);
    expect(num("$ 1.234.567,50", true)).toBe(1234567.5);
  });
  it("lee los formatos sin miles", () => {
    expect(num("920000", true)).toBe(920000);
    expect(num("1500,5", true)).toBe(1500.5);
    expect(num("1234.50", true)).toBe(1234.5);
  });
  it("lo que no se puede leer con certeza se rechaza y dice por qué", () => {
    const r = leerNumeroDelCampo("9.20.00", true);
    expect(r).toMatchObject({ tipo: "invalido" });
    expect(num("-5", true)).toBe("invalido");
    expect(num("mucho", true)).toBe("invalido");
  });
  it("vacío es vacío", () => {
    expect(num("  ", true)).toBe("vacio");
  });
});

describe("leerNumeroDelCampo — horas", () => {
  it("acepta coma y punto decimales", () => {
    expect(num("2,5", false)).toBe(2.5);
    expect(num("2.5", false)).toBe(2.5);
    expect(num("16", false)).toBe(16);
  });
  it("rechaza lo que no es un número", () => {
    expect(num("8 hs", false)).toBe("invalido");
    expect(num("-1", false)).toBe("invalido");
  });
});

describe("cómo se muestra", () => {
  it("las horas con coma y el precio con puntos", () => {
    expect(horasParaElCampo(2.5)).toBe("2,5");
    expect(horasParaElCampo(null)).toBe("");
    expect(costoParaElCampo(920000)).toBe("920.000");
    expect(costoParaElCampo(null)).toBe("");
  });
  it("lo que se muestra se vuelve a leer igual", () => {
    expect(num(costoParaElCampo(1234567.5), true)).toBe(1234567.5);
    expect(num(horasParaElCampo(7.25), false)).toBe(7.25);
  });
});
