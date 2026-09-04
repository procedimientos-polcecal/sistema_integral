import { describe, it, expect } from "vitest";
import {
  leerFiltrosDeLaUrl, escribirFiltrosEnLaUrl, hayAlgunFiltro, consultaDeLaRuta,
  FILTROS_VACIOS, type FiltrosOt,
} from "./filtrosOt";

const catalogos = {
  sectores: ["s-filler1", "s-filler2"],
  equipos: ["e-1", "e-2"],
  proveedores: ["p-piparo", "p-candia"],
};

const leer = (query: string) =>
  leerFiltrosDeLaUrl(new URLSearchParams(query), catalogos);

describe("leer los filtros de la URL", () => {
  it("sin nada en la URL no filtra nada", () => {
    expect(leer("")).toEqual(FILTROS_VACIOS);
  });

  /** Es como el tablero manda a "las atrasadas": el enlace ya existia. */
  it("un solo valor sigue funcionando", () => {
    expect(leer("estado=ATRASADO").estado).toEqual(["ATRASADO"]);
  });

  /**
   * El caso que motiva todo esto: "que hay abierto" son tres estados, y con
   * uno por vez son tres pasadas.
   */
  it("acepta varios separados por coma", () => {
    expect(leer("estado=ATRASADO,EN_PROCESO,POR_HACER").estado)
      .toEqual(["ATRASADO", "EN_PROCESO", "POR_HACER"]);
  });

  it("acepta el mismo parametro repetido, que es lo que arma un formulario", () => {
    expect(leer("especialidad=MECÁNICO&especialidad=ELÉCTRICO").especialidad)
      .toEqual(["MECÁNICO", "ELÉCTRICO"]);
  });

  it("no duplica un valor que vino dos veces", () => {
    expect(leer("tipo=CORRECTIVO,CORRECTIVO&tipo=CORRECTIVO").tipo).toEqual(["CORRECTIVO"]);
  });

  /**
   * Un filtro que la persona no ve y no puede sacar deja una tabla vacia que
   * se lee como "no hay nada".
   */
  it("descarta lo que no esta en la lista", () => {
    expect(leer("estado=INVENTADO").estado).toEqual([]);
    expect(leer("especialidad=PLOMERIA").especialidad).toEqual([]);
    expect(leer("sector=s-inexistente").sector).toEqual([]);
    expect(leer("estado=ATRASADO,INVENTADO").estado).toEqual(["ATRASADO"]);
  });

  it("valida los catalogos contra lo que le pasan", () => {
    expect(leer("sector=s-filler1&equipo=e-2&proveedor=p-candia")).toMatchObject({
      sector: ["s-filler1"], equipo: ["e-2"], proveedor: ["p-candia"],
    });
  });

  /** La prioridad viene con el emoji porque asi la escribe la planilla. */
  it("la prioridad conserva el emoji", () => {
    expect(leer("prioridad=" + encodeURIComponent("🟠 Alta")).prioridad).toEqual(["🟠 Alta"]);
    expect(leer("prioridad=Alta").prioridad).toEqual([]);
  });

  it("la busqueda viene limpia de espacios", () => {
    expect(leer("q=%20%20rodamiento%20%20").busqueda).toBe("rodamiento");
  });
});

describe("escribir los filtros en la URL", () => {
  it("sin filtros no escribe nada", () => {
    expect(escribirFiltrosEnLaUrl(FILTROS_VACIOS)).toBe("");
  });

  /**
   * Lo que sale tiene que volver igual al leerse: de eso depende que el boton
   * de atras devuelva la tabla como estaba.
   */
  it("lo que escribe se vuelve a leer igual", () => {
    const filtros: FiltrosOt = {
      busqueda: "rodamiento",
      estado: ["ATRASADO", "EN_PROCESO"],
      especialidad: ["MECÁNICO"],
      tipo: ["CORRECTIVO"],
      quien: ["CONTRATADO"],
      prioridad: ["🟠 Alta"],
      proveedor: ["p-piparo"],
      sector: ["s-filler1", "s-filler2"],
      equipo: ["e-1"],
    };
    expect(leer(escribirFiltrosEnLaUrl(filtros))).toEqual(filtros);
  });

  /**
   * Si el orden dependiera de en que orden se tildaron, el efecto que escribe
   * la barra de direcciones se dispararia de nuevo en cada render.
   */
  it("el orden no depende de en que orden se tildaron", () => {
    const a = escribirFiltrosEnLaUrl({ ...FILTROS_VACIOS, estado: ["ATRASADO", "POR_HACER"] });
    const b = escribirFiltrosEnLaUrl({ ...FILTROS_VACIOS, estado: ["ATRASADO", "POR_HACER"] });
    expect(a).toBe(b);
    expect(a).toBe("estado=ATRASADO%2CPOR_HACER");
  });

  it("una busqueda de solo espacios no ensucia la URL", () => {
    expect(escribirFiltrosEnLaUrl({ ...FILTROS_VACIOS, busqueda: "   " })).toBe("");
  });
});

describe("si hay algun filtro puesto", () => {
  it("vacio es que no", () => {
    expect(hayAlgunFiltro(FILTROS_VACIOS)).toBe(false);
  });

  it("cualquiera con algo es que si", () => {
    expect(hayAlgunFiltro({ ...FILTROS_VACIOS, estado: ["ATRASADO"] })).toBe(true);
    expect(hayAlgunFiltro({ ...FILTROS_VACIOS, busqueda: "x" })).toBe(true);
  });
});

/**
 * La ruta entiende el mismo query string que la barra de direcciones: asi,
 * reproducir lo que alguien ve no requiere traducir nada.
 */
describe("la consulta que se le manda a la ruta", () => {
  it("sin filtros va solo la pagina", () => {
    expect(consultaDeLaRuta(FILTROS_VACIOS, 1)).toBe("page=1");
  });

  it("con filtros, los filtros y la pagina", () => {
    expect(consultaDeLaRuta({ ...FILTROS_VACIOS, estado: ["ATRASADO"] }, 3))
      .toBe("estado=ATRASADO&page=3");
  });
});
