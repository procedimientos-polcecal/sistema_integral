import { describe, it, expect } from "vitest";
import {
  leerFiltrosDeMovimientos, escribirFiltrosDeMovimientos, hayFiltrosDeMovimientos,
  leerFiltrosDeStock, escribirFiltrosDeStock,
  leerFiltrosDeArticulos, escribirFiltrosDeArticulos,
  leerFiltrosDeLista, escribirFiltrosDeLista,
  MOVIMIENTOS_SIN_FILTROS, STOCK_SIN_FILTROS,
} from "./filtrosUrl";
import { paginaDeArranque } from "@/lib/core/filtrosUrl";

const SECTORES = ["sec-mant", "sec-prod"];

const leerMov = (query: string) =>
  leerFiltrosDeMovimientos(new URLSearchParams(query), SECTORES);

/**
 * El kardex arranca con lo que diga la URL, y la URL sigue a lo que se toca.
 * Es lo que hace que acotar los movimientos, entrar a cargar uno y volver no
 * devuelva los 3.400 sin filtrar.
 */
describe("los filtros del kardex", () => {
  it("sin query string no queda ningun filtro puesto", () => {
    expect(leerMov("")).toEqual(MOVIMIENTOS_SIN_FILTROS);
    expect(hayFiltrosDeMovimientos(leerMov(""))).toBe(false);
  });

  it("lee los tres desplegables y el buscador", () => {
    const f = leerMov("q=ROD&tipo=salida&origen=planilla&sector=sec-mant");
    expect(f).toMatchObject({
      busqueda: "ROD", tipo: "salida", origen: "planilla", sector: "sec-mant",
    });
    expect(hayFiltrosDeMovimientos(f)).toBe(true);
  });

  // Uno que el desplegable no ofrece no se puede quitar desde la pantalla, y
  // deja la tabla vacia como si no hubiera movimientos.
  it("un valor que no esta en la lista se descarta", () => {
    expect(leerMov("tipo=devolucion").tipo).toBe("");
    expect(leerMov("origen=odoo").origen).toBe("");
    expect(leerMov("sector=sec-inventado").sector).toBe("");
  });

  it("una fecha imposible se descarta en vez de correrse", () => {
    expect(leerMov("desde=2026-02-31").desde).toBe("");
    expect(leerMov("hasta=ayer").hasta).toBe("");
    expect(leerMov("desde=2026-09-01&hasta=2026-09-30")).toMatchObject({
      desde: "2026-09-01", hasta: "2026-09-30",
    });
  });

  it("lo que se escribe se vuelve a leer igual", () => {
    const puestos = {
      busqueda: "ROD-12", tipo: "entrada", origen: "app",
      sector: "sec-prod", desde: "2026-09-01", hasta: "2026-09-30",
    };
    expect(leerMov(escribirFiltrosDeMovimientos(puestos))).toEqual(puestos);
  });

  it("el orden no depende de en que orden se tocaron los filtros", () => {
    const a = escribirFiltrosDeMovimientos({ ...MOVIMIENTOS_SIN_FILTROS, tipo: "salida", origen: "app" });
    const b = escribirFiltrosDeMovimientos({ ...MOVIMIENTOS_SIN_FILTROS, origen: "app", tipo: "salida" });
    expect(a).toBe(b);
  });
});

/**
 * La pagina se cuenta desde uno en la URL —como los botones— y desde cero
 * adentro, que es como se calcula el `range()`.
 */
describe("la pagina del kardex", () => {
  it("la primera no ensucia la URL", () => {
    expect(escribirFiltrosDeMovimientos(MOVIMIENTOS_SIN_FILTROS, 1)).toBe("");
    expect(escribirFiltrosDeMovimientos({ ...MOVIMIENTOS_SIN_FILTROS, tipo: "salida" }, 1))
      .toBe("tipo=salida");
  });

  it("va al final, despues de los filtros", () => {
    expect(escribirFiltrosDeMovimientos({ ...MOVIMIENTOS_SIN_FILTROS, tipo: "salida" }, 3))
      .toBe("tipo=salida&pagina=3");
  });

  it("filtros y pagina vuelven juntos", () => {
    const puestos = { ...MOVIMIENTOS_SIN_FILTROS, tipo: "ajuste", sector: "sec-mant" };
    const query = escribirFiltrosDeMovimientos(puestos, 4);
    expect(leerMov(query)).toEqual(puestos);
    // La cuarta de la URL es la tercera del `range()`.
    expect(paginaDeArranque(new URLSearchParams(query))).toBe(3);
  });
});

/**
 * `soloFaltantes` es el primer filtro de si o no del sistema. Va como `=1` y
 * solo cuando esta puesto: `=0` seria una segunda forma de escribir "sin
 * filtrar" y dos URL distintas para la misma pantalla.
 */
describe("los filtros del stock", () => {
  it("sin query string no queda nada puesto", () => {
    expect(leerFiltrosDeStock(new URLSearchParams(""))).toEqual(STOCK_SIN_FILTROS);
  });

  it("el si o no no viaja cuando esta en no", () => {
    expect(escribirFiltrosDeStock({ busqueda: "", soloFaltantes: false })).toBe("");
    expect(escribirFiltrosDeStock({ busqueda: "rod", soloFaltantes: false })).toBe("q=rod");
  });

  it("puesto viaja como =1", () => {
    expect(escribirFiltrosDeStock({ busqueda: "", soloFaltantes: true })).toBe("faltantes=1");
    expect(escribirFiltrosDeStock({ busqueda: "rod", soloFaltantes: true }))
      .toBe("q=rod&faltantes=1");
  });

  it("lo que se escribe se vuelve a leer igual", () => {
    const puestos = { busqueda: "rodamiento", soloFaltantes: true };
    expect(leerFiltrosDeStock(new URLSearchParams(escribirFiltrosDeStock(puestos))))
      .toEqual(puestos);
  });

  // Los nombres son los que la pantalla ya le mandaba a la API: lo que se ve en
  // la barra de direcciones es lo mismo que viaja en la consulta.
  it("usa los nombres que ya usaba la API", () => {
    expect(escribirFiltrosDeStock({ busqueda: "x", soloFaltantes: true }))
      .toBe("q=x&faltantes=1");
  });
});

describe("el buscador del catalogo", () => {
  it("va y vuelve, y los espacios de sobra no cuentan", () => {
    expect(escribirFiltrosDeArticulos({ busqueda: "  rod  " })).toBe("q=rod");
    expect(leerFiltrosDeArticulos(new URLSearchParams("q=rod")).busqueda).toBe("rod");
    expect(escribirFiltrosDeArticulos({ busqueda: "" })).toBe("");
  });
});

describe("la lista del panol", () => {
  it("ver los dados de baja va y vuelve", () => {
    expect(escribirFiltrosDeLista({ verInactivos: false })).toBe("");
    expect(escribirFiltrosDeLista({ verInactivos: true })).toBe("inactivos=1");
    expect(leerFiltrosDeLista(new URLSearchParams("inactivos=1")).verInactivos).toBe(true);
    expect(leerFiltrosDeLista(new URLSearchParams("")).verInactivos).toBe(false);
  });
});
