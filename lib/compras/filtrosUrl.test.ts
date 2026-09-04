import { describe, it, expect } from "vitest";
import {
  leerFiltrosDeLaUrl, escribirFiltrosEnLaUrl, leerPaginaDeLaUrl,
  enlaceAlRequerimiento, volverAlListado,
  hayAlgunFiltro, FILTROS_VACIOS,
} from "./filtrosUrl";

const catalogos = {
  areas: ["area-mant", "area-seg"],
  empresas: ["emp-polcecal", "emp-polysan"],
  proveedores: ["prov-1"],
  ubicaciones: ["ubi-1"],
  equipos: ["eq-em12"],
  sectores: ["sec-py-b1"],
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
    expect(leer("estado_compra=PEDIDO").compra).toEqual(["PEDIDO"]);
    expect(hayAlgunFiltro(leer("estado_compra=PEDIDO"))).toBe(true);
  });

  it("descarta un estado que no existe", () => {
    expect(leer("estado_compra=EN_CAMINO").compra).toEqual([]);
  });

  it("descarta un area que no esta en la lista", () => {
    expect(leer("area=area-mant").area).toEqual(["area-mant"]);
    expect(leer("area=area-borrada").area).toEqual([]);
  });

  it("acepta AMBAS como empresa: no es un id sino una condicion", () => {
    expect(leer("empresa=AMBAS").empresa).toEqual(["AMBAS"]);
    expect(leer("empresa=emp-polysan").empresa).toEqual(["emp-polysan"]);
    expect(leer("empresa=emp-inventada").empresa).toEqual([]);
  });

  it("la busqueda llega limpia de espacios", () => {
    expect(leer("q=%20%20rodamiento%20%20").busqueda).toBe("rodamiento");
  });

  it("lee varios filtros a la vez", () => {
    const f = leer("estado_compra=APROBADO&prioridad=URGENTE&area=area-seg");
    expect(f.compra).toEqual(["APROBADO"]);
    expect(f.prioridad).toEqual(["URGENTE"]);
    expect(f.area).toEqual(["area-seg"]);
    expect(f.proveedor).toEqual([]);
  });
});

/**
 * Cada filtro acepta varios valores: preguntar "que hay en Cotizando y en Para
 * comprar" es una sola pregunta, y antes habia que hacerla en dos pasadas.
 */
describe("varios valores en un mismo filtro", () => {
  it("lee el parametro repetido, que es lo que arma un formulario", () => {
    expect(leer("estado_compra=PEDIDO&estado_compra=APROBADO").compra)
      .toEqual(["PEDIDO", "APROBADO"]);
  });

  it("lee la lista separada por comas, que es lo que se manda por chat", () => {
    expect(leer("prioridad=URGENTE,NORMAL").prioridad).toEqual(["URGENTE", "NORMAL"]);
  });

  it("una prioridad con espacio sobrevive a la coma", () => {
    expect(leer("prioridad=URGENTE,1%20SEMANA").prioridad)
      .toEqual(["URGENTE", "1 SEMANA"]);
  });

  it("descarta los invalidos y conserva los demas", () => {
    expect(leer("area=area-mant,area-borrada,area-seg").area)
      .toEqual(["area-mant", "area-seg"]);
  });

  it("un valor repetido en la URL no se duplica en la consulta", () => {
    expect(leer("estado_compra=PEDIDO&estado_compra=PEDIDO").compra).toEqual(["PEDIDO"]);
  });

  it("acepta AMBAS junto con una empresa: los RI que paga una, y los que pagan las dos", () => {
    expect(leer("empresa=AMBAS,emp-polcecal").empresa)
      .toEqual(["AMBAS", "emp-polcecal"]);
  });
});

/**
 * La maquina y el sector salen del catalogo de ubicaciones, no del
 * requerimiento. Se validan igual que los demas: un id que el desplegable no
 * ofrece dejaria la tabla vacia sin que se pueda quitar el filtro.
 */
describe("filtros por maquina y por sector de planta", () => {
  it("lee el equipo y el sector cuando estan en la lista", () => {
    expect(leer("equipo=eq-em12").equipo).toEqual(["eq-em12"]);
    expect(leer("sector=sec-py-b1").sector).toEqual(["sec-py-b1"]);
    expect(hayAlgunFiltro(leer("equipo=eq-em12"))).toBe(true);
  });

  it("descarta un equipo que no tiene ninguna ubicacion enlazada", () => {
    expect(leer("equipo=eq-em99").equipo).toEqual([]);
    expect(hayAlgunFiltro(leer("equipo=eq-em99"))).toBe(false);
  });

  it("descarta un sector que no esta en la lista", () => {
    expect(leer("sector=sec-tesoreria").sector).toEqual([]);
  });
});

/**
 * El listado reescribe la URL con cada cambio de filtro. Lo que importa no es
 * la forma exacta del query string sino que vuelva a leerse igual: es lo que
 * hace que entrar a un RI y volver con el boton de atras no pierda los filtros.
 */
describe("filtros escritos de vuelta en la URL", () => {
  it("sin filtros no deja query string", () => {
    expect(escribirFiltrosEnLaUrl(FILTROS_VACIOS)).toBe("");
  });

  it("los valores de un filtro van juntos, separados por comas", () => {
    expect(escribirFiltrosEnLaUrl({ ...FILTROS_VACIOS, prioridad: ["URGENTE", "LEVE"] }))
      .toBe("prioridad=URGENTE%2CLEVE");
  });

  it("lo que se escribe se vuelve a leer igual", () => {
    const puestos = {
      ...FILTROS_VACIOS,
      busqueda: "bomba",
      area: ["area-mant"],
      compra: ["PEDIDO", "PARA_COMPRAR"],
      empresa: ["emp-polysan", "AMBAS"],
      equipo: ["eq-em12"],
      sector: ["sec-py-b1"],
    };
    expect(leer(escribirFiltrosEnLaUrl(puestos))).toEqual(puestos);
  });

  it("el orden no depende de en que orden se tocaron los desplegables", () => {
    const a = escribirFiltrosEnLaUrl({ ...FILTROS_VACIOS, area: ["area-seg"], prioridad: ["LEVE"] });
    const b = escribirFiltrosEnLaUrl({ ...FILTROS_VACIOS, prioridad: ["LEVE"], area: ["area-seg"] });
    expect(a).toBe(b);
  });

  it("una busqueda con espacios de sobra se guarda recortada", () => {
    expect(leer(escribirFiltrosEnLaUrl({ ...FILTROS_VACIOS, busqueda: "  bomba  " })).busqueda)
      .toBe("bomba");
  });
});

/**
 * El boton de atras del navegador alcanza cuando se entra a la ficha desde el
 * listado, pero el «Volver a requerimientos» de la ficha es un enlace hacia
 * adelante: tiene que saber a que tabla volver.
 */
describe("ida y vuelta entre el listado y la ficha", () => {
  it("sin filtros la ficha se enlaza pelada", () => {
    expect(enlaceAlRequerimiento("ri-1", "")).toBe("/compras/requerimientos/ri-1");
  });

  it("con filtros puestos, la ficha se lleva con que volver", () => {
    const query = escribirFiltrosEnLaUrl({ ...FILTROS_VACIOS, compra: ["PEDIDO"] });
    expect(enlaceAlRequerimiento("ri-1", query))
      .toBe("/compras/requerimientos/ri-1?volver=estado_compra%3DPEDIDO");
  });

  it("los filtros llegan enteros al volver", () => {
    const puestos = { ...FILTROS_VACIOS, busqueda: "bomba", prioridad: ["URGENTE", "LEVE"] };
    const ficha = enlaceAlRequerimiento("ri-1", escribirFiltrosEnLaUrl(puestos));
    const volver = new URL(ficha, "https://x").searchParams.get("volver");
    expect(leer(new URL(volverAlListado(volver ?? undefined), "https://x").search)).toEqual(puestos);
  });

  it("sin de donde volver, se vuelve al listado limpio", () => {
    expect(volverAlListado(undefined)).toBe("/compras/requerimientos");
    expect(volverAlListado("")).toBe("/compras/requerimientos");
  });

  // Es texto que llega por la URL: no puede terminar apuntando a otro lado.
  it("un parametro armado a mano no corre el enlace fuera del listado", () => {
    expect(volverAlListado("//evil.example/x")).toBe("/compras/requerimientos?%2F%2Fevil.example%2Fx=");
    expect(volverAlListado("q=a#/otra/ruta")).toBe("/compras/requerimientos?q=a%23%2Fotra%2Fruta");
  });
});

/**
 * La pagina tambien viaja en la URL: volver a la tabla filtrada pero en la
 * primera pagina es media solucion cuando se estaba en la tercera.
 */
describe("la pagina en la URL", () => {
  const leerPagina = (qs: string) => leerPaginaDeLaUrl(new URLSearchParams(qs));

  it("sin parametro, la primera", () => {
    expect(leerPagina("")).toBe(0);
    expect(leerPagina("estado_compra=PEDIDO")).toBe(0);
  });

  // En la URL se cuenta desde uno, como en los botones; adentro desde cero.
  it("se cuenta desde uno en la URL y desde cero adentro", () => {
    expect(leerPagina("pagina=1")).toBe(0);
    expect(leerPagina("pagina=3")).toBe(2);
  });

  it("un numero que no es una pagina es la primera", () => {
    for (const qs of ["pagina=0", "pagina=-2", "pagina=abc", "pagina=2.5", "pagina="]) {
      expect(leerPagina(qs)).toBe(0);
    }
  });

  it("la primera pagina no ensucia la URL", () => {
    expect(escribirFiltrosEnLaUrl(FILTROS_VACIOS, 0)).toBe("");
    expect(escribirFiltrosEnLaUrl({ ...FILTROS_VACIOS, compra: ["PEDIDO"] }, 0))
      .toBe("estado_compra=PEDIDO");
  });

  it("la pagina va al final, despues de los filtros", () => {
    expect(escribirFiltrosEnLaUrl({ ...FILTROS_VACIOS, compra: ["PEDIDO"] }, 2))
      .toBe("estado_compra=PEDIDO&pagina=3");
  });

  it("filtros y pagina vuelven juntos, tambien pasando por la ficha", () => {
    const puestos = { ...FILTROS_VACIOS, area: ["area-mant"], prioridad: ["URGENTE"] };
    const query = escribirFiltrosEnLaUrl(puestos, 4);
    const volver = new URL(enlaceAlRequerimiento("ri-1", query), "https://x")
      .searchParams.get("volver");
    const listado = new URL(volverAlListado(volver ?? undefined), "https://x");
    expect(leer(listado.search)).toEqual(puestos);
    expect(leerPaginaDeLaUrl(listado.searchParams)).toBe(4);
  });
});
