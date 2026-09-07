import { describe, it, expect } from "vitest";
import { totalesDeDespacho, roturaTotal, desajustesDeKilos } from "./despachos";
import type { Despacho } from "./types";

const base: Despacho = {
  id: "d-1", parte_id: "pa-1", orden: 1,
  equipo_raw: "Bailin", cliente_raw: "Guemes",
  producto_id: "p-cal-bolsa", producto_raw: "Cal en bolsas",
  kilos: 30000, bultos: 1200, envase_raw: "bolsa",
  pallets_cantidad: null, pallets_tipo: null,
  rotura_bolsa: 0, rotura_bolson: 0,
};

describe("los totales de un parte salen de los renglones", () => {
  it("suma los bultos por producto", () => {
    const t = totalesDeDespacho([
      base,
      { ...base, id: "d-2", orden: 2, bultos: 40, kilos: 1000 },
    ]);
    expect(t.despachado).toEqual({ "p-cal-bolsa": 1240 });
  });

  /** La rotura queda separada porque en el papel está separada. */
  it("la rotura de bolsa y la de bolson no se mezclan", () => {
    const t = totalesDeDespacho([
      { ...base, rotura_bolsa: 1 },
      { ...base, id: "d-2", orden: 2, rotura_bolson: 2 },
    ]);
    expect(t.roturaBolsa).toEqual({ "p-cal-bolsa": 1 });
    expect(t.roturaBolson).toEqual({ "p-cal-bolsa": 2 });
    expect(roturaTotal(t)).toEqual({ "p-cal-bolsa": 3 });
  });

  /**
   * El papel tiene un renglón "Otros" y nombres escritos a mano. Un renglón sin
   * producto reconocido no se suma a ninguno —sumarlo al parecido pone el dato
   * en el lugar que no es— pero tampoco se pierde: sale listado.
   */
  it("un renglon sin producto no se suma pero no se pierde", () => {
    const suelto = { ...base, id: "d-3", orden: 3, producto_id: null, producto_raw: "Otros: cal" };
    const t = totalesDeDespacho([base, suelto]);
    expect(t.despachado).toEqual({ "p-cal-bolsa": 1200 });
    expect(t.sinProducto.map((d) => d.id)).toEqual(["d-3"]);
  });

  it("un renglon sin bultos no rompe la suma", () => {
    const t = totalesDeDespacho([{ ...base, bultos: null }]);
    expect(t.despachado).toEqual({ "p-cal-bolsa": 0 });
  });
});

describe("los kilos contra los bultos", () => {
  const kg = new Map<string, number | null>([["p-cal-bolsa", 25]]);

  it("1200 bolsas de 25 kg son 30.000 y no desajustan", () => {
    expect(desajustesDeKilos([base], kg)).toEqual([]);
  });

  /**
   * Caso real relevado del papel: 1.200 bolsas / 29.280 kg, 2,4% de diferencia.
   * Documentado a propósito: con la tolerancia del 5% (valor de calidad, no de
   * este archivo) este caso no dispara aviso.
   */
  it("el caso real de 29.280 kg contra 1200 bolsas no llega al 5% y no desajusta", () => {
    expect(desajustesDeKilos([{ ...base, id: "d-8", kilos: 29280 }], kg)).toEqual([]);
  });

  // Nota: 1200 bultos a 25 kg esperan 30.000 kg. El caso real relevado del
  // papel (1.200 bolsas / 29.280 kg) da 2,4% de diferencia y con la tolerancia
  // del 5% no dispara — por eso el renglón "que no cierra" de este test usa un
  // faltante mayor (25.000 kg, 16,7%), que sí supera la tolerancia.
  it("un renglon que no cierra sale listado con lo que se esperaba", () => {
    const malo = { ...base, id: "d-9", kilos: 25000 };
    expect(desajustesDeKilos([malo], kg)).toEqual([
      { despachoId: "d-9", bultos: 1200, kilos: 25000, kilosEsperados: 30000 },
    ]);
  });

  /** Sin kg por unidad no se puede comparar, y no se inventa un número. */
  it("un producto sin kg por unidad no se comprueba", () => {
    const sinKg = new Map<string, number | null>([["p-cal-bolsa", null]]);
    expect(desajustesDeKilos([{ ...base, kilos: 1 }], sinKg)).toEqual([]);
  });

  it("un renglon sin kilos o sin bultos no se comprueba", () => {
    expect(desajustesDeKilos([{ ...base, kilos: null }], kg)).toEqual([]);
    expect(desajustesDeKilos([{ ...base, bultos: null }], kg)).toEqual([]);
  });

  /**
   * `kg_por_unidad` en 0 no debería estar en el catálogo (nada pesa 0 kg la
   * unidad), pero si pasara no tiene que confundirse con "sin confirmar": son
   * dos motivos distintos para no poder comparar. Con 0 los esperados dan 0 y
   * el renglón se saltea por esa cuenta, no porque se lo trate como null.
   */
  it("un producto con kg por unidad en 0 tampoco se comprueba", () => {
    const kgCero = new Map<string, number | null>([["p-cal-bolsa", 0]]);
    expect(desajustesDeKilos([{ ...base, kilos: 1 }], kgCero)).toEqual([]);
  });
});
