import { describe, it, expect } from "vitest";
import { areaPorDefecto } from "./areaDelUsuario";

/**
 * El area del RI viene puesta con la de quien pide, y se puede cambiar: el area
 * que quede es la que decide quien lo ve en «Mis pedidos», asi que alguien de
 * Mantenimiento pidiendo para Produccion es un caso legitimo.
 *
 * Esta funcion solo decide con cual arrancar.
 */
describe("con que area arranca un pedido", () => {
  it("con la suya, si tiene una", () => {
    expect(areaPorDefecto(["mantenimiento"])).toBe("mantenimiento");
  });

  /**
   * Sin area no se inventa ninguna. Al 18/10/2026 son once de catorce
   * usuarios: hasta que alguien se las asigne, el campo se elige a mano como
   * hasta ahora.
   */
  it("sin ninguna, vacio", () => {
    expect(areaPorDefecto([])).toBe("");
  });

  /**
   * Con dos, tampoco: adivinar cual de las dos es peor que preguntar, y un
   * area equivocada le esconde el pedido a quien tenia que verlo.
   */
  it("con mas de una, vacio: se elige a mano", () => {
    expect(areaPorDefecto(["mantenimiento", "produccion"])).toBe("");
  });

  it("no se deja confundir por vacios ni repetidos", () => {
    expect(areaPorDefecto(["", "  ", "almacen"])).toBe("almacen");
    expect(areaPorDefecto(["almacen", "almacen"])).toBe("almacen");
  });
});
