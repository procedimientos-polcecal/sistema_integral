import { describe, it, expect } from "vitest";
import { resolverElArea } from "./areaDelAviso";

const USUARIOS = [
  { id: "u-martin", nombre: "Martin", apellido: "Sandoval", areas: ["a-produccion"] },
  { id: "u-luna", nombre: "Luna", apellido: "Fourcade", areas: ["a-cantera"] },
  { id: "u-mayra", nombre: "Mayra", apellido: "Benitez", areas: ["a-lab", "a-produccion"] },
];

describe("resolverElArea", () => {
  it("reconoce las cuatro formas en que la planilla escribe el mismo nombre", () => {
    const area = resolverElArea(USUARIOS);
    expect(area("MARTIN SANDOVAL")).toBe("a-produccion");
    expect(area("MARTIN  SANDOVAL")).toBe("a-produccion"); // dos espacios: 15 avisos
    expect(area("Martin Sandoval")).toBe("a-produccion");
    expect(area("Martín  Sandoval")).toBe("a-produccion"); // acento y dos espacios
    expect(area("Luna  Fourcade")).toBe("a-cantera");
  });

  it("con dos áreas no elige ninguna", () => {
    expect(resolverElArea(USUARIOS)("Mayra Benitez")).toBeNull();
  });

  it("sin nombre, o con un nombre que no es de nadie, queda en null", () => {
    const area = resolverElArea(USUARIOS);
    expect(area("")).toBeNull();
    expect(area(null)).toBeNull();
    expect(area("Juan Perez")).toBeNull();
  });

  it("dos usuarios que normalizan igual quedan los dos en null", () => {
    const area = resolverElArea([
      { id: "u-1", nombre: "Ana", apellido: "Núñez", areas: ["a-uno"] },
      { id: "u-2", nombre: "Ana", apellido: "Nunez", areas: ["a-dos"] },
    ]);
    expect(area("Ana Núñez")).toBeNull();
    expect(area("Ana Nunez")).toBeNull();
  });
});
