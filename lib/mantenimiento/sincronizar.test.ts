import { describe, it, expect } from "vitest";
import { SINCRONIZACIONES, unaPorNumero, unaPorCelda, porQueFallaron } from "./sincronizar";
import { REGISTRO } from "@/lib/core/saludDeLasSincronizaciones";

/**
 * Los nombres de recurso son un contrato con afuera: van escritos en la
 * propiedad RECURSO del Apps Script de cada planilla y en la vista que dice
 * cuándo se actualizó cada cosa. Renombrar uno acá deja de funcionar allá, en
 * silencio y sin error.
 */
describe("los recursos que se sincronizan", () => {
  it("son los seis, con los nombres que espera el Apps Script", () => {
    expect(SINCRONIZACIONES.map((s) => s.recurso)).toEqual([
      "avisos",
      "ordenes",
      "ordenes-servicio",
      "comparativas",
      // `periodicas` se sumó el 29/10/2026 y **no** espeja ninguna planilla:
      // genera las OT de los mantenimientos programados. Va en esta lista
      // porque lo que la tiene que llamar es el mismo reloj, y al final porque
      // una OT recién creada todavía no está en el master.
      "periodicas",
      // `ciclos` se sumó el 12/11/2026 y es lo mismo por otro lado: genera la
      // OT siguiente de un ciclo encadenado cuando la anterior se cerró. Lee
      // los cierres, así que va después de `ordenes` sí o sí.
      "ciclos",
    ]);
  });

  /** Lo nuevo no puede pisar a lo que ya se espeja: las cuatro siguen primero. */
  it("las cuatro que espejan una planilla siguen yendo antes que las que generan", () => {
    const recursos = SINCRONIZACIONES.map((s) => s.recurso);
    const espejan = ["avisos", "ordenes", "ordenes-servicio", "comparativas"] as const;
    const generan = ["periodicas", "ciclos"] as const;
    for (const g of generan) {
      for (const e of espejan) {
        expect(recursos.indexOf(e)).toBeLessThan(recursos.indexOf(g));
      }
    }
  });

  /**
   * `ciclos` lee `fecha_cierre` y `estado` de las OT para saber si la anterior
   * del ciclo se cerró, y esos dos los trae `ordenes` de la planilla: al revés
   * generaría sobre el estado de la corrida pasada.
   */
  it("los ciclos van después de las órdenes", () => {
    const recursos = SINCRONIZACIONES.map((s) => s.recurso);
    expect(recursos.indexOf("ordenes")).toBeLessThan(recursos.indexOf("ciclos"));
  });

  it("las órdenes de servicio van antes que sus comparativas", () => {
    // Una cotización que apunta a una OS que todavía no existe queda colgada.
    const recursos = SINCRONIZACIONES.map((s) => s.recurso);
    expect(recursos.indexOf("ordenes-servicio")).toBeLessThan(recursos.indexOf("comparativas"));
  });

  it("cada una sabe correr", () => {
    for (const s of SINCRONIZACIONES) expect(typeof s.correr).toBe("function");
  });

  /**
   * ── EL LADO CIEGO DE `recursosSinDeclarar` ────────────────────────────────
   *
   * Aquella función mira **lo que la vista trae** y nombra lo que no está
   * declarado. Eso atrapa «escribe sin declararse» y no puede atrapar lo
   * contrario: **un recurso que el cron corre y que nunca escribe una fila**
   * jamás llega a la vista, así que nunca lo nombra nadie.
   *
   * No es hipotético. Medido el 17/11/2026 en producción: `periodicas` y
   * `ciclos` —las dos únicas entradas que **generan** en vez de espejar— no
   * llamaban a `registrarSincronizacion`, no tenían una sola fila en
   * `sincronizaciones` y no estaban en `REGISTRO`. O sea que el día que
   * `generarLasEncadenadas()` empezara a tirar en cada corrida, el único
   * síntoma habría sido que no nacen OT, en silencio — que es exactamente el
   * modo de falla que el ciclo entero existe para evitar: una OT que no nace
   * no se atrasa, así que `mant-atrasadas-por-fecha` tampoco puede verla.
   *
   * Este test cierra el círculo por el otro lado: va **del código a la tabla**
   * en vez de de la tabla al código.
   */
  it("cada recurso que el cron corre está declarado en el monitor de salud", () => {
    const declarados = new Set(
      REGISTRO.filter((e) => e.modulo === "mantenimiento").flatMap((e) => e.recursos)
    );
    const sinDeclarar = SINCRONIZACIONES.map((s) => s.recurso).filter((r) => !declarados.has(r));
    expect(sinDeclarar).toEqual([]);
  });
});

/**
 * Qué hace que la corrida de un generador se anote como fallida. La pregunta
 * que contesta no es «¿terminó el proceso?» sino **«¿nacieron las órdenes?»**,
 * y las dos se separan justo cuando la planilla no se deja escribir.
 */
describe("porQueFallaron", () => {
  it("sin fallas no hay nada que anotar", () => {
    expect(porQueFallaron([])).toBeNull();
  });

  /**
   * El caso que justifica que esto exista: el generador termina perfecto, no
   * tira ninguna excepción, y **no nació una sola orden**. Anotarlo como `ok`
   * deja la generación verde en el monitor mientras no genera nada.
   */
  it("un ciclo que no se pudo crear ya es una corrida fallida", () => {
    expect(porQueFallaron([{ error: "La planilla está calculando" }]))
      .toBe("1 no se pudieron crear: La planilla está calculando");
  });

  it("dice cuántos fueron y no repite el mismo motivo", () => {
    const mismo = "Google: 403 The caller does not have permission";
    expect(porQueFallaron([{ error: mismo }, { error: mismo }, { error: mismo }, { error: mismo }]))
      .toBe(`4 no se pudieron crear: ${mismo}`);
  });

  it("con motivos distintos los nombra a todos", () => {
    expect(porQueFallaron([{ error: "sin equipo" }, { error: "sin período" }]))
      .toBe("2 no se pudieron crear: sin equipo · sin período");
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
