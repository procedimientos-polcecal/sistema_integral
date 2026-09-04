import { describe, it, expect } from "vitest";
import {
  leerFiltrosDeLaUrl, escribirFiltrosEnLaUrl, hayAlgunFiltro, consultaDeLaRuta,
  columnaDeFecha, FILTROS_VACIOS, type FiltrosOt,
} from "./filtrosOt";
import { leerPaginaDeLaUrl } from "@/lib/core/filtrosUrl";

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
      campoFecha: "fecha_ejecucion",
      desde: "2026-08-01",
      hasta: "2026-08-31",
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

describe("el rango de fechas", () => {
  it("sin nada, las dos vacias y la columna de siempre", () => {
    expect(leer("")).toMatchObject({ campoFecha: "", desde: "", hasta: "" });
    expect(columnaDeFecha("")).toBe("fecha");
  });

  it("lee las dos puntas y sobre que fecha corren", () => {
    expect(leer("campo_fecha=fecha_cierre&desde=2026-08-01&hasta=2026-08-31"))
      .toMatchObject({ campoFecha: "fecha_cierre", desde: "2026-08-01", hasta: "2026-08-31" });
    expect(columnaDeFecha("fecha_cierre")).toBe("fecha_cierre");
  });

  it("una punta sola vale: es un rango abierto de ese lado", () => {
    expect(leer("desde=2026-08-01")).toMatchObject({ desde: "2026-08-01", hasta: "" });
    expect(leer("hasta=2026-08-31")).toMatchObject({ desde: "", hasta: "2026-08-31" });
  });

  /**
   * Una fecha imposible en la URL dejaria la tabla vacia sin que se vea por
   * que. Se descarta, igual que un estado que no existe.
   */
  it("descarta lo que no es una fecha de verdad", () => {
    expect(leer("desde=2026-02-31").desde).toBe("");
    expect(leer("desde=ayer").desde).toBe("");
    expect(leer("hasta=2026-13-01").hasta).toBe("");
  });

  /**
   * Es un nombre de columna que viene de la URL: la lista blanca esta en
   * `columnaDeFecha` y no en quien arma la consulta, para que sea segura sola.
   */
  it("una columna inventada no puede llegar a la consulta", () => {
    expect(leer("campo_fecha=synced_at&desde=2026-08-01").campoFecha).toBe("");
    expect(columnaDeFecha("synced_at")).toBe("fecha");
    expect(columnaDeFecha("id; drop table ordenes_trabajo")).toBe("fecha");
    expect(columnaDeFecha(null)).toBe("fecha");
  });

  /**
   * Elegir "fecha de cierre" sin poner ningun dia no filtra nada: no cuenta
   * como filtro y no ensucia el enlace que alguien copia.
   */
  it("sin fechas, el campo elegido no viaja ni cuenta", () => {
    const soloElCampo = { ...FILTROS_VACIOS, campoFecha: "fecha_cierre" };
    expect(escribirFiltrosEnLaUrl(soloElCampo)).toBe("");
    expect(hayAlgunFiltro(soloElCampo)).toBe(false);
  });

  it("con fechas si viaja", () => {
    const conFecha = { ...FILTROS_VACIOS, campoFecha: "fecha_cierre", desde: "2026-08-01" };
    expect(escribirFiltrosEnLaUrl(conFecha)).toBe("campo_fecha=fecha_cierre&desde=2026-08-01");
    expect(hayAlgunFiltro(conFecha)).toBe(true);
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

/**
 * La pagina viaja en la URL igual que en requerimientos, y con la misma regla:
 * se cuenta desde uno y la primera no se escribe. Es lo que hace que entrar a
 * una orden desde la pagina 3 y volver no devuelva la tabla cien filas arriba.
 */
describe("la pagina en la barra de direcciones", () => {
  const leerPagina = (query: string) => leerPaginaDeLaUrl(new URLSearchParams(query));

  it("sin parametro, la primera", () => {
    expect(leerPagina("")).toBe(1);
    expect(leerPagina("estado=ATRASADO")).toBe(1);
  });

  it("un numero que no es una pagina es la primera", () => {
    for (const query of ["pagina=0", "pagina=-2", "pagina=abc", "pagina=2.5", "pagina="]) {
      expect(leerPagina(query)).toBe(1);
    }
  });

  it("la primera no ensucia la URL", () => {
    expect(escribirFiltrosEnLaUrl(FILTROS_VACIOS, 1)).toBe("");
    expect(escribirFiltrosEnLaUrl({ ...FILTROS_VACIOS, estado: ["ATRASADO"] }, 1))
      .toBe("estado=ATRASADO");
  });

  it("la pagina va al final, despues de los filtros", () => {
    expect(escribirFiltrosEnLaUrl({ ...FILTROS_VACIOS, estado: ["ATRASADO"] }, 3))
      .toBe("estado=ATRASADO&pagina=3");
    expect(escribirFiltrosEnLaUrl(FILTROS_VACIOS, 3)).toBe("pagina=3");
  });

  it("lo que se escribe se vuelve a leer igual, filtros y pagina", () => {
    const puestos = {
      ...FILTROS_VACIOS,
      estado: ["ATRASADO", "EN_PROCESO"],
      sector: ["s-filler1"],
      busqueda: "bomba",
    };
    const query = escribirFiltrosEnLaUrl(puestos, 4);
    expect(leer(query)).toEqual(puestos);
    expect(leerPagina(query)).toBe(4);
  });

  // La de la ruta es otra: siempre va, y con otro nombre.
  it("la de la API no se mezcla con la de la URL", () => {
    expect(consultaDeLaRuta(FILTROS_VACIOS, 1)).toBe("page=1");
    expect(escribirFiltrosEnLaUrl(FILTROS_VACIOS, 1)).toBe("");
  });
});
