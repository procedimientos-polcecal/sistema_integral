import { describe, it, expect } from "vitest";
import { columnasAManoAEscribir, esPestanaDeArea } from "./sheets";

/**
 * Las dos columnas del master que no salen del `QUERY(IMPORTRANGE())`.
 *
 * `celdasDePrioridadYEmpresa` de `formulario.ts` ya tiene sus tests y hace lo
 * mismo para el camino del alta. Esta es la copia que corre en **produccion**:
 * en cada exportacion y en cada reintento, que son cinco llamadores. Estaba sin
 * probar justamente por estar metida adentro del I/O.
 */
describe("las dos columnas a mano del master", () => {
  const IDX = { prioridad: 10, empresa: 11 };

  it("escribe las dos cuando estan las dos columnas y hay los dos valores", () => {
    const r = columnasAManoAEscribir(IDX, { prioridad: "URGENTE", empresa: "Polcecal" });
    expect(r.aEscribir).toEqual([
      { clave: "prioridad", columna: 10, valor: "URGENTE" },
      { clave: "empresa", columna: 11, valor: "Polcecal" },
    ]);
    expect(r.sinColumna).toEqual([]);
  });

  it("si falta UNA de las dos columnas, escribe la otra y anota la que falta", () => {
    // Escribir la que si esta y contestar que todo salio bien es lo que hacia
    // esta escritura cuando la hacia el alta: la regla del modulo es que si una
    // ruta toca un campo que se exporta y no puede exportarlo, queda el
    // pendiente anotado.
    const r = columnasAManoAEscribir(
      { prioridad: 10, empresa: -1 },
      { prioridad: "URGENTE", empresa: "Polcecal" }
    );
    expect(r.aEscribir).toEqual([{ clave: "prioridad", columna: 10, valor: "URGENTE" }]);
    expect(r.sinColumna).toHaveLength(1);
    expect(r.sinColumna.join(" ")).toMatch(/empresa/);
  });

  it("una celda que no tenemos con que llenar no se pisa con vacio ni se anota", () => {
    // Mismo criterio que la celda de comparativa, que borraba el link que la
    // planilla si tenia: sin valor no hay nada que exportar, asi que tampoco hay
    // pendiente que anotar aunque falte la columna.
    const r = columnasAManoAEscribir({ prioridad: -1, empresa: 11 }, { prioridad: "", empresa: "" });
    expect(r.aEscribir).toEqual([]);
    expect(r.sinColumna).toEqual([]);
  });

  it("sin ninguna de las dos columnas no escribe nada y anota las dos", () => {
    const r = columnasAManoAEscribir(
      { prioridad: -1, empresa: -1 },
      { prioridad: "URGENTE", empresa: "Ambas" }
    );
    expect(r.aEscribir).toEqual([]);
    expect(r.sinColumna).toHaveLength(2);
  });

  it("un encabezado que ni menciona esas columnas se trata como que faltan", () => {
    // `indexarColumnas` devuelve -1 para lo que no encuentra, pero un objeto sin
    // la clave tambien tiene que caer del lado seguro: nunca en la columna 0,
    // que es el N° de RI.
    const r = columnasAManoAEscribir({}, { prioridad: "URGENTE", empresa: "" });
    expect(r.aEscribir).toEqual([]);
    expect(r.sinColumna).toHaveLength(1);
  });
});

describe("que pestaña es la de un area", () => {
  it("las pestañas por area empiezan con 'RI '", () => {
    // Es el mismo prefijo con el que la importacion elige que leer, y la
    // importacion es quien escribe `hoja_origen`.
    expect(esPestanaDeArea("RI MANTENIMIENTO")).toBe(true);
    expect(esPestanaDeArea("RI ALMACÉN")).toBe(true);
  });

  it("el master no es una pestaña de area", () => {
    expect(esPestanaDeArea("Requerimientos internos")).toBe(false);
  });

  it("la hoja de respuestas del formulario tampoco", () => {
    // Es lo que rompia el criterio viejo (`!== master`): el alta guarda esta
    // hoja en `hoja_origen`, y ahi las columnas N a R son las que escribe
    // Google, no las de compra. Escribirlas seria pisar datos del formulario.
    expect(esPestanaDeArea("Respuestas de formulario 1")).toBe(false);
  });

  it("no alcanza con empezar con las letras: 'RI' pegado a otra cosa no es un area", () => {
    expect(esPestanaDeArea("RIESGOS")).toBe(false);
    expect(esPestanaDeArea("RI")).toBe(false);
  });
});
