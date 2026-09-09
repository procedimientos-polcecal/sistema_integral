import { describe, it, expect } from "vitest";
import {
  indicePorNombre, indiceDeEmpleados, reconocer, esAmbiguo, SinReconocer,
  indiceDeEquipos, reconocerEquipo,
} from "./enlaces";

const sectores = indicePorNombre([
  { id: "s-mant", nombre: "Mantenimiento" },
  { id: "s-prod", nombre: "Producción" },
  { id: "s-lab", nombre: "Laboratorio" },
]);

describe("reconocer un nombre de la planilla contra el nucleo", () => {
  it("encuentra el que coincide", () => {
    expect(reconocer(sectores, "Laboratorio")).toBe("s-lab");
  });

  /** En la planilla el nombre se escribe a mano cada vez. */
  it("no se pierde por mayusculas, acentos ni puntos", () => {
    expect(reconocer(sectores, "MANTENIMIENTO")).toBe("s-mant");
    expect(reconocer(sectores, "produccion")).toBe("s-prod");
    expect(reconocer(sectores, "  Produccion.  ")).toBe("s-prod");
  });

  /**
   * Lo que no se reconoce queda en null y no se crea: esas tablas las comparten
   * cuatro modulos, y una fila por cada variante mal tipeada llenaria la lista
   * que usan los demas.
   */
  it("lo que no esta devuelve null, no un parecido", () => {
    expect(reconocer(sectores, "Taller Vial")).toBeNull();
    expect(reconocer(sectores, "Mantenimiento de Equipos")).toBeNull();
  });

  it("vacio, guion y nulo no reconocen nada", () => {
    expect(reconocer(sectores, "")).toBeNull();
    expect(reconocer(sectores, "-")).toBeNull();
    expect(reconocer(sectores, null)).toBeNull();
    expect(reconocer(sectores, undefined)).toBeNull();
  });
});

describe("armar el indice de un catalogo", () => {
  /**
   * Antes ganaba la primera, para que el resultado no dependiera del orden en
   * que vinieron. Elegir la primera depende igual —PostgREST no promete un
   * orden— y ademas contradice la regla del modulo: enlazar al que se le parece
   * es peor que dejar en null. Un empate es no reconocerlo con certeza.
   */
  it("con dos filas que normalizan igual no gana ninguna", () => {
    const i = indicePorNombre([
      { id: "a", nombre: "Candia" },
      { id: "b", nombre: "CANDIA" },
    ]);
    expect(reconocer(i, "candia")).toBeNull();
    expect(esAmbiguo(i, "candia")).toBe(true);
  });

  // Se informa aparte de "no existe" porque no se arregla igual: uno se resuelve
  // dando de alta la fila, el otro sacando el duplicado del catalogo.
  it("un nombre que no esta no es lo mismo que uno repetido", () => {
    const i = indicePorNombre([{ id: "a", nombre: "Candia" }]);
    expect(reconocer(i, "Piparo")).toBeNull();
    expect(esAmbiguo(i, "Piparo")).toBe(false);
    expect(esAmbiguo(i, "")).toBe(false);
  });

  it("la misma fila nombrada dos veces no es un empate", () => {
    const i = indicePorNombre([
      { id: "a", nombre: "Candia" },
      { id: "a", nombre: "CANDIA." },
    ]);
    expect(reconocer(i, "candia")).toBe("a");
  });

  it("una fila sin nombre util no entra al indice", () => {
    const i = indicePorNombre([{ id: "x", nombre: "-" }, { id: "y", nombre: "" }]);
    expect(i.size).toBe(0);
  });
});

/**
 * El caso que no funcionaba: cero de 3.794 movimientos con solicitante tenian
 * empleado_id, porque el indice se armaba con la columna `nombre` sola.
 */
describe("el indice de empleados", () => {
  const empleados = indiceDeEmpleados([
    { id: "e-varela", nombre: "Francisco Enrique", apellido: "VARELA" },
    { id: "e-candia", nombre: "Augusto", apellido: "Candia" },
    { id: "e-lopez", nombre: "Raul Argentino", apellido: "LOPEZ" },
  ]);

  it("reconoce como escribe la planilla: apellido, nombre", () => {
    expect(reconocer(empleados, "VARELA, Francisco Enrique")).toBe("e-varela");
  });

  /** En la misma columna conviven las dos formas. */
  it("reconoce tambien nombre y apellido al derecho", () => {
    expect(reconocer(empleados, "Augusto Candia")).toBe("e-candia");
    expect(reconocer(empleados, "Francisco Enrique Varela")).toBe("e-varela");
  });

  it("la coma no cambia nada", () => {
    expect(reconocer(empleados, "Candia, Augusto")).toBe("e-candia");
    expect(reconocer(empleados, "candia augusto")).toBe("e-candia");
  });

  /**
   * "Lopez Raul" podria ser LOPEZ, Raul Argentino — o cualquier otro Lopez.
   * Acertar requiere saber que no hay dos, y eso no se deduce del texto.
   */
  it("un nombre incompleto no se completa solo", () => {
    expect(reconocer(empleados, "Lopez Raul")).toBeNull();
    expect(reconocer(empleados, "Sebastian")).toBeNull();
  });

  it("lo que no es una persona no reconoce nada", () => {
    expect(reconocer(empleados, "REGULADOR")).toBeNull();
    expect(reconocer(empleados, "OFICINAS")).toBeNull();
  });

  it("un empleado sin apellido entra igual, con su nombre solo", () => {
    const i = indiceDeEmpleados([{ id: "e-x", nombre: "Nerina", apellido: null }]);
    expect(reconocer(i, "Nerina")).toBe("e-x");
  });
});

/**
 * Un enlace que falta y nadie ve es un reporte que miente sin avisar: se junta
 * para poder decirlo en pantalla.
 */
describe("dos empleados que se escriben igual", () => {
  // "Lopez Raul" contra otro "Lopez Raul": acertar requiere saber que no hay
  // dos, y no lo sabemos. Las dos formas de uno solo si resuelven, porque el id
  // es el mismo.
  it("no resuelven a ninguno, pero las dos formas de uno solo si", () => {
    const i = indiceDeEmpleados([
      { id: "e1", nombre: "Raul", apellido: "Lopez" },
      { id: "e2", nombre: "Raul", apellido: "Lopez" },
    ]);
    expect(reconocer(i, "LOPEZ, Raul")).toBeNull();
    expect(esAmbiguo(i, "Lopez Raul")).toBe(true);

    const uno = indiceDeEmpleados([{ id: "e1", nombre: "Raul", apellido: "Lopez" }]);
    expect(reconocer(uno, "LOPEZ, Raul")).toBe("e1");
    expect(reconocer(uno, "Raul Lopez")).toBe("e1");
  });
});

describe("lo que la planilla nombro y el nucleo no tiene", () => {
  it("junta los nombres por catalogo, sin repetir y ordenados", () => {
    const sin = new SinReconocer();
    sin.anotar("sectores", "Taller Vial");
    sin.anotar("sectores", "Almacén");
    sin.anotar("sectores", "Taller Vial");
    sin.anotar("empleados", "Perez");

    expect(sin.resumen()).toEqual({
      sectores: ["Almacén", "Taller Vial"],
      empleados: ["Perez"],
    });
  });

  it("no anota vacios ni guiones", () => {
    const sin = new SinReconocer();
    sin.anotar("sectores", "");
    sin.anotar("sectores", "   ");
    sin.anotar("sectores", "-");
    sin.anotar("sectores", null);
    expect(sin.resumen()).toEqual({});
  });

  it("sin nada anotado el resumen viene vacio", () => {
    expect(new SinReconocer().resumen()).toEqual({});
  });
});

describe("reconocer un equipo del nucleo", () => {
  const equipos = [
    { id: "e1", code: "PO-A1-11", name: "Cinta transportadora 6" },
    { id: "e2", code: "PO-D1-10", name: "Separador dinámico 2" },
    { id: "e3", code: "EM8", name: "Camión volcador 1" },
    { id: "e4", code: "C1", name: "Compresor 1" },
    { id: "e5", code: "PY-B1-05", name: "Cinta transportadora 3" },
  ];
  const indice = indiceDeEquipos(equipos);

  it("engancha por el codigo cuando el nombre coincide", () => {
    expect(reconocerEquipo(indice, "PO-A1-11 - CINTA TRANSPORTADORA 6")).toBe("e1");
  });

  /**
   * Los 26 casos que costaron el diseño: la planilla y el nucleo le dicen
   * distinto a la misma maquina. El codigo manda.
   */
  it("engancha por el codigo aunque el nombre no coincida", () => {
    expect(reconocerEquipo(indice, "EM8 - SCANIA 420 4x4")).toBe("e3");
  });

  /** Los dos huerfanos del kardex, que no estan en la pestana. */
  it("engancha los separadores dinamicos 3 y 4 con el PO-D1-10", () => {
    expect(reconocerEquipo(indice, "PO-D1-10 - SEPARADOR DINÁMICO 3")).toBe("e2");
    expect(reconocerEquipo(indice, "PO-D1-10 - SEPARADOR DINÁMICO 4")).toBe("e2");
  });

  it("engancha un codigo escrito solo, sin nombre", () => {
    expect(reconocerEquipo(indice, "C1")).toBe("e4");
  });

  it("el match es insensible a mayusculas y acentos", () => {
    expect(reconocerEquipo(indice, "PY-B1-05 - Cinta Transportadora 3")).toBe("e5");
  });

  it("engancha por el nombre solo, sin el codigo adelante, aunque el equipo tenga codigo", () => {
    expect(reconocerEquipo(indice, "Cinta transportadora 6")).toBe("e1");
  });

  /**
   * Los oficios y los lugares que la pestana usa como relleno NO son equipos
   * del nucleo. Quedan en null a proposito: enlazar al que se le parece es peor
   * que dejar vacio.
   */
  it("lo que no es un equipo queda en null", () => {
    expect(reconocerEquipo(indice, "PAÑOL")).toBeNull();
    expect(reconocerEquipo(indice, "GALPON 5")).toBeNull();
    expect(reconocerEquipo(indice, "TALLER ELÉCTRICO")).toBeNull();
    expect(reconocerEquipo(indice, "PO-C1-11 - EDIFICIO")).toBeNull();
  });

  it("vacio, null y un guion suelto quedan en null", () => {
    expect(reconocerEquipo(indice, "")).toBeNull();
    expect(reconocerEquipo(indice, null)).toBeNull();
    expect(reconocerEquipo(indice, "-")).toBeNull();
  });

  it("dos equipos con el mismo codigo no resuelven a ninguno", () => {
    const ambiguo = indiceDeEquipos([
      { id: "a", code: "X1", name: "Uno" },
      { id: "b", code: "X1", name: "Otro" },
    ]);
    expect(reconocerEquipo(ambiguo, "X1 - UNO")).toBeNull();
  });

  it("un equipo sin codigo entra igual, por su nombre", () => {
    const sinCode = indiceDeEquipos([{ id: "z", code: null, name: "Molino viejo" }]);
    expect(reconocerEquipo(sinCode, "MOLINO VIEJO")).toBe("z");
  });
});
