import { describe, it, expect } from "vitest";
import { claveDeProveedor, indiceDeProveedores, buscarProveedor, nombresParecidos } from "./proveedores";

describe("claveDeProveedor", () => {
  it("une las escrituras del mismo nombre", () => {
    // Los tres casos salieron de las planillas: 18 proveedores se escriben de
    // más de una forma y sólo cambian mayúsculas, acentos o puntos.
    expect(claveDeProveedor("Candia")).toBe(claveDeProveedor("CANDIA"));
    expect(claveDeProveedor("NELO Electrónica")).toBe(claveDeProveedor("NELO electronica"));
    expect(claveDeProveedor("Metalurgica Tigri Hnos.")).toBe(claveDeProveedor("Metalurgica Tigri Hnos"));
  });

  it("colapsa los espacios de más", () => {
    expect(claveDeProveedor("  Met   Villa   Arrieta ")).toBe(claveDeProveedor("Met Villa Arrieta"));
  });

  it("no une dos proveedores distintos", () => {
    expect(claveDeProveedor("Ing Mazzeo")).not.toBe(claveDeProveedor("Massey Ingenieria"));
    expect(claveDeProveedor("Sebastian Beltramella")).not.toBe(claveDeProveedor("Beltramella Gustavo Juan"));
  });

  it("es vacío cuando no hay nombre", () => {
    expect(claveDeProveedor("")).toBe("");
    expect(claveDeProveedor(null)).toBe("");
    expect(claveDeProveedor("  -  ")).toBe("");
  });
});

describe("buscarProveedor", () => {
  const indice = indiceDeProveedores([
    { id: "1", nombre: "CANDIA" },
    { id: "2", nombre: "ALERTA" },
    { id: "3", nombre: "Met. Villa Arrieta" },
  ]);

  it("encuentra al proveedor aunque esté escrito distinto", () => {
    expect(buscarProveedor(indice, "Candia")).toBe("1");
    expect(buscarProveedor(indice, "alerta")).toBe("2");
    expect(buscarProveedor(indice, "Met Villa Arrieta")).toBe("3");
  });

  it("devuelve null cuando no está", () => {
    expect(buscarProveedor(indice, "Don Alfredo")).toBeNull();
    expect(buscarProveedor(indice, "")).toBeNull();
    expect(buscarProveedor(indice, "-")).toBeNull();
  });
});

describe("nombresParecidos", () => {
  it("junta los que uno contiene al otro", () => {
    // "Cortadi" y "Domingo Cortadi" son la misma persona escrita corta y
    // larga: la normalización no los une y hay que fusionarlos a mano.
    const grupos = nombresParecidos(["Domingo Cortadi", "Cortadi", "Ruben Fiorio"]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].sort()).toEqual(["Cortadi", "Domingo Cortadi"]);
  });

  it("junta más de dos", () => {
    const grupos = nombresParecidos([
      "Don Alfredo", "Met. Don Alfredo", "Metalúrgica Don Alfredo", "Neuma",
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]).toHaveLength(3);
  });

  it("no junta a los que sólo comparten el rubro", () => {
    // "Metalurgica Fonavi" y "Metalúrgica Mario" comparten el oficio, no el
    // proveedor. Y "CN Mecanizados" con "Gundel mecanizados", lo mismo.
    expect(nombresParecidos(["Metalurgica Fonavi", "Metalúrgica Mario"])).toHaveLength(0);
    expect(nombresParecidos(["CN Mecanizados", "Gundel mecanizados"])).toHaveLength(0);
  });

  it("junta el mismo nombre pegado y separado", () => {
    // Los dos están en las órdenes: "ConMet" y "Con-Met".
    expect(nombresParecidos(["ConMet", "Con-Met"])).toHaveLength(1);
  });

  it("no devuelve grupos de uno", () => {
    expect(nombresParecidos(["Candia", "Neuma", "ConMet"])).toHaveLength(0);
  });

  it("ignora las palabras demasiado cortas para decir algo", () => {
    expect(nombresParecidos(["SA", "SA Metalúrgica"])).toHaveLength(0);
  });
});
