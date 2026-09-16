import { describe, it, expect } from "vitest";
import { armarCatalogo, catalogoPara, type EsquemaCrudo } from "./catalogo";
import type { Ambito } from "./modulos";

const ESQUEMA: EsquemaCrudo = {
  tablas: {
    empleados: [
      { columna: "id", tipo: "uuid", nuleable: false },
      { columna: "nombre", tipo: "text", nuleable: false },
      { columna: "activo", tipo: "bool", nuleable: false },
    ],
    liquidaciones: [
      { columna: "id", tipo: "uuid", nuleable: false },
      { columna: "periodo", tipo: "text", nuleable: false },
    ],
    equipos: [
      { columna: "id", tipo: "uuid", nuleable: false },
      { columna: "name", tipo: "text", nuleable: false },
      { columna: "status", tipo: "equipo_status", nuleable: true },
    ],
    tabla_huerfana: [{ columna: "id", tipo: "uuid", nuleable: false }],
  },
  enums: {
    equipo_status: ["OPERATIVO", "PARADO"],
    user_role: ["admin_sistema", "encargado", "operario"],
  },
};

const MAPA: Record<string, Ambito> = {
  empleados: "nucleo",
  liquidaciones: "rrhh",
  equipos: "mantenimiento",
};

describe("el catálogo que ve cada usuario", () => {
  it("incluye sus módulos y el núcleo", () => {
    const texto = armarCatalogo(ESQUEMA, MAPA, {}, ["mantenimiento"]);
    expect(texto).toContain("equipos");
    expect(texto).toContain("empleados");
  });

  /**
   * Lo importante no es que no pueda leerla —de eso se ocupa RLS— sino que ni
   * siquiera sepa que existe: un modelo que no ve el nombre no escribe la
   * consulta, y no se gasta un intento en que la base devuelva vacío.
   */
  it("no nombra las tablas de un módulo que el usuario no tiene", () => {
    const texto = armarCatalogo(ESQUEMA, MAPA, {}, ["mantenimiento"]);
    expect(texto).not.toContain("liquidaciones");
  });

  it("no nombra una tabla sin mapear, para nadie", () => {
    const texto = armarCatalogo(ESQUEMA, MAPA, {}, ["rrhh", "mantenimiento"]);
    expect(texto).not.toContain("tabla_huerfana");
  });

  it("muestra el tipo de cada columna", () => {
    const texto = armarCatalogo(ESQUEMA, MAPA, {}, ["mantenimiento"]);
    expect(texto).toContain("name text");
  });

  it("marca las columnas que admiten null", () => {
    const texto = armarCatalogo(ESQUEMA, MAPA, {}, ["mantenimiento"]);
    expect(texto).toMatch(/status equipo_status null/);
  });

  it("pega la nota escrita a mano debajo de la tabla", () => {
    const notas = { equipos: "Viene del sistema en inglés: name, no nombre." };
    const texto = armarCatalogo(ESQUEMA, MAPA, notas, ["mantenimiento"]);
    expect(texto).toContain("Viene del sistema en inglés");
  });

  it("no pega la nota de una tabla que no se muestra", () => {
    const notas = { liquidaciones: "Sólo admin de RRHH." };
    const texto = armarCatalogo(ESQUEMA, MAPA, notas, ["mantenimiento"]);
    expect(texto).not.toContain("Sólo admin de RRHH");
  });

  /**
   * Los enums que ninguna columna visible usa son ruido: ocupan prompt y no
   * ayudan a escribir ninguna consulta que este usuario pueda hacer.
   */
  it("incluye sólo los enums que usan las columnas visibles", () => {
    const texto = armarCatalogo(ESQUEMA, MAPA, {}, ["mantenimiento"]);
    expect(texto).toContain("OPERATIVO");
    expect(texto).not.toContain("admin_sistema");
  });

  it("sin módulos, sigue habiendo núcleo", () => {
    const texto = armarCatalogo(ESQUEMA, MAPA, {}, []);
    expect(texto).toContain("empleados");
    expect(texto).not.toContain("equipos");
  });
});

describe("el catálogo real", () => {
  it("un usuario de compras no ve liquidaciones y sí sus requerimientos", () => {
    const texto = catalogoPara(["compras"]);
    expect(texto).toContain("compras_requerimientos");
    expect(texto).not.toContain("liquidaciones");
  });

  it("trae los estados de compras, que si no el modelo los inventa", () => {
    const texto = catalogoPara(["compras"]);
    expect(texto).toContain("EN_COMPARATIVA");
  });

  /**
   * El catálogo es el costo de cada pregunta. Si un módulo solo se va por
   * arriba de esto, es señal de que hay que recortar, no de subir el número.
   */
  it("el de un módulo solo entra holgado en un prompt", () => {
    for (const m of ["compras", "rrhh", "mantenimiento"] as const) {
      expect(catalogoPara([m]).length).toBeLessThan(40_000);
    }
  });
});
