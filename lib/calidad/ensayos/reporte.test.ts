import { describe, expect, it } from "vitest";
import {
  armarReporte,
  comoSeEscribe,
  fechaDelReporte,
  FILAS_DEL_REPORTE,
  type MuestraDelDia,
} from "./reporte";
import { evaluarMuestra } from "./limites";
import type { Limite, Muestra, Retenido } from "./types";

const FILLER1 = { id: "p1", nombre: "Filler 1", orden: 1 };
const KARTONSEC = { id: "p8", nombre: "Despacho a Kartonsec", orden: 8 };

function muestra(parcial: Partial<Muestra> & { id: string; producto_id: string }): Muestra {
  return {
    fecha: "2026-10-06",
    observaciones: null,
    humedad_p_recipiente: null,
    humedad_p_inicial: null,
    humedad_p_final: null,
    peso_vol_gramos: null,
    peso_vol_volumen_cc: null,
    cal_util_ml_acido: null,
    cal_util_peso_muestra_g: null,
    granulometria_peso_muestra_g: null,
    cargado_por: null,
    cargado_en: "2026-10-06T10:00:00Z",
    actualizado_por: null,
    actualizado_en: null,
    ...parcial,
  };
}

function conDatos(
  m: Muestra,
  producto: { id: string; nombre: string; orden: number },
  retenidos: Retenido[] = [],
  limites: Limite[] = []
): MuestraDelDia {
  return { muestra: m, evaluada: evaluarMuestra(m, retenidos, limites), producto };
}

describe("FILAS_DEL_REPORTE", () => {
  /** El orden de la planilla: cada acumulado pegado debajo de su retenido. */
  it("son las ocho de la planilla, en su orden", () => {
    expect(FILAS_DEL_REPORTE.map((f) => f.etiqueta)).toEqual([
      "Ret #50 (%)",
      "Ret #100 (%)",
      "Ret #200 (%)",
      "Acumulado en #200 (%)",
      "Ret #325 (%)",
      "Acumulado en #325 (%)",
      "Peso volumétrico (g/l)",
      "Humedad bh (%)",
    ]);
  });

  it("los acumulados van destacados, como en la planilla", () => {
    expect(FILAS_DEL_REPORTE.filter((f) => f.destacada).map((f) => f.etiqueta)).toEqual([
      "Acumulado en #200 (%)",
      "Acumulado en #325 (%)",
    ]);
  });
});

describe("armarReporte", () => {
  /**
   * La columna de Filler 1 del reporte del 06/10/2026 que trajo el usuario:
   * 0,8 · 8 · 22,6 · 31,4 · 13,9 · 45,3 · 1020 · 0,57%. Reconstruida en gramos
   * sobre 100 g, que es lo que la vuelve comprobable.
   */
  it("arma la columna entera de una muestra, con los acumulados despejados", () => {
    const m = muestra({
      id: "m1",
      producto_id: FILLER1.id,
      granulometria_peso_muestra_g: 100,
      peso_vol_gramos: 336.6,
      peso_vol_volumen_cc: 330,
    });
    const r = armarReporte("2026-10-06", [
      conDatos(m, FILLER1, [
        { muestra_id: "m1", malla: 50, retenido_g: 0.8 },
        { muestra_id: "m1", malla: 100, retenido_g: 8 },
        { muestra_id: "m1", malla: 200, retenido_g: 22.6 },
        { muestra_id: "m1", malla: 325, retenido_g: 13.9 },
      ]),
    ]);

    const celdas = r.columnas[0].celdas.map((c) => c?.valor ?? null);
    expect(celdas).toEqual([0.8, 8, 22.6, 31.4, 13.9, 45.3, 1020, null]);
  });

  /** El guión de la planilla: Cal no tamiza hasta #325 y esas dos filas quedan vacías. */
  it("una malla que no se tamizó queda en null, no en cero", () => {
    const m = muestra({ id: "m2", producto_id: FILLER1.id, granulometria_peso_muestra_g: 100 });
    const r = armarReporte("2026-10-06", [
      conDatos(m, FILLER1, [
        { muestra_id: "m2", malla: 50, retenido_g: 0 },
        { muestra_id: "m2", malla: 100, retenido_g: 0 },
        { muestra_id: "m2", malla: 200, retenido_g: 6.1 },
      ]),
    ]);

    const celdas = r.columnas[0].celdas.map((c) => c?.valor ?? null);
    expect(celdas[2]).toBe(6.1);
    expect(celdas[3]).toBe(6.1);
    expect(celdas[4]).toBeNull();
    expect(celdas[5]).toBeNull();
  });

  /**
   * El caso que el usuario describió: dos despachos el mismo día, uno al
   * mediodía y otro a la tarde. Dos columnas, no un promedio.
   */
  it("dos muestras del mismo producto son dos columnas, distinguidas por la observación", () => {
    const manana = muestra({
      id: "a",
      producto_id: KARTONSEC.id,
      observaciones: "Despacho mañana",
      cargado_en: "2026-10-06T12:00:00Z",
      humedad_p_recipiente: 0,
      humedad_p_inicial: 100,
      humedad_p_final: 99.5,
    });
    const tarde = muestra({
      id: "b",
      producto_id: KARTONSEC.id,
      observaciones: "Despacho tarde",
      cargado_en: "2026-10-06T18:00:00Z",
      humedad_p_recipiente: 0,
      humedad_p_inicial: 100,
      humedad_p_final: 99,
    });

    const r = armarReporte("2026-10-06", [conDatos(tarde, KARTONSEC), conDatos(manana, KARTONSEC)]);

    expect(r.columnas).toHaveLength(2);
    expect(r.columnas.map((c) => c.detalle)).toEqual(["Despacho mañana", "Despacho tarde"]);
    // Las dos humedades sobreviven: promediarlas daría 0,75 en una sola columna.
    expect(r.columnas.map((c) => c.celdas[7]?.valor)).toEqual([0.5, 1]);
  });

  it("las columnas van por el orden del catálogo", () => {
    const a = muestra({ id: "a", producto_id: KARTONSEC.id, humedad_p_inicial: 100, humedad_p_recipiente: 0, humedad_p_final: 99 });
    const b = muestra({ id: "b", producto_id: FILLER1.id, humedad_p_inicial: 100, humedad_p_recipiente: 0, humedad_p_final: 99 });
    const r = armarReporte("2026-10-06", [conDatos(a, KARTONSEC), conDatos(b, FILLER1)]);
    expect(r.columnas.map((c) => c.producto)).toEqual(["Filler 1", "Despacho a Kartonsec"]);
  });

  /** Un Calcio tamiza desde #6: esas mallas no entran en este formato y se avisan. */
  it("avisa qué mallas de la muestra no entran en el formato", () => {
    const m = muestra({ id: "c", producto_id: FILLER1.id, granulometria_peso_muestra_g: 20 });
    const r = armarReporte("2026-10-06", [
      conDatos(m, FILLER1, [
        { muestra_id: "c", malla: 6, retenido_g: 0 },
        { muestra_id: "c", malla: 20, retenido_g: 4 },
        { muestra_id: "c", malla: 200, retenido_g: 1 },
      ]),
    ]);
    expect(r.columnas[0].mallasQueNoEntran).toEqual([6, 20]);
  });

  it("un día sin muestras da un reporte sin columnas", () => {
    expect(armarReporte("2026-10-06", []).columnas).toEqual([]);
  });

  /** Un desvío no se pierde al pasar al reporte: la celda llega con su `fuera`. */
  it("la celda conserva el fuera de límite", () => {
    const m = muestra({
      id: "d",
      producto_id: FILLER1.id,
      humedad_p_recipiente: 0,
      humedad_p_inicial: 100,
      humedad_p_final: 97,
    });
    const limites: Limite[] = [
      { id: "l", producto_id: FILLER1.id, determinacion: "humedad", malla: null, minimo: null, maximo: 1 },
    ];
    const r = armarReporte("2026-10-06", [conDatos(m, FILLER1, [], limites)]);
    expect(r.columnas[0].celdas[7]?.fuera).toBe("alto");
  });
});

describe("comoSeEscribe", () => {
  const retenido = FILAS_DEL_REPORTE[0];
  const humedad = FILAS_DEL_REPORTE[7];
  const pesoVol = FILAS_DEL_REPORTE[6];

  /** El guión de la planilla: un cero ahí se leería como que dio cero. */
  it("lo que no se midió es un guión, no un cero", () => {
    expect(comoSeEscribe(retenido, null)).toBe("-");
    expect(comoSeEscribe(humedad, { valor: null })).toBe("-");
  });

  it("un cero medido se escribe como cero", () => {
    expect(comoSeEscribe(retenido, { valor: 0 })).toBe("0");
  });

  /** Son valores de menos de 1: sin dos decimales se verían todos iguales. */
  it("la humedad va con dos decimales y el signo de porcentaje", () => {
    expect(comoSeEscribe(humedad, { valor: 0.57 })).toBe("0,57%");
    expect(comoSeEscribe(humedad, { valor: 0.6 })).toBe("0,60%");
  });

  it("el peso volumétrico va entero", () => {
    expect(comoSeEscribe(pesoVol, { valor: 1020.4 })).toBe("1.020");
  });

  it("los retenidos van con un decimal, como la planilla", () => {
    expect(comoSeEscribe(retenido, { valor: 22.6 })).toBe("22,6");
    expect(comoSeEscribe(retenido, { valor: 8 })).toBe("8");
  });
});

describe("fechaDelReporte", () => {
  it("va en d/m/a, como todo el sistema", () => {
    expect(fechaDelReporte("2026-10-06")).toBe("06/10/2026");
  });
});
