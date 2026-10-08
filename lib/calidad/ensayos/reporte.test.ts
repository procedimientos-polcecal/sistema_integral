import { describe, expect, it } from "vitest";
import {
  armarReporte,
  comoSeEscribe,
  fechaDelReporte,
  filasParaMallas,
  FILAS_DEL_REPORTE,
  tituloDelJuego,
  type MuestraDelDia,
} from "./reporte";
import { evaluarMuestra } from "./limites";
import type { Limite, Muestra, Retenido } from "./types";

const FILLER1 = { id: "p1", nombre: "Filler 1", orden: 1 };
const CALCIO01 = { id: "p4", nombre: "Calcio 0-1", orden: 4 };
const CALCIO02 = { id: "p5", nombre: "Calcio 0-2", orden: 5 };
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

/** Una muestra tamizada sobre 100 g, que es lo que vuelve comprobables los %. */
function tamizada(
  id: string,
  producto: { id: string; nombre: string; orden: number },
  retenidos: Record<number, number>,
  extra: Partial<Muestra> = {}
): MuestraDelDia {
  const m = muestra({ id, producto_id: producto.id, granulometria_peso_muestra_g: 100, ...extra });
  return conDatos(
    m,
    producto,
    Object.entries(retenidos).map(([malla, g]) => ({
      muestra_id: id,
      malla: Number(malla),
      retenido_g: g,
    }))
  );
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

describe("filasParaMallas", () => {
  /**
   * Es lo que calidad ya escribe cuando el juego es otro: el retenido de cada
   * tamiz y un solo acumulado al final, como los bloques de la hoja `Calcio`.
   */
  it("un retenido por malla y un solo acumulado, al final", () => {
    expect(filasParaMallas([6, 7, 10, 12, 20, 50, 100, 200]).map((f) => f.etiqueta)).toEqual([
      "Ret #6 (%)",
      "Ret #7 (%)",
      "Ret #10 (%)",
      "Ret #12 (%)",
      "Ret #20 (%)",
      "Ret #50 (%)",
      "Ret #100 (%)",
      "Ret #200 (%)",
      "Acumulado en #200 (%)",
      "Peso volumétrico (g/l)",
      "Humedad bh (%)",
    ]);
  });

  it("ordena las mallas aunque lleguen desordenadas", () => {
    // Las dos últimas filas —peso volumétrico y humedad— no son de una malla.
    const deTamiz = filasParaMallas([200, 6, 50]).filter((f) => f.malla !== undefined);
    expect(deTamiz.map((f) => f.malla)).toEqual([6, 50, 200, 200]);
  });

  it("sin mallas quedan sólo el peso volumétrico y la humedad", () => {
    expect(filasParaMallas([]).map((f) => f.tipo)).toEqual(["peso_volumetrico", "humedad"]);
  });

  it("el acumulado del final va destacado", () => {
    const filas = filasParaMallas([6, 200]);
    expect(filas.filter((f) => f.destacada).map((f) => f.etiqueta)).toEqual([
      "Acumulado en #200 (%)",
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
    const r = armarReporte("2026-10-06", [
      tamizada("m1", FILLER1, { 50: 0.8, 100: 8, 200: 22.6, 325: 13.9 }, {
        peso_vol_gramos: 336.6,
        peso_vol_volumen_cc: 330,
      }),
    ]);

    expect(r.tablas).toHaveLength(1);
    expect(r.tablas[0].esElFormato).toBe(true);
    expect(r.tablas[0].columnas[0].celdas.map((c) => c?.valor ?? null)).toEqual([
      0.8, 8, 22.6, 31.4, 13.9, 45.3, 1020, null,
    ]);
  });

  /** El guión de la planilla: Cal no tamiza hasta #325 y esas dos filas quedan vacías. */
  it("una malla que no se tamizó queda en null, no en cero", () => {
    const r = armarReporte("2026-10-06", [tamizada("m2", FILLER1, { 50: 0, 100: 0, 200: 6.1 })]);
    const celdas = r.tablas[0].columnas[0].celdas.map((c) => c?.valor ?? null);

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
    const columnas = r.tablas[0].columnas;

    expect(columnas).toHaveLength(2);
    expect(columnas.map((c) => c.detalle)).toEqual(["Despacho mañana", "Despacho tarde"]);
    // Las dos humedades sobreviven: promediarlas daría 0,75 en una sola columna.
    expect(columnas.map((c) => c.celdas[7]?.valor)).toEqual([0.5, 1]);
  });

  it("las columnas van por el orden del catálogo", () => {
    const a = muestra({ id: "a", producto_id: KARTONSEC.id, humedad_p_inicial: 100, humedad_p_recipiente: 0, humedad_p_final: 99 });
    const b = muestra({ id: "b", producto_id: FILLER1.id, humedad_p_inicial: 100, humedad_p_recipiente: 0, humedad_p_final: 99 });
    const r = armarReporte("2026-10-06", [conDatos(a, KARTONSEC), conDatos(b, FILLER1)]);
    expect(r.tablas[0].columnas.map((c) => c.producto)).toEqual(["Filler 1", "Despacho a Kartonsec"]);
  });

  it("un día sin muestras no tiene ninguna tabla", () => {
    expect(armarReporte("2026-10-06", []).tablas).toEqual([]);
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
    expect(r.tablas[0].columnas[0].celdas[7]?.fuera).toBe("alto");
  });
});

describe("armarReporte — una tabla por juego de tamices", () => {
  /** Lo que pidió el usuario: un Calcio no entra en el formato y abre su tabla. */
  it("una muestra con otros tamices se va a su propia tabla", () => {
    const r = armarReporte("2026-10-06", [
      tamizada("f", FILLER1, { 50: 0.8, 100: 8, 200: 22.6, 325: 13.9 }),
      tamizada("c", CALCIO01, { 6: 0, 7: 0, 10: 0.3, 12: 1.1, 20: 19, 50: 30.9, 100: 9.1, 200: 6.9 }),
    ]);

    expect(r.tablas).toHaveLength(2);
    expect(r.tablas[0].esElFormato).toBe(true);
    expect(r.tablas[0].columnas.map((c) => c.producto)).toEqual(["Filler 1"]);

    expect(r.tablas[1].esElFormato).toBe(false);
    expect(r.tablas[1].mallas).toEqual([6, 7, 10, 12, 20, 50, 100, 200]);
    expect(r.tablas[1].columnas.map((c) => c.producto)).toEqual(["Calcio 0-1"]);
  });

  /**
   * Las mallas que antes se avisaban al pie ahora tienen su fila: eso es lo que
   * el formato único no podía mostrar.
   */
  it("la tabla del juego propio muestra todas sus mallas", () => {
    const r = armarReporte("2026-10-06", [
      tamizada("c", CALCIO01, { 6: 2, 20: 38, 200: 40 }),
    ]);

    const tabla = r.tablas[0];
    expect(tabla.filas.map((f) => f.etiqueta)).toEqual([
      "Ret #6 (%)",
      "Ret #20 (%)",
      "Ret #200 (%)",
      "Acumulado en #200 (%)",
      "Peso volumétrico (g/l)",
      "Humedad bh (%)",
    ]);
    expect(tabla.columnas[0].celdas.map((c) => c?.valor ?? null)).toEqual([2, 38, 40, 80, null, null]);
  });

  it("dos muestras con el mismo juego comparten tabla", () => {
    const juego = { 6: 0, 20: 20, 200: 30 };
    const r = armarReporte("2026-10-06", [
      tamizada("a", CALCIO01, juego),
      tamizada("b", CALCIO02, juego),
    ]);

    expect(r.tablas).toHaveLength(1);
    expect(r.tablas[0].columnas.map((c) => c.producto)).toEqual(["Calcio 0-1", "Calcio 0-2"]);
  });

  it("dos juegos distintos son dos tablas, aunque ninguno sea el formato", () => {
    const r = armarReporte("2026-10-06", [
      tamizada("a", CALCIO01, { 6: 0, 20: 20, 200: 30 }),
      tamizada("b", CALCIO02, { 6: 0, 12: 5, 20: 20, 200: 30 }),
    ]);

    expect(r.tablas).toHaveLength(2);
    expect(r.tablas.map((t) => t.mallas)).toEqual([
      [6, 20, 200],
      [6, 12, 20, 200],
    ]);
  });

  /**
   * Faltarle una malla al juego de siempre no la convierte en otra
   * granulometría: entra al formato y esa fila queda con el guión a la vista.
   */
  it("a una muestra fina le puede faltar una malla y sigue en el formato", () => {
    const r = armarReporte("2026-10-06", [tamizada("f", FILLER1, { 50: 0.8, 100: 8, 200: 22.6 })]);

    expect(r.tablas).toHaveLength(1);
    expect(r.tablas[0].esElFormato).toBe(true);
    expect(r.tablas[0].columnas[0].celdas[4]).toBeNull();
  });

  /** Sin granulometría el juego está vacío y cabe en el formato. */
  it("una muestra de sola humedad entra en la tabla del formato", () => {
    const m = muestra({
      id: "h",
      producto_id: FILLER1.id,
      humedad_p_recipiente: 0,
      humedad_p_inicial: 100,
      humedad_p_final: 99,
    });
    const r = armarReporte("2026-10-06", [conDatos(m, FILLER1)]);

    expect(r.tablas).toHaveLength(1);
    expect(r.tablas[0].esElFormato).toBe(true);
  });

  /** Si ese día no se ensayó ningún fino, la tabla del formato no se dibuja vacía. */
  it("sin muestras del formato no hay tabla del formato", () => {
    const r = armarReporte("2026-10-06", [tamizada("c", CALCIO01, { 6: 2, 20: 38, 200: 40 })]);

    expect(r.tablas).toHaveLength(1);
    expect(r.tablas[0].esElFormato).toBe(false);
  });

  it("las tablas propias van en el orden del catálogo de su primera muestra", () => {
    const r = armarReporte("2026-10-06", [
      tamizada("b", CALCIO02, { 6: 0, 12: 5, 200: 30 }),
      tamizada("a", CALCIO01, { 6: 0, 20: 20, 200: 30 }),
    ]);

    expect(r.tablas.map((t) => t.columnas[0].producto)).toEqual(["Calcio 0-1", "Calcio 0-2"]);
  });
});

describe("tituloDelJuego", () => {
  it("dice de qué malla a qué malla", () => {
    expect(tituloDelJuego([6, 7, 10, 200])).toBe("#6 a #200");
  });

  it("con una sola malla no dice un rango", () => {
    expect(tituloDelJuego([200])).toBe("#200");
  });

  it("sin mallas lo dice", () => {
    expect(tituloDelJuego([])).toBe("Sin granulometría");
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
