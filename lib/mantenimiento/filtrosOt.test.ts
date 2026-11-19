import { describe, it, expect } from "vitest";
import {
  leerFiltrosDeLaUrl, escribirFiltrosEnLaUrl, hayAlgunFiltro, consultaDeLaRuta,
  columnaDeFecha, FILTROS_VACIOS, type FiltrosOt,
  TIPOS_DE_OT, QUIENES_DE_OT, ETIQUETA_DE_TIPO, ETIQUETA_DE_QUIEN,
  ordenDelListado, ORDENES_DEL_LISTADO,
  VALORES_DE_REPROGRAMACION, ETIQUETA_DE_REPROGRAMACION, condicionDeReprogramacion,
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
      // El sugerido y no el numero: el numero es el default de la pantalla y
      // vale `""`, asi que no viaja. Lo que tiene que volver igual es lo que
      // alguien eligio.
      orden: "gut",
      desde: "2026-08-01",
      hasta: "2026-08-31",
      estado: ["ATRASADO", "EN_PROCESO"],
      especialidad: ["MECÁNICO"],
      tipo: ["CORRECTIVO"],
      quien: ["CONTRATADO"],
      prioridad: ["🟠 Alta"],
      proveedor: ["p-piparo"],
      sector: ["s-filler1", "s-filler2"],
      atrasada: true,
      equipo: ["e-1"],
      reprogramacion: ["hechas", "necesitan"],
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
 * La ruta entiende el mismo query string que la barra de direcciones, asi que
 * reproducir lo que alguien ve casi no requiere traducir nada.
 *
 * CASI: hay dos cosas que no se escriben igual de los dos lados, y las dos
 * estan probadas aca abajo. La pagina —`pagina` y solo cuando no es la
 * primera, contra `page` y siempre— y, desde el 18/11/2026, el orden: la
 * pantalla calla el suyo cuando es por numero y la ruta necesita oirlo, porque
 * de ese lado el silencio quiere decir el sugerido.
 */
describe("la consulta que se le manda a la ruta", () => {
  it("sin filtros va la pagina y el orden, que no es un filtro", () => {
    expect(consultaDeLaRuta(FILTROS_VACIOS, 1)).toBe("orden=numero&page=1");
  });

  it("con filtros, los filtros y la pagina", () => {
    expect(consultaDeLaRuta({ ...FILTROS_VACIOS, estado: ["ATRASADO"] }, 3))
      .toBe("orden=numero&estado=ATRASADO&page=3");
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
    expect(consultaDeLaRuta(FILTROS_VACIOS, 1)).toBe("orden=numero&page=1");
    expect(escribirFiltrosEnLaUrl(FILTROS_VACIOS, 1)).toBe("");
  });
});

describe("como se escriben los tipos y los quienes en pantalla", () => {
  /**
   * EL BUG DEL 22/10/2026. El filtro del listado armaba la etiqueta con un
   * ternario —`t === "PROGRAMADO" ? "Programado" : "Correctivo"`— que valia
   * mientras la lista tuviera exactamente dos valores. El 21/10 se sumaron
   * PREDICTIVO y MEJORA, y el desplegable paso a mostrar
   * «Programado, Correctivo, Correctivo, Correctivo»: tres opciones distintas
   * con la misma etiqueta. El de «quien lo realiza» mostraba «Contratado» dos
   * veces, por MIXTO.
   *
   * Que cada valor TENGA etiqueta ya lo exige `tsc`, porque el `Record` esta
   * tipado contra el propio tuple. Lo que `tsc` no puede ver es que dos valores
   * distintos compartan el mismo texto, que es exactamente el sintoma: tres
   * opciones que la persona no puede distinguir ni usar.
   */
  it("ningun tipo comparte etiqueta con otro", () => {
    const etiquetas = TIPOS_DE_OT.map((t) => ETIQUETA_DE_TIPO[t]);
    expect(new Set(etiquetas).size).toBe(TIPOS_DE_OT.length);
  });

  it("ningun quien comparte etiqueta con otro", () => {
    const etiquetas = QUIENES_DE_OT.map((q) => ETIQUETA_DE_QUIEN[q]);
    expect(new Set(etiquetas).size).toBe(QUIENES_DE_OT.length);
  });

  /** Y ninguna queda vacia, que se veria como una opcion sin nombre. */
  it("ninguna etiqueta esta vacia", () => {
    for (const t of TIPOS_DE_OT) expect(ETIQUETA_DE_TIPO[t].trim()).not.toBe("");
    for (const q of QUIENES_DE_OT) expect(ETIQUETA_DE_QUIEN[q].trim()).not.toBe("");
  });

  /** Las cuatro y las tres de hoy, escritas, que es lo que se ve en el filtro. */
  it("son las de hoy", () => {
    expect(TIPOS_DE_OT.map((t) => ETIQUETA_DE_TIPO[t]))
      .toEqual(["Programado", "Correctivo", "Predictivo", "Mejora"]);
    expect(QUIENES_DE_OT.map((q) => ETIQUETA_DE_QUIEN[q]))
      .toEqual(["Interno", "Contratado", "Mixto"]);
  });
});

describe("en que orden se lista", () => {
  /**
   * Pedido el 23/10/2026: poder ordenar por numero de OT. De esto sale un
   * nombre de columna para la consulta, asi que la lista blanca vive en `lib/`
   * y no en la ruta — lo mismo que `columnaDeFecha`.
   */
  it("acepta los tres que existen y nada mas", () => {
    expect(ordenDelListado("gut")).toBe("gut");
    // `numero` no es una opcion del desplegable pero si un valor valido: es el
    // que `consultaDeLaRuta` le manda a la ruta.
    expect(ordenDelListado("numero")).toBe("numero");
    expect(ordenDelListado("")).toBe("");
    expect(ordenDelListado("ot_number; drop table")).toBe("");
    expect(ordenDelListado("gut_orden")).toBe("");
    expect(ordenDelListado(null)).toBe("");
    expect(ordenDelListado(undefined)).toBe("");
  });

  /**
   * Pedido el 18/11/2026: que el listado arranque por numero de OT.
   *
   * La pantalla tiene dos estados y no tres —el sugerido o el numero—, y el
   * numero es el vacio, asi que entrar por el menu lo da sin que viaje nada.
   */
  it("sin nada en la URL, la pantalla arranca por numero", () => {
    expect(leerFiltrosDeLaUrl(new URLSearchParams(""), catalogos).orden).toBe("");
    expect(ORDENES_DEL_LISTADO[0]).toEqual(["", "N° de OT"]);
  });

  /**
   * La otra mitad del pedido, y la que es facil de romper sin que nada falle:
   * al pedirle los datos a la ruta el orden se dice EN VOZ ALTA, porque de ese
   * lado el vacio quiere decir el sugerido. Sin esto el listado arrancaria por
   * GUT con el desplegable diciendo «N° de OT».
   */
  it("lo que la pantalla calla, la consulta de la ruta lo dice", () => {
    expect(consultaDeLaRuta(FILTROS_VACIOS, 1)).toBe("orden=numero&page=1");
    expect(consultaDeLaRuta({ ...FILTROS_VACIOS, orden: "gut" }, 1)).toBe("orden=gut&page=1");
    // Y en la barra de direcciones el default sigue sin ensuciar el enlace.
    expect(escribirFiltrosEnLaUrl(FILTROS_VACIOS)).toBe("");
  });

  /**
   * El sugerido necesito un valor propio justamente para esto: si fuera el
   * vacio no viajaria —`escribirEnLaUrl` saltea lo vacio— y elegirlo no se
   * podria guardar en el enlace.
   */
  it("el sugerido viaja en la URL y vuelve igual", () => {
    const url = escribirFiltrosEnLaUrl({ ...FILTROS_VACIOS, orden: "gut" });
    expect(url).toContain("orden=gut");
    expect(leerFiltrosDeLaUrl(new URLSearchParams(url), catalogos).orden).toBe("gut");
  });

  /** Un enlace de antes del 18/11/2026 sigue ordenando por numero. */
  it("el `orden=numero` viejo sigue siendo el numero", () => {
    expect(leerFiltrosDeLaUrl(new URLSearchParams("orden=numero"), catalogos).orden).toBe("");
  });

  /**
   * El orden NO es un filtro: no saca ninguna orden de la lista. Si contara,
   * el cartel diria "hay filtros puestos" por haber elegido como mirar, y
   * «Limpiar» lo devolveria al sugerido sin que nadie lo pidiera.
   */
  it("no cuenta como filtro puesto", () => {
    expect(hayAlgunFiltro({ ...FILTROS_VACIOS, orden: "numero" })).toBe(false);
  });
});

describe("el filtro de reprogramacion", () => {
  it("viaja a la URL como ?reprogramacion=hechas", () => {
    const f = { ...FILTROS_VACIOS, reprogramacion: ["hechas"] };
    expect(escribirFiltrosEnLaUrl(f)).toBe("reprogramacion=hechas");
    expect(leer("reprogramacion=hechas").reprogramacion).toEqual(["hechas"]);
  });

  it("acepta los dos valores a la vez y los escribe como se eligieron", () => {
    const leidos = leer("reprogramacion=necesitan&reprogramacion=hechas");
    expect(leidos.reprogramacion).toEqual(["necesitan", "hechas"]);
    // Una lista viaja como un solo parametro con los valores separados por coma,
    // igual que el resto de los filtros, en el orden en que se eligieron.
    expect(escribirFiltrosEnLaUrl(leidos)).toBe("reprogramacion=necesitan%2Chechas");
    expect(leer("reprogramacion=necesitan%2Chechas").reprogramacion).toEqual(["necesitan", "hechas"]);
  });

  it("descarta un valor que no esta en la lista", () => {
    expect(leer("reprogramacion=todas").reprogramacion).toEqual([]);
    expect(leer("reprogramacion=hechas,todas").reprogramacion).toEqual(["hechas"]);
  });

  /** A diferencia de `campoFecha`, este SI esconde filas. */
  it("cuenta para hayAlgunFiltro", () => {
    expect(hayAlgunFiltro({ ...FILTROS_VACIOS, reprogramacion: ["necesitan"] })).toBe(true);
  });

  it("vuelve a FILTROS_VACIOS al limpiar", () => {
    expect(FILTROS_VACIOS.reprogramacion).toEqual([]);
    expect(leer("")).toEqual(FILTROS_VACIOS);
  });

  it("viaja a la ruta con el mismo nombre", () => {
    const f = { ...FILTROS_VACIOS, reprogramacion: ["hechas", "necesitan"] };
    expect(consultaDeLaRuta(f, 1)).toContain("reprogramacion=hechas%2Cnecesitan");
  });

  it("ninguna etiqueta esta vacia ni se repite", () => {
    const etiquetas = VALORES_DE_REPROGRAMACION.map((v) => ETIQUETA_DE_REPROGRAMACION[v]);
    for (const e of etiquetas) expect(e.trim()).not.toBe("");
    expect(new Set(etiquetas).size).toBe(VALORES_DE_REPROGRAMACION.length);
  });
});

describe("la condicion de reprogramacion para la consulta", () => {
  const hoy = "2026-11-19";
  // El estado ATRASADO no aparece nunca: la planilla lo calcula contra el
  // TODAY() de su ultima recalculada y envejece sola.
  const necesitan = "and(estado.not.in.(REALIZADO,CANCELADA),fecha_ejecucion.lt.2026-11-19)";

  it("sin valores no agrega condicion", () => {
    expect(condicionDeReprogramacion([], hoy)).toBeNull();
  });

  it("hechas: las que ya se corrieron", () => {
    expect(condicionDeReprogramacion(["hechas"], hoy)).toBe("reprogramada_veces.gt.0");
  });

  it("necesitan: abiertas con la fecha de inicio ya pasada, sin mirar el estado ATRASADO", () => {
    const c = condicionDeReprogramacion(["necesitan"], hoy)!;
    expect(c).toBe(necesitan);
    expect(c).not.toContain("ATRASADO");
    expect(c).not.toContain("SUSPENDIDA");
  });

  it("los dos suman: es un o entre las dos condiciones, no una y", () => {
    expect(condicionDeReprogramacion(["hechas", "necesitan"], hoy))
      .toBe(`reprogramada_veces.gt.0,${necesitan}`);
  });

  it("un valor que no existe no agrega condicion", () => {
    expect(condicionDeReprogramacion(["todas"], hoy)).toBeNull();
  });

  it("la fecha que no es una fecha no llega a la consulta", () => {
    expect(condicionDeReprogramacion(["necesitan"], "x),estado.eq.1")).toBeNull();
  });
});

describe("el filtro «atrasada»", () => {
  it("lee atrasada=1 de la url", () => {
    expect(leer("atrasada=1").atrasada).toBe(true);
  });
  it("cualquier otro valor es false", () => {
    expect(leer("atrasada=0").atrasada).toBe(false);
    expect(leer("atrasada=true").atrasada).toBe(false);
    expect(leer("").atrasada).toBe(false);
  });
  it("escribe atrasada=1 y no escribe nada cuando es false", () => {
    expect(escribirFiltrosEnLaUrl({ ...FILTROS_VACIOS, atrasada: true })).toBe("atrasada=1");
    expect(escribirFiltrosEnLaUrl({ ...FILTROS_VACIOS, atrasada: false })).toBe("");
  });
  it("cuenta como filtro puesto", () => {
    expect(hayAlgunFiltro({ ...FILTROS_VACIOS, atrasada: true })).toBe(true);
  });
  it("viaja a la consulta de la ruta", () => {
    expect(consultaDeLaRuta({ ...FILTROS_VACIOS, atrasada: true }, 1)).toContain("atrasada=1");
  });
  it("no es un estado: no entra al vocabulario de la planilla", () => {
    expect(leer("estado=ATRASADA").estado).toEqual([]);
  });
});
