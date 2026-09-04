import { describe, it, expect } from "vitest";
import { SINCRONIZACIONES, unaPorNumero, unaPorCelda } from "./sincronizar";

/**
 * Los nombres de recurso son un contrato con afuera: van escritos en la
 * propiedad RECURSO del Apps Script de cada planilla y en la vista que dice
 * cuándo se actualizó cada cosa. Renombrar uno acá deja de funcionar allá, en
 * silencio y sin error.
 */
describe("los recursos que se sincronizan", () => {
  it("son los cuatro, con los nombres que espera el Apps Script", () => {
    expect(SINCRONIZACIONES.map((s) => s.recurso)).toEqual([
      "avisos",
      "ordenes",
      "ordenes-servicio",
      "comparativas",
    ]);
  });

  it("las órdenes de servicio van antes que sus comparativas", () => {
    // Una cotización que apunta a una OS que todavía no existe queda colgada.
    const recursos = SINCRONIZACIONES.map((s) => s.recurso);
    expect(recursos.indexOf("ordenes-servicio")).toBeLessThan(recursos.indexOf("comparativas"));
  });

  it("cada una sabe correr", () => {
    for (const s of SINCRONIZACIONES) expect(typeof s.correr).toBe("function");
  });
});

/**
 * Un `upsert` cuyo lote trae dos filas con la misma clave hace que Postgres
 * aborte el lote entero: "ON CONFLICT DO UPDATE command cannot affect row a
 * second time". Un numero repetido en la planilla dejaba sin sincronizar las
 * otras 1.760 ordenes, y el mensaje no decia cual era.
 */
describe("una sola fila por numero antes del upsert", () => {
  const ot = (ot_number: number, descripcion: string) => ({ ot_number, descripcion });

  it("sin repetidos no toca nada", () => {
    const r = unaPorNumero([ot(1, "a"), ot(2, "b")], "ot_number");
    expect(r.unicos).toHaveLength(2);
    expect(r.repetidos).toEqual([]);
  });

  /** En una planilla el trabajo nuevo se agrega al final: gana la de abajo. */
  it("con dos filas del mismo numero gana la ultima", () => {
    const r = unaPorNumero([ot(2381, "la de arriba"), ot(2381, "la de abajo")], "ot_number");
    expect(r.unicos).toEqual([ot(2381, "la de abajo")]);
    expect(r.repetidos).toEqual([2381]);
  });

  it("no se elige en silencio: informa cuales estaban repetidos", () => {
    const r = unaPorNumero(
      [ot(5, "a"), ot(1, "b"), ot(5, "c"), ot(3, "d"), ot(1, "e")],
      "ot_number"
    );
    expect(r.unicos).toHaveLength(3);
    expect(r.repetidos).toEqual([1, 5]);
  });

  it("tres veces el mismo numero se informa una sola vez", () => {
    const r = unaPorNumero([ot(7, "a"), ot(7, "b"), ot(7, "c")], "ot_number");
    expect(r.unicos).toEqual([ot(7, "c")]);
    expect(r.repetidos).toEqual([7]);
  });

  it("conserva el orden de aparicion de los que quedan", () => {
    const r = unaPorNumero([ot(9, "a"), ot(4, "b"), ot(9, "c")], "ot_number");
    expect(r.unicos.map((o) => o.ot_number)).toEqual([9, 4]);
  });

  it("sirve para cualquier clave, no solo las OT", () => {
    const avisos = [{ oa_number: 3, texto: "x" }, { oa_number: 3, texto: "y" }];
    expect(unaPorNumero(avisos, "oa_number").unicos).toEqual([{ oa_number: 3, texto: "y" }]);
  });

  it("con la lista vacia no inventa nada", () => {
    expect(unaPorNumero([], "ot_number")).toEqual({ unicos: [], repetidos: [] });
  });
});

/**
 * Las comparativas no se espejan por numero sino por la celda de la planilla de
 * la que salieron: `(sheets_tab, sheets_row)`, que es la clave unica que la
 * tabla trae del esquema original. Varias filas pueden tener el mismo N° de OS
 * —son las ofertas que se comparan— asi que el numero no identifica nada.
 *
 * La dedupe hace falta por lo mismo que en las otras tres: un upsert cuyo lote
 * trae dos veces la misma clave aborta EL LOTE ENTERO con "ON CONFLICT DO
 * UPDATE command cannot affect row a second time", y ahi se pierden las 152
 * cotizaciones por una celda leida dos veces.
 */
describe("una sola fila por celda antes del upsert", () => {
  const cot = (sheets_tab: string, sheets_row: number, proveedor: string) =>
    ({ sheets_tab, sheets_row, proveedor });

  it("sin repetidos no toca nada", () => {
    const r = unaPorCelda([cot("Compresores", 4, "a"), cot("Compresores", 5, "b")]);
    expect(r.unicos).toHaveLength(2);
    expect(r.repetidos).toEqual([]);
  });

  it("la misma celda dos veces deja una sola, y gana la ultima", () => {
    const r = unaPorCelda([cot("Molienda de cal", 9, "vieja"), cot("Molienda de cal", 9, "nueva")]);
    expect(r.unicos).toEqual([cot("Molienda de cal", 9, "nueva")]);
    expect(r.repetidos).toEqual(["Molienda de cal!9"]);
  });

  it("la misma fila en dos pestañas distintas no es la misma celda", () => {
    // Cada pestaña tiene su propia numeracion de filas: confundirlas seria
    // tirar una cotizacion de otro sector.
    const r = unaPorCelda([cot("Compresores", 7, "a"), cot("Hidratacion", 7, "b")]);
    expect(r.unicos).toHaveLength(2);
    expect(r.repetidos).toEqual([]);
  });

  it("no se elige en silencio: dice que celdas estaban repetidas", () => {
    const r = unaPorCelda([
      cot("Calcinación", 3, "a"), cot("Compresores", 8, "b"),
      cot("Calcinación", 3, "c"), cot("Compresores", 8, "d"),
    ]);
    expect(r.unicos).toHaveLength(2);
    expect(r.repetidos).toEqual(["Calcinación!3", "Compresores!8"]);
  });

  it("conserva el orden de aparicion de las que quedan", () => {
    const r = unaPorCelda([cot("Otros", 2, "a"), cot("Otros", 1, "b"), cot("Otros", 2, "c")]);
    expect(r.unicos.map((c) => c.sheets_row)).toEqual([2, 1]);
  });
});
