import { describe, expect, it } from "vitest";
import { resolverOperarioPorNombreCompleto, type EmpleadoLiviano } from "./operarios";

// Los mismos 6 operarios reales del dropdown del form, más los otros dos
// Becker que existen en la base (relevado el 22/09/2026) para probar la
// ambigüedad real.
const EMPLEADOS: EmpleadoLiviano[] = [
  { id: "taibo", nombre: "RUBEN DARIO", apellido: "TAIBO" },
  { id: "becker-marcelo", nombre: "MARCELO BALTAZAR", apellido: "BECKER" },
  { id: "beltramella", nombre: "HECTOR FABIÁN", apellido: "BELTRAMELLA" },
  { id: "becker-jorge", nombre: "JORGE ENRIQUE", apellido: "BECKER" },
  { id: "farias", nombre: "ALBERTO MARTIN", apellido: "FARIAS" },
  { id: "rodriguez", nombre: "ENZO MARTIN", apellido: "RODRIGUEZ" },
  { id: "andrada", nombre: "JUAN JOSE", apellido: "ANDRADA" },
  { id: "becker-miqueas", nombre: "MIQUEAS ANDRES", apellido: "BECKER" },
];

describe("resolverOperarioPorNombreCompleto", () => {
  it("matchea directo cuando el apellido no es ambiguo", () => {
    expect(resolverOperarioPorNombreCompleto("Juan Andrada", EMPLEADOS)).toBe("andrada");
    expect(resolverOperarioPorNombreCompleto("Martin Farias", EMPLEADOS)).toBe("farias");
    expect(resolverOperarioPorNombreCompleto("Enzo Rodriguez", EMPLEADOS)).toBe("rodriguez");
  });

  it("con apellido ambiguo (tres Becker), desambigua por el nombre de pila", () => {
    expect(resolverOperarioPorNombreCompleto("Jorge Becker", EMPLEADOS)).toBe("becker-jorge");
    expect(resolverOperarioPorNombreCompleto("Marcelo Becker", EMPLEADOS)).toBe("becker-marcelo");
  });

  it("apellido ambiguo y el nombre de pila no desambigua a uno solo: null, no se adivina", () => {
    expect(resolverOperarioPorNombreCompleto("Pedro Becker", EMPLEADOS)).toBeNull();
    expect(resolverOperarioPorNombreCompleto("Becker", EMPLEADOS)).toBeNull();
  });

  it("sin ningún apellido que matchee, null", () => {
    expect(resolverOperarioPorNombreCompleto("Alguien Desconocido", EMPLEADOS)).toBeNull();
  });

  it("ignora acentos y mayúsculas/minúsculas", () => {
    expect(resolverOperarioPorNombreCompleto("fabian beltramella", EMPLEADOS)).toBe("beltramella");
  });

  it("texto vacío da null", () => {
    expect(resolverOperarioPorNombreCompleto("", EMPLEADOS)).toBeNull();
    expect(resolverOperarioPorNombreCompleto("   ", EMPLEADOS)).toBeNull();
  });
});
