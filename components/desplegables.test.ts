import { describe, expect, it } from "vitest";
import { createElement, Fragment, type ReactNode } from "react";
import { coincide, opcionesDeLosHijos, teclaQueAbre } from "./desplegables";

/**
 * Los hijos se arman con `createElement` y no con JSX porque vitest acá levanta
 * sólo `*.test.ts`. No es una pérdida: así queda a la vista la forma exacta en
 * la que React entrega cada caso —un arreglo, un `false`, un fragmento—, que es
 * justamente lo que se está probando.
 */
const opcion = (value: unknown, texto: ReactNode, extra?: Record<string, unknown>) =>
  createElement("option", { key: String(value), value, ...extra }, texto);

describe("coincide", () => {
  it("sin consulta, pasa todo: el desplegable recién abierto muestra la lista entera", () => {
    expect(coincide("Bolsas Olavarría", "")).toBe(true);
    expect(coincide("Bolsas Olavarría", "   ")).toBe(true);
  });

  it("ignora los acentos, que nadie escribe al buscar", () => {
    expect(coincide("Bolsas Olavarría", "olavarria")).toBe(true);
    expect(coincide("Bolsas Olavarria", "olavarría")).toBe(true);
  });

  it("ignora mayúsculas y minúsculas", () => {
    expect(coincide("Bolsas Olavarría", "BOLSAS")).toBe(true);
    expect(coincide("BOLSAS OLAVARRÍA", "bolsas")).toBe(true);
  });

  it("encuentra por un pedazo del medio", () => {
    expect(coincide("AMB-EM — Autoelevador XCMG", "autoele")).toBe(true);
    expect(coincide("AMB-EM — Autoelevador XCMG", "xcmg")).toBe(true);
  });

  it("acepta las palabras en cualquier orden", () => {
    // Lo que un `includes` pelado no hacía: quien busca se acuerda de dos
    // pedazos del nombre, no de cómo estaban ordenados.
    expect(coincide("Bolsas Olavarría", "olav bolsas")).toBe(true);
    expect(coincide("Bolsas Olavarría", "bolsas olav")).toBe(true);
  });

  it("exige que estén todas las palabras, no alguna", () => {
    expect(coincide("Bolsas Olavarría", "bolsas tandil")).toBe(false);
  });

  it("no se confunde con espacios de más", () => {
    expect(coincide("Bolsas Olavarría", "  bolsas   olav  ")).toBe(true);
  });

  it("dice que no cuando no está", () => {
    expect(coincide("Bolsas Olavarría", "cemento")).toBe(false);
  });
});

describe("opcionesDeLosHijos", () => {
  it("lee una lista escrita a mano", () => {
    const hijos = [opcion("", "Seleccionar…"), opcion("alta", "Alta"), opcion("baja", "Baja")];
    expect(opcionesDeLosHijos(hijos)).toEqual([
      { valor: "", etiqueta: "Seleccionar…", deshabilitada: false },
      { valor: "alta", etiqueta: "Alta", deshabilitada: false },
      { valor: "baja", etiqueta: "Baja", deshabilitada: false },
    ]);
  });

  it("entra en el arreglo que devuelve un .map(), que es como vienen las listas largas", () => {
    const empleados = [
      { id: "1", legajo: 10, apellido: "Pérez" },
      { id: "2", legajo: 11, apellido: "Gómez" },
    ];
    const hijos = [
      opcion("", "Seleccionar…"),
      empleados.map((e) => opcion(e.id, [e.legajo, " - ", e.apellido])),
    ];
    expect(opcionesDeLosHijos(hijos).map((o) => o.etiqueta)).toEqual([
      "Seleccionar…",
      "10 - Pérez",
      "11 - Gómez",
    ]);
  });

  it("pega los pedazos sueltos de una etiqueta", () => {
    // `{e.legajo} - {e.apellido}, {e.nombre}` llega como cinco nodos.
    const hijos = [opcion("1", [10, " - ", "Pérez", ", ", "Ana"])];
    expect(opcionesDeLosHijos(hijos)[0].etiqueta).toBe("10 - Pérez, Ana");
  });

  it("saltea los condicionales que no se cumplieron", () => {
    // Veinticinco desplegables del repo arman sus opciones con `{puede && …}`,
    // que devuelve `false` cuando no se cumple. Contarlos daría de más y movería
    // el corte de las diez.
    const puedeAnular = false;
    const hijos = [opcion("ok", "Aprobar"), puedeAnular && opcion("no", "Anular"), null, undefined];
    expect(opcionesDeLosHijos(hijos)).toEqual([
      { valor: "ok", etiqueta: "Aprobar", deshabilitada: false },
    ]);
  });

  it("entra en los fragmentos, que Children.toArray no abre", () => {
    const hijos = [
      opcion("", "Seleccionar…"),
      createElement(Fragment, null, opcion("a", "Uno"), opcion("b", "Dos")),
    ];
    expect(opcionesDeLosHijos(hijos).map((o) => o.valor)).toEqual(["", "a", "b"]);
  });

  it("entra en los fragmentos anidados", () => {
    const hijos = createElement(
      Fragment,
      null,
      createElement(Fragment, null, opcion("a", "Uno")),
      opcion("b", "Dos"),
    );
    expect(opcionesDeLosHijos(hijos).map((o) => o.valor)).toEqual(["a", "b"]);
  });

  it("un <option> sin value vale lo que dice, como lo resuelve el navegador", () => {
    const hijos = [createElement("option", { key: "Enero" }, "Enero")];
    expect(opcionesDeLosHijos(hijos)).toEqual([
      { valor: "Enero", etiqueta: "Enero", deshabilitada: false },
    ]);
  });

  it("se acuerda de cuál está deshabilitada", () => {
    const hijos = [opcion("a", "Uno"), opcion("b", "Dos", { disabled: true })];
    expect(opcionesDeLosHijos(hijos).map((o) => o.deshabilitada)).toEqual([false, true]);
  });

  it("ignora lo que no sea un <option>", () => {
    const hijos = [createElement("span", { key: "x" }, "hola"), opcion("a", "Uno")];
    expect(opcionesDeLosHijos(hijos).map((o) => o.valor)).toEqual(["a"]);
  });

  it("sin hijos, no hay opciones", () => {
    expect(opcionesDeLosHijos(null)).toEqual([]);
    expect(opcionesDeLosHijos([])).toEqual([]);
  });
});

describe("teclaQueAbre", () => {
  it("una letra abre y arranca la búsqueda con ella, en vez de perderse", () => {
    expect(teclaQueAbre({ key: "f" })).toBe("f");
    expect(teclaQueAbre({ key: "F" })).toBe("F");
    expect(teclaQueAbre({ key: "ñ" })).toBe("ñ");
    expect(teclaQueAbre({ key: "3" })).toBe("3");
  });

  it("las flechas y la barra abren sin escribir, como el nativo", () => {
    expect(teclaQueAbre({ key: "ArrowDown" })).toBe("");
    expect(teclaQueAbre({ key: "ArrowUp" })).toBe("");
    expect(teclaQueAbre({ key: " " })).toBe("");
  });

  /**
   * Sin esto, `Ctrl+C` sobre un desplegable abriría el panel y escribiría una
   * "c" en el buscador en vez de copiar.
   */
  it("con un modificador no abre: es un atajo, no algo que alguien escriba", () => {
    expect(teclaQueAbre({ key: "c", ctrlKey: true })).toBeNull();
    expect(teclaQueAbre({ key: "c", metaKey: true })).toBeNull();
    expect(teclaQueAbre({ key: "c", altKey: true })).toBeNull();
  });

  it("las teclas con nombre no abren", () => {
    for (const key of ["Enter", "Tab", "Escape", "Shift", "F3", "Backspace", "Home"]) {
      expect(teclaQueAbre({ key })).toBeNull();
    }
  });
});
