import { describe, it, expect } from "vitest";
import { empleadosDeLosSolicitantes, sueltosDespuesDeEnganchar } from "./catalogos";

const padron = [
  { id: "e-varela", nombre: "Francisco Enrique", apellido: "VARELA" },
  { id: "e-strupp", nombre: "Bernardo Miguel", apellido: "STRUPP" },
  { id: "e-ortiz", nombre: "FACUNDO JOEL", apellido: "ORTIZ" },
];

describe("enganchar la lista del panol con el padron", () => {
  it("reconoce a los que estan", () => {
    expect(
      empleadosDeLosSolicitantes(
        [{ id: "s-1", nombre: "VARELA, Francisco Enrique", destino_id: "d", empleado_id: null }],
        padron
      )
    ).toEqual([{ id: "s-1", empleado_id: "e-varela" }]);
  });

  /**
   * "STRUPP , Bernardo Miguel" tiene un espacio de mas antes de la coma, y va
   * asi a proposito: es lo que la validacion de la planilla acepta. Que este
   * mal escrito no puede impedir reconocerlo.
   */
  it("el espacio de mas de la planilla no lo esconde", () => {
    expect(
      empleadosDeLosSolicitantes(
        [{ id: "s-2", nombre: "STRUPP , Bernardo Miguel", destino_id: "d", empleado_id: null }],
        padron
      )
    ).toEqual([{ id: "s-2", empleado_id: "e-strupp" }]);
  });

  /** Los contratistas y "REGULADOR" no son empleados y no tienen por que serlo. */
  it("lo que no esta en el padron queda suelto, no enganchado a un parecido", () => {
    expect(
      empleadosDeLosSolicitantes(
        [
          { id: "s-3", nombre: "REGULADOR", destino_id: "d", empleado_id: null },
          { id: "s-4", nombre: "Omar Piparo", destino_id: "d", empleado_id: null },
        ],
        padron
      )
    ).toEqual([]);
  });

  /**
   * Puede haberlo enlazado una persona a mano, y el reconocimiento automatico
   * no tiene por que saber mas que ella.
   */
  it("uno ya enganchado no se vuelve a tocar", () => {
    expect(
      empleadosDeLosSolicitantes(
        [{ id: "s-5", nombre: "VARELA, Francisco Enrique", destino_id: "d", empleado_id: "otro" }],
        padron
      )
    ).toEqual([]);
  });

  it("con el padron vacio no engancha nada y no rompe", () => {
    expect(
      empleadosDeLosSolicitantes(
        [{ id: "s-6", nombre: "VARELA, Francisco Enrique", destino_id: null, empleado_id: null }],
        []
      )
    ).toEqual([]);
  });

  it("devuelve solo los que cambian", () => {
    const cambios = empleadosDeLosSolicitantes(
      [
        { id: "s-7", nombre: "ORTIZ, FACUNDO JOEL", destino_id: null, empleado_id: null },
        { id: "s-8", nombre: "REGULADOR", destino_id: null, empleado_id: null },
        { id: "s-9", nombre: "STRUPP , Bernardo Miguel", destino_id: null, empleado_id: "ya" },
      ],
      padron
    );
    expect(cambios).toEqual([{ id: "s-7", empleado_id: "e-ortiz" }]);
  });
});

/**
 * Los nombres y no el conteo: son cinco contra 64 en la base, y cuales son es
 * lo que decide si hay algo que arreglar. Estos son los cinco de verdad.
 */
describe("los que quedan sin empleado del padron", () => {
  const lista = [
    { id: "s-1", nombre: "REGULADOR", empleado_id: null, activo: true },
    { id: "s-2", nombre: "Omar Piparo", empleado_id: null, activo: true },
    { id: "s-3", nombre: "MENGUILLO, Marcelo Daniel", empleado_id: null, activo: true },
    { id: "s-4", nombre: "VARELA, Francisco Enrique", empleado_id: "e-varela", activo: true },
  ];

  it("devuelve los nombres de los que siguen en null", () => {
    expect(sueltosDespuesDeEnganchar(lista, [])).toEqual([
      "MENGUILLO, Marcelo Daniel", "Omar Piparo", "REGULADOR",
    ]);
  });

  /**
   * El que se acaba de enganchar todavia tiene el null que se leyo de la base:
   * el update ya salio pero la fila en memoria no se volvio a pedir. Si no se
   * lo descuenta, el aviso lo nombra como pendiente en la misma corrida en que
   * se resolvio.
   */
  it("el que se acaba de enganchar no se nombra", () => {
    expect(
      sueltosDespuesDeEnganchar(lista, [{ id: "s-3", empleado_id: "e-menguillo" }])
    ).toEqual(["Omar Piparo", "REGULADOR"]);
  });

  /** Alguien lo dio de baja a proposito: mandar a arreglarlo es ruido. */
  it("uno dado de baja no es un pendiente", () => {
    expect(
      sueltosDespuesDeEnganchar(
        [{ id: "s-5", nombre: "Mariano Const", empleado_id: null, activo: false }],
        []
      )
    ).toEqual([]);
  });

  it("con todos enganchados no dice nada, que es lo que apaga el aviso", () => {
    expect(sueltosDespuesDeEnganchar([lista[3]], [])).toEqual([]);
  });
});
