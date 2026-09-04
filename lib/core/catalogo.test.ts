import { describe, it, expect } from "vitest";
import { claveDeNombre, indiceDeCatalogo, elQueNombra } from "./catalogo";

/**
 * Las planillas nombran los catálogos del núcleo en texto libre. La regla de
 * cuándo dos nombres son el mismo tiene que ser una sola: si la importación de
 * RRHH acepta una cosa y la pantalla de administración otra, se crea un
 * duplicado que ninguna de las dos ve.
 */
describe("cuando dos nombres son el mismo", () => {
  it("no distingue tildes ni mayusculas ni espacios de mas", () => {
    expect(claveDeNombre("Hidratación")).toBe(claveDeNombre("hidratacion"));
    expect(claveDeNombre("  Compras   y  Pañol ")).toBe(claveDeNombre("compras y panol"));
    expect(claveDeNombre("POLYSAN")).toBe(claveDeNombre("polysan"));
  });

  it("un nombre vacio no es clave de nada", () => {
    expect(claveDeNombre("   ")).toBe("");
    expect(claveDeNombre(null as unknown as string)).toBe("");
  });
});

describe("reconocer lo que nombra una planilla", () => {
  const sectores = indiceDeCatalogo([
    { id: "s1", nombre: "Tesorería" },
    { id: "s2", nombre: "Compras y Pañol" },
  ]);

  it("lo encuentra aunque la planilla escriba sin tildes", () => {
    expect(elQueNombra(sectores, "tesoreria")).toEqual({ id: "s1" });
    expect(elQueNombra(sectores, "  COMPRAS Y PAñOL ")).toEqual({ id: "s2" });
  });

  it("uno que no esta queda vacio y dice por que", () => {
    expect(elQueNombra(sectores, "Pañol")).toEqual({ id: null, motivo: "no existe" });
    expect(elQueNombra(sectores, "")).toEqual({ id: null, motivo: "no existe" });
  });

  // `indicePorNombre` de Inventario se queda con el primero y no avisa. Acá no:
  // elegir uno de dos es enlazar al que se le parece.
  it("un nombre repetido no resuelve a ninguno", () => {
    const conEmpate = indiceDeCatalogo([
      { id: "a", nombre: "Producción" },
      { id: "b", nombre: "produccion" },
    ]);
    expect(elQueNombra(conEmpate, "Producción")).toEqual({ id: null, motivo: "ambiguo" });
  });

  it("una fila sin nombre no ensucia el indice", () => {
    expect(indiceDeCatalogo([{ id: "x", nombre: "   " }]).size).toBe(0);
  });
});

/**
 * La misma regla para las empresas. Ahí el daño es mayor: la empresa es
 * obligatoria para dar de alta a un empleado, así que una que se creaba sola
 * por un typo se llevaba al empleado adentro.
 */
describe("las empresas usan la misma regla", () => {
  const empresas = indiceDeCatalogo([
    { id: "e1", nombre: "POLCECAL" },
    { id: "e2", nombre: "POLYSAN" },
  ]);

  it("reconoce como la escriba el Excel", () => {
    expect(elQueNombra(empresas, "polcecal")).toEqual({ id: "e1" });
    expect(elQueNombra(empresas, " Polysan ")).toEqual({ id: "e2" });
  });

  it("un typo no resuelve a la que se le parece", () => {
    expect(elQueNombra(empresas, "POLISAN")).toEqual({ id: null, motivo: "no existe" });
  });
});
