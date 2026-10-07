import { describe, expect, it } from "vitest";
import {
  estadisticaDe,
  mallasDelPeriodo,
  muestrasPorMes,
  resumenPorProducto,
  serieDe,
  resolver,
  valorDe,
  type MuestraResuelta,
} from "./indicadores";
import { evaluarMuestra } from "./limites";
import type { Limite, Muestra, Retenido } from "./types";

const FILLER = "p1";
const CAL = "p2";

function muestra(parcial: Partial<Muestra> & { fecha: string }): Muestra {
  return {
    id: `m-${parcial.fecha}-${Math.random()}`,
    producto_id: FILLER,
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
    cargado_en: `${parcial.fecha}T10:00:00Z`,
    actualizado_por: null,
    actualizado_en: null,
    ...parcial,
  };
}

/** Una muestra con la humedad que se quiera, armada desde los pesos reales. */
function conHumedad(fecha: string, porCiento: number, producto_id = FILLER): Muestra {
  // (inicial − final) / (inicial − recipiente) = porCiento / 100
  return muestra({
    fecha,
    producto_id,
    humedad_p_recipiente: 0,
    humedad_p_inicial: 100,
    humedad_p_final: 100 - porCiento,
  });
}

/**
 * Pasa por `evaluarMuestra` a propósito en vez de armar el objeto plano a mano:
 * así estos tests fallan si la evaluación y los indicadores dejan de entenderse.
 */
function evaluar(m: Muestra, retenidos: Retenido[] = [], limites: Limite[] = []): MuestraResuelta {
  return resolver(m, evaluarMuestra(m, retenidos, limites));
}

describe("estadisticaDe", () => {
  it("devuelve promedio, mínimo, máximo y sobre cuántos", () => {
    expect(estadisticaDe([1, 2, 3])).toEqual({ n: 3, promedio: 2, minimo: 1, maximo: 3 });
  });

  /**
   * Un null es "no se midió", no un cero. Promediarlo como cero bajaría el
   * promedio en cada muestra donde esa determinación no se hizo.
   */
  it("los nulos no entran al promedio ni lo bajan", () => {
    expect(estadisticaDe([2, null, 4])).toEqual({ n: 2, promedio: 3, minimo: 2, maximo: 4 });
  });

  it("sin ningún dato no hay promedio, y lo dice con n en cero", () => {
    expect(estadisticaDe([null, undefined])).toEqual({
      n: 0,
      promedio: null,
      minimo: null,
      maximo: null,
    });
  });

  it("redondea a dos decimales", () => {
    expect(estadisticaDe([1, 2]).promedio).toBe(1.5);
    expect(estadisticaDe([1, 1, 2]).promedio).toBe(1.33);
  });
});

describe("valorDe", () => {
  const m = muestra({
    fecha: "2026-10-01",
    peso_vol_gramos: 299.668,
    peso_vol_volumen_cc: 330,
    granulometria_peso_muestra_g: 100,
  });
  const ev = evaluar(m, [
    { muestra_id: m.id, malla: 100, retenido_g: 2.5 },
    { muestra_id: m.id, malla: 200, retenido_g: 16.6 },
  ]);

  it("saca el valor de las tres determinaciones sueltas", () => {
    expect(valorDe(ev, { determinacion: "peso_volumetrico" })).toBe(908.08);
    expect(valorDe(ev, { determinacion: "humedad" })).toBeNull();
  });

  it("para la granulometría hace falta la malla, y distingue retenido de acumulado", () => {
    expect(valorDe(ev, { determinacion: "retenido", malla: 200 })).toBe(16.6);
    expect(valorDe(ev, { determinacion: "acumulado", malla: 200 })).toBe(19.1);
  });

  it("una malla que no se tamizó no tiene valor", () => {
    expect(valorDe(ev, { determinacion: "retenido", malla: 325 })).toBeNull();
  });
});

describe("serieDe", () => {
  it("ordena por fecha, de la más vieja a la más nueva", () => {
    const filas = [
      evaluar(conHumedad("2026-10-03", 3)),
      evaluar(conHumedad("2026-10-01", 1)),
      evaluar(conHumedad("2026-10-02", 2)),
    ];
    expect(serieDe(filas, { determinacion: "humedad" })).toEqual([
      { fecha: "2026-10-01", valor: 1 },
      { fecha: "2026-10-02", valor: 2 },
      { fecha: "2026-10-03", valor: 3 },
    ]);
  });

  /**
   * Una línea que baja a cero porque ese día no se midió es una mentira que se
   * lee de un vistazo y que el gráfico no puede desmentir.
   */
  it("las muestras sin ese dato no entran, en vez de entrar como cero", () => {
    const filas = [
      evaluar(conHumedad("2026-10-01", 1)),
      evaluar(muestra({ fecha: "2026-10-02", peso_vol_gramos: 300, peso_vol_volumen_cc: 330 })),
    ];
    const serie = serieDe(filas, { determinacion: "humedad" });
    expect(serie).toHaveLength(1);
    expect(serie[0].fecha).toBe("2026-10-01");
  });

  /** Dos muestras del mismo día son un caso real: promediarlas taparía la dispersión. */
  it("dos muestras del mismo día quedan las dos", () => {
    const filas = [evaluar(conHumedad("2026-10-01", 1)), evaluar(conHumedad("2026-10-01", 3))];
    expect(serieDe(filas, { determinacion: "humedad" })).toHaveLength(2);
  });
});

describe("mallasDelPeriodo", () => {
  it("junta las mallas de todas las muestras, ordenadas y sin repetir", () => {
    const a = muestra({ fecha: "2026-10-01", granulometria_peso_muestra_g: 100 });
    const b = muestra({ fecha: "2026-10-02", granulometria_peso_muestra_g: 100 });
    const filas = [
      evaluar(a, [
        { muestra_id: a.id, malla: 200, retenido_g: 1 },
        { muestra_id: a.id, malla: 50, retenido_g: 1 },
      ]),
      evaluar(b, [
        { muestra_id: b.id, malla: 325, retenido_g: 1 },
        { muestra_id: b.id, malla: 50, retenido_g: 1 },
      ]),
    ];
    expect(mallasDelPeriodo(filas)).toEqual([50, 200, 325]);
  });
});

describe("resumenPorProducto", () => {
  const productos = [
    { id: FILLER, nombre: "Filler 1" },
    { id: CAL, nombre: "Cal" },
  ];

  it("cuenta las muestras y promedia por producto", () => {
    const filas = [
      evaluar(conHumedad("2026-10-01", 1)),
      evaluar(conHumedad("2026-10-02", 3)),
      evaluar(conHumedad("2026-10-02", 2, CAL)),
    ];
    const r = resumenPorProducto(filas, productos);

    expect(r.map((x) => x.nombre)).toEqual(["Filler 1", "Cal"]);
    expect(r[0].muestras).toBe(2);
    expect(r[0].humedad).toEqual({ n: 2, promedio: 2, minimo: 1, maximo: 3 });
    expect(r[1].muestras).toBe(1);
  });

  /** Un renglón de ceros se lee como "dio cero" y lo que pasó es que no se ensayó. */
  it("un producto sin muestras no aparece", () => {
    const r = resumenPorProducto([evaluar(conHumedad("2026-10-01", 1))], productos);
    expect(r).toHaveLength(1);
    expect(r[0].nombre).toBe("Filler 1");
  });

  it("cuenta las que se fueron de límite", () => {
    const limites: Limite[] = [
      { id: "l1", producto_id: FILLER, determinacion: "humedad", malla: null, minimo: null, maximo: 2 },
    ];
    const filas = [
      evaluar(conHumedad("2026-10-01", 1), [], limites),
      evaluar(conHumedad("2026-10-02", 3), [], limites),
    ];
    expect(resumenPorProducto(filas, productos)[0].fueraDeLimite).toBe(1);
  });

  /** La cal útil vial tiene 3 filas con dato sobre 206 muestras en el archivo real. */
  it("una determinación que casi no se mide lo dice con su propio n", () => {
    const filas = [
      evaluar(conHumedad("2026-10-01", 1)),
      evaluar(conHumedad("2026-10-02", 2)),
      evaluar(muestra({ fecha: "2026-10-03", cal_util_ml_acido: 41, cal_util_peso_muestra_g: 3 })),
    ];
    const r = resumenPorProducto(filas, productos)[0];
    expect(r.muestras).toBe(3);
    expect(r.humedad.n).toBe(2);
    expect(r.calUtilVial.n).toBe(1);
    expect(r.calUtilVial.promedio).toBe(50.57);
  });
});

describe("muestrasPorMes", () => {
  it("agrupa por mes y ordena", () => {
    const filas = [
      evaluar(conHumedad("2026-10-01", 1)),
      evaluar(conHumedad("2026-09-28", 1)),
      evaluar(conHumedad("2026-10-03", 1)),
    ];
    expect(muestrasPorMes(filas)).toEqual([
      { mes: "2026-09", muestras: 1, fueraDeLimite: 0 },
      { mes: "2026-10", muestras: 2, fueraDeLimite: 0 },
    ]);
  });

  it("cuenta los desvíos del mes", () => {
    const limites: Limite[] = [
      { id: "l1", producto_id: FILLER, determinacion: "humedad", malla: null, minimo: null, maximo: 2 },
    ];
    const filas = [
      evaluar(conHumedad("2026-10-01", 5), [], limites),
      evaluar(conHumedad("2026-10-02", 1), [], limites),
    ];
    expect(muestrasPorMes(filas)[0]).toEqual({ mes: "2026-10", muestras: 2, fueraDeLimite: 1 });
  });
});
