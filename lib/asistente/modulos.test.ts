import { describe, it, expect } from "vitest";
import { MODULO_DE_TABLA, moduloDe, tablasVisibles } from "./modulos";

describe("de qué módulo es cada tabla", () => {
  it("ubica una tabla de un módulo", () => {
    expect(moduloDe("liquidaciones")).toBe("rrhh");
    expect(moduloDe("compras_requerimientos")).toBe("compras");
    expect(moduloDe("calidad_conteos")).toBe("calidad");
  });

  it("marca como del núcleo lo que comparten todos", () => {
    expect(moduloDe("empresas")).toBe("nucleo");
    expect(moduloDe("productos")).toBe("nucleo");
    expect(moduloDe("empleados")).toBe("nucleo");
  });

  /**
   * Cierra por defecto. Es la diferencia entre que una tabla nueva quede
   * invisible —molesto, y alguien avisa— y que quede expuesta —silencioso, y
   * nadie avisa.
   */
  it("una tabla que nadie mapeó no es de nadie", () => {
    expect(moduloDe("tabla_que_no_existe_todavia")).toBeNull();
  });

  /**
   * El asistente no consulta su propia bitácora, a propósito: evita el bucle
   * bobo de que alguien le pregunte qué preguntaron los demás.
   */
  it("la bitácora del asistente queda afuera", () => {
    expect(moduloDe("asistente_consultas")).toBeNull();
  });
});

describe("qué tablas ve cada usuario", () => {
  it("le da las suyas más las del núcleo", () => {
    const visibles = tablasVisibles(["rrhh"]);
    expect(visibles).toContain("liquidaciones");
    expect(visibles).toContain("empresas");
    expect(visibles).not.toContain("despacho_ordenes_carga");
  });

  it("sin ningún módulo, igual ve el núcleo", () => {
    const visibles = tablasVisibles([]);
    expect(visibles).toContain("empresas");
    expect(visibles).not.toContain("liquidaciones");
  });

  it("no incluye nunca una tabla sin mapear", () => {
    const visibles = tablasVisibles(["rrhh", "compras", "mantenimiento"]);
    for (const t of visibles) expect(MODULO_DE_TABLA[t]).toBeDefined();
  });

  it("devuelve la lista ordenada, para que el prompt sea estable", () => {
    const visibles = tablasVisibles(["compras"]);
    expect([...visibles].sort()).toEqual(visibles);
  });

  it("acepta un mapa de juguete, para poder testear sin los datos reales", () => {
    const mapa = { a: "nucleo", b: "rrhh" } as Record<string, "nucleo" | "rrhh">;
    expect(tablasVisibles([], mapa)).toEqual(["a"]);
    expect(tablasVisibles(["rrhh"], mapa)).toEqual(["a", "b"]);
  });
});
