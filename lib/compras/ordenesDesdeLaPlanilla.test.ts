import { describe, it, expect } from "vitest";
import {
  lasQuePasaronAPedido,
  loQueFaltaParaLaOrden,
  repartirLasOrdenes,
  TOPE_POR_CORRIDA,
  type RequerimientoParaLaOrden,
} from "./ordenesDesdeLaPlanilla";
import type { EstadoCompra } from "./types";

const ri = (n: number, extra: Partial<RequerimientoParaLaOrden> = {}): RequerimientoParaLaOrden => ({
  nro_ri: n,
  estado_compra: "PEDIDO",
  proveedor_id: "p-1",
  costo_iva: 1000,
  empresa_id: "e-1",
  paga_ambas: false,
  ...extra,
});

const antes = (pares: [number, EstadoCompra][]) =>
  new Map(pares.map(([n, e]) => [n, { estado_compra: e }]));

describe("cuáles pasaron a PEDIDO en esta corrida", () => {
  it("la que cambió de estado", () => {
    const r = lasQuePasaronAPedido(
      [{ nro_ri: 10, estado_compra: "PEDIDO" }],
      antes([[10, "PARA_COMPRAR"]])
    );
    expect(r).toEqual([10]);
  });

  /*
   * Lo que hace que esto no mande el pasado: hoy hay 119 requerimientos en
   * PEDIDO con todos los datos y sin orden. Son de antes de que el disparador
   * existiera y mandarlos es una decisión de alguien, no de un cron.
   */
  it("la que YA estaba en PEDIDO no entra, aunque no tenga orden", () => {
    const r = lasQuePasaronAPedido(
      [{ nro_ri: 10, estado_compra: "PEDIDO" }],
      antes([[10, "PEDIDO"]])
    );
    expect(r).toEqual([]);
  });

  it("un requerimiento nuevo que entra directo en PEDIDO sí entra", () => {
    expect(lasQuePasaronAPedido([{ nro_ri: 99, estado_compra: "PEDIDO" }], antes([]))).toEqual([99]);
  });

  it("los que van a otro estado no entran", () => {
    const r = lasQuePasaronAPedido(
      [
        { nro_ri: 1, estado_compra: "RECIBIDO" },
        { nro_ri: 2, estado_compra: "DENEGADO" },
        { nro_ri: 3, estado_compra: "PEDIDO" },
      ],
      antes([
        [1, "PEDIDO"],
        [2, "PEDIDO"],
        [3, "SIN_INICIAR"],
      ])
    );
    expect(r).toEqual([3]);
  });
});

describe("qué le falta para armar la orden", () => {
  it("nada, cuando están los tres datos", () => {
    expect(loQueFaltaParaLaOrden(ri(1))).toBeNull();
  });

  /*
   * El caso real y mayoritario: de las 66 transiciones a PEDIDO desde el 11/09,
   * 65 no tenían costo. La planilla marca PEDIDO antes de que alguien cargue el
   * precio.
   */
  it("sin costo no se manda: una orden en cero es peor que ninguna", () => {
    expect(loQueFaltaParaLaOrden(ri(1, { costo_iva: null }))).toBe("el costo");
    expect(loQueFaltaParaLaOrden(ri(1, { costo_iva: 0 }))).toBe("el costo");
  });

  it("sin proveedor tampoco", () => {
    expect(loQueFaltaParaLaOrden(ri(1, { proveedor_id: null }))).toBe("el proveedor");
  });

  it("sin empresa no se sabe a cuál de las dos contabilidades va", () => {
    expect(loQueFaltaParaLaOrden(ri(1, { empresa_id: null }))).toBe("la empresa que paga");
  });

  it("pero AMBAS sí define la empresa: son dos órdenes", () => {
    expect(loQueFaltaParaLaOrden(ri(1, { empresa_id: null, paga_ambas: true }))).toBeNull();
  });

  it("dice todo lo que falta, no sólo lo primero", () => {
    expect(loQueFaltaParaLaOrden(ri(1, { proveedor_id: null, costo_iva: null }))).toBe(
      "el proveedor, el costo"
    );
  });
});

describe("el reparto de una corrida", () => {
  it("separa las que se pueden de las que no", () => {
    const r = repartirLasOrdenes([ri(1), ri(2, { costo_iva: null }), ri(3)]);
    expect(r.aCrear).toEqual([1, 3]);
    expect(r.sinDatos).toEqual([{ nro_ri: 2, falta: "el costo" }]);
    expect(r.postergadas).toEqual([]);
  });

  /*
   * El orden importa: si el tope se aplicara antes de descartar, diez
   * requerimientos sin costo gastarían el cupo y dejarían afuera a los que sí
   * se podían mandar.
   */
  it("el tope se aplica DESPUÉS de descartar lo que no se puede armar", () => {
    const sinCosto = [1, 2, 3].map((n) => ri(n, { costo_iva: null }));
    const buenos = [10, 11].map((n) => ri(n));
    const r = repartirLasOrdenes([...sinCosto, ...buenos], 2);
    expect(r.aCrear).toEqual([10, 11]);
  });

  /*
   * Crear una orden escribe en la contabilidad real: una edición masiva en la
   * planilla no puede volverse doscientas órdenes sin que nadie lo decida.
   */
  it("corta en el tope y deja el resto anotado, no perdido", () => {
    const muchos = Array.from({ length: 25 }, (_, i) => ri(i + 1));
    const r = repartirLasOrdenes(muchos, 10);
    expect(r.aCrear).toHaveLength(10);
    expect(r.postergadas).toHaveLength(15);
    expect([...r.aCrear, ...r.postergadas]).toHaveLength(25);
  });

  it("posterga a los que recién entran, no a los que esperan hace más", () => {
    const r = repartirLasOrdenes([ri(50), ri(10), ri(30)], 2);
    expect(r.aCrear).toEqual([10, 30]);
    expect(r.postergadas).toEqual([50]);
  });

  it("el tope por defecto es holgado contra el ritmo real (~3 por día)", () => {
    expect(TOPE_POR_CORRIDA).toBeGreaterThanOrEqual(5);
    const r = repartirLasOrdenes(Array.from({ length: 3 }, (_, i) => ri(i + 1)));
    expect(r.postergadas).toEqual([]);
  });

  it("sin candidatos no hay nada que hacer", () => {
    expect(repartirLasOrdenes([])).toEqual({ aCrear: [], sinDatos: [], postergadas: [] });
  });
});
