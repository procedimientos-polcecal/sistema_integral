import { describe, it, expect } from "vitest";
import { resolverElArea, areaParaElUpsert, repartirPorArea } from "./areaDelAviso";

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

describe("areaParaElUpsert", () => {
  it("no pisa el área que ya tiene el aviso", () => {
    expect(areaParaElUpsert("a-produccion", "a-cantera")).toBeUndefined();
    expect(areaParaElUpsert("a-produccion", null)).toBeUndefined();
  });

  it("completa la que falta, y si no la resuelve no manda la columna", () => {
    expect(areaParaElUpsert(null, "a-cantera")).toBe("a-cantera");
    expect(areaParaElUpsert(null, null)).toBeUndefined();
  });

  it("un aviso que la base no conoce todavía cuenta como sin área", () => {
    expect(areaParaElUpsert(undefined, "a-cantera")).toBe("a-cantera");
    expect(areaParaElUpsert(undefined, null)).toBeUndefined();
  });
});

describe("repartirPorArea", () => {
  const area = resolverElArea(USUARIOS);

  it("separa en dos lotes: el que lleva la columna y el que no la tiene ni como null", () => {
    const { conArea, sinArea } = repartirPorArea(
      [
        { oa_number: "1", quien_aviso: "Luna Fourcade" }, // sin área guardada, se resuelve
        { oa_number: "2", quien_aviso: "Luna Fourcade" }, // ya tiene otra: no se toca
        { oa_number: "3", quien_aviso: "Juan Perez" }, // no se reconoce
        { oa_number: "4", quien_aviso: "Mayra Benitez" }, // dos áreas
      ],
      new Map([["2", "a-produccion"]]),
      area
    );

    expect(conArea).toEqual([{ oa_number: "1", quien_aviso: "Luna Fourcade", area_id: "a-cantera" }]);
    expect(sinArea.map((r) => r.oa_number)).toEqual(["2", "3", "4"]);
    // `Object.keys` y no `toEqual`: un `area_id: undefined` también se ve igual
    // para `toEqual`, y para supabase-js la clave presente ya arma la columna.
    for (const r of sinArea) expect(Object.keys(r)).not.toContain("area_id");
  });

  it("no muta las filas que recibe", () => {
    const fila = { oa_number: "1", quien_aviso: "Luna Fourcade" };
    repartirPorArea([fila], new Map(), area);
    expect(Object.keys(fila)).not.toContain("area_id");
  });
});
