import { describe, expect, it } from "vitest";
import { evaluarMuestra, fueraDeLimite, limiteDe } from "./limites";
import type { Limite, Muestra } from "./types";

const PRODUCTO = "p1";

function muestraVacia(): Muestra {
  return {
    id: "m1",
    fecha: "2026-10-06",
    producto_id: PRODUCTO,
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
  };
}

function limite(parcial: Partial<Limite>): Limite {
  return {
    id: "l1",
    producto_id: PRODUCTO,
    determinacion: "humedad",
    malla: null,
    minimo: null,
    maximo: null,
    ...parcial,
  };
}

describe("fueraDeLimite", () => {
  it("sin límite cargado no dice nada: es el estado en que nace el módulo", () => {
    expect(fueraDeLimite(99, undefined)).toBeUndefined();
  });

  it("dentro no dice nada", () => {
    expect(fueraDeLimite(2, limite({ minimo: 1, maximo: 3 }))).toBeUndefined();
  });

  it("los extremos están adentro", () => {
    expect(fueraDeLimite(1, limite({ minimo: 1, maximo: 3 }))).toBeUndefined();
    expect(fueraDeLimite(3, limite({ minimo: 1, maximo: 3 }))).toBeUndefined();
  });

  it("marca de qué lado se fue", () => {
    expect(fueraDeLimite(3.1, limite({ minimo: 1, maximo: 3 }))).toBe("alto");
    expect(fueraDeLimite(0.9, limite({ minimo: 1, maximo: 3 }))).toBe("bajo");
  });

  it("un límite con un solo extremo controla sólo ese lado", () => {
    expect(fueraDeLimite(0.1, limite({ maximo: 3 }))).toBeUndefined();
    expect(fueraDeLimite(9, limite({ maximo: 3 }))).toBe("alto");
  });

  /** Un null es un dato que falta, no un desvío. */
  it("un valor que no se pudo calcular no está fuera de nada", () => {
    expect(fueraDeLimite(null, limite({ maximo: 3 }))).toBeUndefined();
  });
});

describe("limiteDe", () => {
  const limites = [
    limite({ id: "a", determinacion: "humedad", maximo: 1.5 }),
    limite({ id: "b", determinacion: "retenido", malla: 100, maximo: 6 }),
    limite({ id: "c", determinacion: "retenido", malla: 200, maximo: 25 }),
  ];

  it("encuentra el de una determinación sin malla", () => {
    expect(limiteDe(limites, "humedad", null)?.id).toBe("a");
  });

  it("la malla es parte de la identidad del límite", () => {
    expect(limiteDe(limites, "retenido", 200)?.id).toBe("c");
    expect(limiteDe(limites, "retenido", 325)).toBeUndefined();
  });
});

describe("evaluarMuestra", () => {
  it("con la tabla de límites vacía calcula todo y no marca nada", () => {
    const m = { ...muestraVacia(), peso_vol_gramos: 299.668, peso_vol_volumen_cc: 330 };
    const r = evaluarMuestra(m, [], []);
    expect(r.pesoVolumetrico.valor).toBe(908.08);
    expect(r.pesoVolumetrico.fuera).toBeUndefined();
    expect(r.hayFueraDeLimite).toBe(false);
  });

  it("marca la humedad fuera de límite y lo cuenta en la muestra", () => {
    const m = {
      ...muestraVacia(),
      humedad_p_recipiente: 400,
      humedad_p_inicial: 500,
      humedad_p_final: 497,
    };
    const r = evaluarMuestra(m, [], [limite({ determinacion: "humedad", maximo: 1.5 })]);
    expect(r.humedad.valor).toBe(3);
    expect(r.humedad.fuera).toBe("alto");
    expect(r.hayFueraDeLimite).toBe(true);
  });

  /** El `Ret #100 = 15,3%` de la fila 184 de `Filler 1`, que hoy entra sin una palabra. */
  it("marca el retenido de una malla contra su propio límite", () => {
    const m = { ...muestraVacia(), granulometria_peso_muestra_g: 100 };
    const retenidos = [
      { muestra_id: "m1", malla: 100, retenido_g: 15.3 },
      { muestra_id: "m1", malla: 200, retenido_g: 31.4 },
    ];
    const limites = [limite({ determinacion: "retenido", malla: 100, maximo: 6 })];

    const r = evaluarMuestra(m, retenidos, limites);
    expect(r.granulometria.filas[0].retenido.fuera).toBe("alto");
    expect(r.granulometria.filas[1].retenido.fuera).toBeUndefined();
    expect(r.hayFueraDeLimite).toBe(true);
  });

  it("el acumulado tiene su propio límite, distinto del retenido", () => {
    const m = { ...muestraVacia(), granulometria_peso_muestra_g: 100 };
    const retenidos = [{ muestra_id: "m1", malla: 200, retenido_g: 40 }];
    const limites = [limite({ determinacion: "acumulado", malla: 200, maximo: 30 })];

    const r = evaluarMuestra(m, retenidos, limites);
    expect(r.granulometria.filas[0].retenido.fuera).toBeUndefined();
    expect(r.granulometria.filas[0].acumulado.fuera).toBe("alto");
  });

  /** Los límites de otro producto no son de esta muestra. */
  it("ignora los límites que no son del producto de la muestra", () => {
    const m = {
      ...muestraVacia(),
      humedad_p_recipiente: 400,
      humedad_p_inicial: 500,
      humedad_p_final: 497,
    };
    const ajeno = limite({ producto_id: "otro", determinacion: "humedad", maximo: 1.5 });
    expect(evaluarMuestra(m, [], [ajeno]).hayFueraDeLimite).toBe(false);
  });

  it("un problema de cálculo no se pierde al evaluar los límites", () => {
    const m = {
      ...muestraVacia(),
      humedad_p_recipiente: 400,
      humedad_p_inicial: 400,
      humedad_p_final: 399,
    };
    const r = evaluarMuestra(m, [], [limite({ determinacion: "humedad", maximo: 1.5 })]);
    expect(r.humedad.valor).toBeNull();
    expect(r.humedad.problema).toContain("recipiente");
    expect(r.hayFueraDeLimite).toBe(false);
  });
});
