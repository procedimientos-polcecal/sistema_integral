import { describe, it, expect } from "vitest";
import { indicePorNombre, indiceDeEmpleados, reconocer, SinReconocer } from "./enlaces";

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
  /** Si dos filas normalizan igual, elegir la segunda haria que el resultado
   * dependa del orden en que vinieron. */
  it("con dos filas que normalizan igual gana la primera", () => {
    const i = indicePorNombre([
      { id: "a", nombre: "Candia" },
      { id: "b", nombre: "CANDIA" },
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
