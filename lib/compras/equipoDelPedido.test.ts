import { describe, it, expect } from "vitest";
import { equipoDelPedido, esDelEquipo } from "./equipoDelPedido";

const MOLINO = "eq-molino";
const GALPON = "eq-galpon";

describe("de donde sale el equipo de un pedido", () => {
  it("el declarado le gana a la inferencia por ubicacion", () => {
    // Es el caso de la columna nueva: la persona contesta sobre su propio
    // pedido y eso vale mas que deducirlo de donde se lo entrega.
    expect(
      equipoDelPedido({ equipo_raw: "Molino Calera", equipo_id: MOLINO, ubicacion_equipo_id: GALPON })
    ).toEqual({ id: MOLINO, origen: "declarado", texto: "Molino Calera" });
  });

  it("sin declarado sigue infiriendo por la ubicacion", () => {
    // Los 1.968 pedidos anteriores a la columna. Si el declarado reemplazara a
    // la inferencia en vez de anteponerse, el filtro y el tablero se habrian
    // vaciado de golpe el dia que se agrego la columna.
    expect(equipoDelPedido({ ubicacion_equipo_id: GALPON })).toEqual({
      id: GALPON,
      origen: "ubicacion",
      texto: null,
    });
  });

  it("un equipo declarado que no se pudo enlazar NO cae en la inferencia", () => {
    // La persona ya contesto. Taparlo con una deduccion mostraria un equipo que
    // nadie dijo, que es el error que no se nota: el dato aparece en el lugar
    // que no es y nadie sospecha de un valor plausible.
    expect(
      equipoDelPedido({ equipo_raw: "molino viejo", equipo_id: null, ubicacion_equipo_id: GALPON })
    ).toEqual({ id: null, origen: "declarado-sin-enlazar", texto: "molino viejo" });
  });

  it("sin nada, nada", () => {
    expect(equipoDelPedido({})).toEqual({ id: null, origen: "ninguno", texto: null });
    expect(equipoDelPedido({ equipo_raw: "   ", ubicacion_equipo_id: null })).toEqual({
      id: null,
      origen: "ninguno",
      texto: null,
    });
  });

  it("el texto declarado se conserva aunque haya enlace", () => {
    // Es lo que permite mostrar en la ficha lo que la persona escribio, sin
    // reemplazarlo por el nombre del catalogo.
    expect(equipoDelPedido({ equipo_raw: "  Molino  ", equipo_id: MOLINO }).texto).toBe("Molino");
  });
});

describe("si un pedido cuenta para un equipo", () => {
  it("cuenta por el declarado", () => {
    expect(esDelEquipo({ equipo_id: MOLINO }, MOLINO)).toBe(true);
  });

  it("cuenta por la ubicacion cuando no declaro nada", () => {
    expect(esDelEquipo({ ubicacion_equipo_id: GALPON }, GALPON)).toBe(true);
  });

  it("un pedido declarado para otro equipo NO entra por su ubicacion", () => {
    // Sin esta mitad, un pedido declarado para el molino seguiria sumando al
    // equipo del galpon donde se lo entrega, y el gasto por equipo dejaria de
    // querer decir lo que dice.
    expect(esDelEquipo({ equipo_id: MOLINO, ubicacion_equipo_id: GALPON }, GALPON)).toBe(false);
    expect(esDelEquipo({ equipo_id: MOLINO, ubicacion_equipo_id: GALPON }, MOLINO)).toBe(true);
  });

  it("uno declarado sin enlazar no cuenta para nadie", () => {
    expect(esDelEquipo({ equipo_raw: "molino viejo", ubicacion_equipo_id: GALPON }, GALPON)).toBe(false);
  });
});
