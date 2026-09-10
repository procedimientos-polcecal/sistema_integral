import { describe, it, expect } from "vitest";
import {
  normalizarDescripcion, sugerirProducto, type ProductoDeOdoo,
} from "./productoOdoo";

/** Una muestra del catalogo real, con los casos que importan. */
const CATALOGO: ProductoDeOdoo[] = [
  { id: 1, nombre: "GUANTES" },
  { id: 2, nombre: "GRASAS" },
  { id: 3, nombre: "CABLES" },
  { id: 4, nombre: "FICHAS" },
  { id: 5, nombre: "LLAVE DE IMPACTO" },
  { id: 6, nombre: "LLAVES ALLEN" },
  { id: 7, nombre: "SELLADOR SILICONADO ACÉTICO" },
  { id: 8, nombre: "SELLADOR SILICONADO NEUTRO" },
  { id: 9, nombre: "TUBO DE ENCASTRE" },
  { id: 10, nombre: "BOLSAS CAL GÜEMES" },
  { id: 11, nombre: "ART. VARIOS" },
];

describe("normalizar una descripcion", () => {
  it("unifica mayusculas, acentos y plural", () => {
    // Las tres formas en que la misma cosa aparece escrita en los RI reales.
    const esperado = normalizarDescripcion("GUANTE");
    expect(normalizarDescripcion("Guantes")).toBe(esperado);
    expect(normalizarDescripcion("guantes")).toBe(esperado);
    expect(normalizarDescripcion(" Guánte ")).toBe(esperado);
  });

  it("saca la puntuacion y las palabras vacias", () => {
    expect(normalizarDescripcion('Cable tipo TPR 3 x 4 mm2 (x metro)')).toBe("CABLE TPR 3 4 MM2 METRO");
  });

  it("una descripcion vacia no rompe", () => {
    expect(normalizarDescripcion("")).toBe("");
    expect(normalizarDescripcion("   ")).toBe("");
  });
});

describe("sugerir el producto de Odoo", () => {
  const sugerir = (desc: string, aprendidos = new Map<string, number>()) =>
    sugerirProducto(desc, CATALOGO, aprendidos);

  it("la cabeza manda: 'Guantes de grasa' es GUANTES y no GRASAS", () => {
    // El prototipo que puntuaba por cobertura del nombre daba GRASAS, que es
    // exactamente el error que no se nota: la orden se lee bien y el gasto va a
    // otra cuenta contable.
    const r = sugerir("Guantes de grasa");
    expect(r.motivo).toBe("sugerido");
    expect(r.producto?.nombre).toBe("GUANTES");
  });

  it("acepta cuando el nombre del producto entra entero", () => {
    expect(sugerir("Ficha Macho 32A - 3P+N+T").producto?.nombre).toBe("FICHAS");
    expect(sugerir("Cable tipo TPR 3 x 4 mm2 (x metro)").producto?.nombre).toBe("CABLES");
    expect(sugerir("SELLADOR SILICONADO ACETICO TUBO").producto?.nombre).toBe("SELLADOR SILICONADO ACÉTICO");
  });

  it("NO acepta parciales, aunque compartan la cabeza", () => {
    // Medido sobre 300 RI: en esta franja el match esta mayormente mal. Es la
    // decision que sostiene todo el diseño.
    const r = sugerir("Llave combinada fija 13mm");
    expect(r.motivo).toBe("sin_sugerencia");
    expect(r.producto).toBeNull();
  });

  it("otro parcial de los medidos: un tubo estructural no es un TUBO DE ENCASTRE", () => {
    expect(sugerir('Tubo estructural 1"').motivo).toBe("sin_sugerencia");
  });

  it("sin cabeza que coincida no sugiere nada", () => {
    expect(sugerir("Modulo llave punto Kalop").motivo).toBe("sin_sugerencia");
    expect(sugerir("16x60").motivo).toBe("sin_sugerencia");
    expect(sugerir("").motivo).toBe("sin_sugerencia");
  });

  it("con empate gana el nombre mas corto y los otros van como alternativas", () => {
    // "SELLADOR SILICONADO" solo, sin decir cual, empata con los dos.
    const r = sugerir("SELLADOR SILICONADO");
    expect(r.motivo).toBe("sin_sugerencia");
    expect(r.alternativas.map((p) => p.nombre).sort()).toEqual([
      "SELLADOR SILICONADO ACÉTICO", "SELLADOR SILICONADO NEUTRO",
    ]);
  });

  it("lo aprendido gana sobre la regla", () => {
    const aprendidos = new Map([[normalizarDescripcion("Guantes de grasa"), 2]]);
    const r = sugerir("Guantes de grasa", aprendidos);
    expect(r.motivo).toBe("aprendido");
    expect(r.producto?.nombre).toBe("GRASAS");
  });

  it("lo aprendido que ya no esta en el catalogo se ignora en vez de romper", () => {
    // Alguien archivo el producto en Odoo. Se cae a la regla, no se propone un
    // id que la orden va a rechazar.
    const aprendidos = new Map([[normalizarDescripcion("Guantes de grasa"), 999]]);
    expect(sugerir("Guantes de grasa", aprendidos).motivo).toBe("sugerido");
  });
});
