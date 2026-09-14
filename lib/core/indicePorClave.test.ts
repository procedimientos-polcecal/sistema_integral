import { describe, it, expect } from "vitest";
import { indicePorClave, type ProveedorIndexable } from "./proveedores";

/**
 * El caso real: el 14/09/2026 el padrón de Compras amaneció con 89 filas
 * duplicadas en mayúscula y sin CUIT, y la sincronización re-apuntó 1.937
 * requerimientos a ellas porque el índice se armaba con `new Map(...)`, donde
 * gana el último. Las buenas —con CUIT y con enlace a Odoo— quedaron sin un
 * solo requerimiento.
 */
const CLAVE = (n: string) => n.toUpperCase().trim();

const buena: ProveedorIndexable = {
  id: "b",
  nombre: "Track Mar",
  cuit: "30-56304491-4",
  created_at: "2026-08-20T12:22:14Z",
};
const duplicada: ProveedorIndexable = {
  id: "d",
  nombre: "TRACK MAR",
  cuit: null,
  created_at: "2026-09-14T13:01:08Z",
};

describe("elegir entre proveedores duplicados", () => {
  it("gana la que tiene CUIT, esté donde esté en la lista", () => {
    // Lo que importa: el resultado no puede depender del orden de la consulta.
    expect(indicePorClave([buena, duplicada], CLAVE).get("TRACK MAR")).toBe("b");
    expect(indicePorClave([duplicada, buena], CLAVE).get("TRACK MAR")).toBe("b");
  });

  it("con CUIT las dos, gana la más vieja", () => {
    const nueva = { ...duplicada, cuit: "30-56304491-4" };
    expect(indicePorClave([nueva, buena], CLAVE).get("TRACK MAR")).toBe("b");
    expect(indicePorClave([buena, nueva], CLAVE).get("TRACK MAR")).toBe("b");
  });

  it("sin CUIT ninguna, gana la más vieja", () => {
    const vieja = { id: "v", nombre: "ALBERDI", cuit: null, created_at: "2026-08-20T00:00:00Z" };
    const nueva = { id: "n", nombre: "Alberdi", cuit: null, created_at: "2026-09-14T00:00:00Z" };
    expect(indicePorClave([nueva, vieja], CLAVE).get("ALBERDI")).toBe("v");
    expect(indicePorClave([vieja, nueva], CLAVE).get("ALBERDI")).toBe("v");
  });

  it("sin fecha ni CUIT sigue siendo estable, por id", () => {
    const a = { id: "a1", nombre: "X", cuit: null, created_at: null };
    const b = { id: "a2", nombre: "x", cuit: null, created_at: null };
    expect(indicePorClave([a, b], CLAVE).get("X")).toBe("a1");
    expect(indicePorClave([b, a], CLAVE).get("X")).toBe("a1");
  });

  it("una clave vacía no entra al índice", () => {
    // Un nombre que normaliza a nada no identifica a nadie; si entrara,
    // colapsaría con cualquier otro igual de vacío.
    const sinNombre = { id: "z", nombre: "   ", cuit: null, created_at: null };
    expect(indicePorClave([sinNombre], CLAVE).size).toBe(0);
  });

  it("sin duplicados se comporta como el mapa de siempre", () => {
    const i = indicePorClave(
      [buena, { id: "o", nombre: "Casa Camino", cuit: null, created_at: null }],
      CLAVE
    );
    expect(i.size).toBe(2);
    expect(i.get("CASA CAMINO")).toBe("o");
  });

  it("un CUIT en blanco no cuenta como identificada", () => {
    const enBlanco = { ...duplicada, cuit: "   " };
    expect(indicePorClave([enBlanco, buena], CLAVE).get("TRACK MAR")).toBe("b");
  });
});
