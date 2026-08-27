import { describe, it, expect } from "vitest";
// @ts-expect-error — el importador es .mjs y no tiene tipos; lo que se prueba
// acá es su lógica de decisión, que es pura.
import { decidir, nucleo, plazoDias } from "./import.mjs";

const fila = (nombre: string) => ({ nombre, cuit: "20-1-1" });
const enBase = (id: string, nombre: string) => ({ id, nombre });

/**
 * Lo que decide si una compra vieja sigue apuntando al proveedor correcto.
 *
 * Insertar un duplicado no rompe nada visible el primer dia: rompe cuando
 * alguien mira cuanto le compramos a Ancoil y le faltan las de "ANCOIL".
 */
describe("a quien le corresponde cada fila del Excel", () => {
  it("mismo nombre: actualiza, no da de alta", () => {
    const r = decidir([fila("Morini S.R.L.")], [enBase("1", "Morini S.R.L.")]);
    expect(r.actualizar).toHaveLength(1);
    expect(r.actualizar[0].id).toBe("1");
    expect(r.insertar).toHaveLength(0);
  });

  it("no le molestan mayusculas ni acentos", () => {
    const r = decidir([fila("Ferretería Victor")], [enBase("1", "FERRETERIA VICTOR")]);
    expect(r.actualizar).toHaveLength(1);
  });

  it("une el mismo nombre con y sin el sufijo societario", () => {
    // "Ancoil S.A." y "ANCOIL" son el mismo, y el que tiene las compras
    // colgando es el segundo: hay que actualizarlo, no duplicarlo.
    const r = decidir([fila("Ancoil S.A.")], [enBase("1", "ANCOIL")]);
    expect(r.actualizar).toHaveLength(1);
    expect(r.actualizar[0].renombra).toBe(true);
    expect(r.insertar).toHaveLength(0);
  });

  it("un nombre que no esta se da de alta", () => {
    const r = decidir([fila("Ferretería La Herradura")], [enBase("1", "ANCOIL")]);
    expect(r.insertar).toHaveLength(1);
    expect(r.actualizar).toHaveLength(0);
  });

  it("si se parece a alguno, no decide solo", () => {
    // "Papelera Ciuffo" probablemente sea "CIUFFO", pero "Frenos Norte" no es
    // "NORTE". Como la regla no distingue los dos casos, no elige ninguno.
    const r = decidir([fila("Papelera Ciuffo")], [enBase("1", "CIUFFO")]);
    expect(r.aRevisar).toHaveLength(1);
    expect(r.actualizar).toHaveLength(0);
    expect(r.insertar).toHaveLength(0);
  });

  it("si se parece a varios, tampoco", () => {
    // "Berner (Shell)" da con SHELL y con BERNER, que son dos proveedores
    // distintos. Adivinar seria peor que no hacer nada.
    const r = decidir([fila("Berner (Shell)")], [enBase("1", "SHELL"), enBase("2", "BERNER")]);
    expect(r.aRevisar).toHaveLength(1);
    expect(r.aRevisar[0].candidatos).toHaveLength(2);
  });

  it("nada se pierde: cada fila termina en un solo lado", () => {
    const filas = [fila("Ancoil S.A."), fila("Nuevo Proveedor"), fila("Papelera Ciuffo")];
    const r = decidir(filas, [enBase("1", "ANCOIL"), enBase("2", "CIUFFO")]);
    expect(r.actualizar.length + r.insertar.length + r.aRevisar.length).toBe(filas.length);
  });
});

describe("el nucleo del nombre", () => {
  it("saca los sufijos societarios", () => {
    expect(nucleo("Morini S.R.L.")).toBe("morini");
    expect(nucleo("Cowdin Sa")).toBe("cowdin");
    expect(nucleo("Martinez Escalada S.A")).toBe("martinez escalada");
  });

  it("no se come palabras del nombre", () => {
    expect(nucleo("Casa Blanco")).toBe("casa blanco");
  });
});

describe("el plazo de pago", () => {
  it("lee los dias", () => {
    expect(plazoDias("30")).toBe(30);
    expect(plazoDias("60 dias")).toBe(60);
  });

  it("lo que no es un numero de dias queda nulo", () => {
    expect(plazoDias("CONTADO")).toBeNull();
    expect(plazoDias(null)).toBeNull();
    expect(plazoDias("")).toBeNull();
  });
});
