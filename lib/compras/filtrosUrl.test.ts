import { describe, it, expect } from "vitest";
import { leerFiltrosDeLaUrl, hayAlgunFiltro, FILTROS_VACIOS } from "./filtrosUrl";

const catalogos = {
  areas: ["area-mant", "area-seg"],
  empresas: ["emp-polcecal", "emp-polysan"],
  proveedores: ["prov-1"],
  ubicaciones: ["ubi-1"],
};

const leer = (qs: string) => leerFiltrosDeLaUrl(new URLSearchParams(qs), catalogos);

/**
 * El listado arranca filtrado por lo que diga la URL, que es como el tablero
 * lleva a cada etapa. Un filtro invalido que quedara puesto seria invisible
 * —el desplegable no tiene esa opcion— y dejaria la tabla vacia sin que se
 * pueda quitar: se descarta.
 */
describe("filtros leidos de la URL", () => {
  it("sin query string no queda ningun filtro puesto", () => {
    expect(leer("")).toEqual(FILTROS_VACIOS);
    expect(hayAlgunFiltro(leer(""))).toBe(false);
  });

  it("lee el estado de compra, que es como llega desde el tablero", () => {
    expect(leer("estado_compra=PEDIDO").compra).toBe("PEDIDO");
    expect(hayAlgunFiltro(leer("estado_compra=PEDIDO"))).toBe(true);
  });

  it("descarta un estado que no existe", () => {
    expect(leer("estado_compra=EN_CAMINO").compra).toBe("");
  });

  it("descarta un area que no esta en la lista", () => {
    expect(leer("area=area-mant").area).toBe("area-mant");
    expect(leer("area=area-borrada").area).toBe("");
  });

  it("acepta AMBAS como empresa: no es un id sino una condicion", () => {
    expect(leer("empresa=AMBAS").empresa).toBe("AMBAS");
    expect(leer("empresa=emp-polysan").empresa).toBe("emp-polysan");
    expect(leer("empresa=emp-inventada").empresa).toBe("");
  });

  it("la busqueda llega limpia de espacios", () => {
    expect(leer("q=%20%20rodamiento%20%20").busqueda).toBe("rodamiento");
  });

  it("lee varios filtros a la vez", () => {
    const f = leer("estado_compra=APROBADO&prioridad=URGENTE&area=area-seg");
    expect(f.compra).toBe("APROBADO");
    expect(f.prioridad).toBe("URGENTE");
    expect(f.area).toBe("area-seg");
    expect(f.proveedor).toBe("");
  });
});
