import { describe, it, expect } from "vitest";
import { empleadosDeLosSolicitantes } from "./catalogos";

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
