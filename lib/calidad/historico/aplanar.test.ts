import { describe, it, expect } from "vitest";
import { aplanarMuestra, normalizarParaBuscar } from "./aplanar";
import type { Muestra, Retenido } from "@/lib/calidad/ensayos/types";

const MUESTRA: Muestra = {
  id: "m1", fecha: "2026-10-28", producto_id: "p1", observaciones: null,
  // 426,68 · 527,42 · 526,73 → 0,68% de humedad.
  humedad_p_recipiente: 426.68, humedad_p_inicial: 527.42, humedad_p_final: 526.73,
  peso_vol_gramos: 333, peso_vol_volumen_cc: 330,
  cal_util_ml_acido: null, cal_util_peso_muestra_g: null,
  granulometria_peso_muestra_g: 100,
  cargado_por: null, cargado_en: "2026-10-28T10:00:00Z",
  actualizado_por: null, actualizado_en: null,
};

const RETENIDOS: Retenido[] = [
  { muestra_id: "m1", malla: 100, retenido_g: 4.3 },
  { muestra_id: "m1", malla: 200, retenido_g: 19.3 },
];

describe("aplanarMuestra", () => {
  it("saca una fila por cada retenido y su acumulado, con las etiquetas del reporte", () => {
    // Las etiquetas tienen que decir lo mismo que el histórico, o las dos
    // mitades de la búsqueda no se encuentran entre sí.
    const r = aplanarMuestra(MUESTRA, RETENIDOS, "Filler 1");
    const etiquetas = r.map((f) => f.determinacion);
    expect(etiquetas).toContain("Ret #100 (%)");
    expect(etiquetas).toContain("Acumulado en #200 (%)");
  });

  it("saca humedad y peso volumetrico de los pesos crudos", () => {
    const r = aplanarMuestra(MUESTRA, RETENIDOS, "Filler 1");
    expect(r.find((f) => f.determinacion === "Humedad bh (%)")!.valor).toBeCloseTo(0.68, 2);
    expect(r.find((f) => f.determinacion === "Peso volumétrico (g/l)")!.valor).toBeCloseTo(1009.09, 1);
  });

  it("lo de Ensayos sale siempre con escala porcentaje", () => {
    // Ensayos devuelve la humedad ya en por ciento; el histórico la guarda como
    // fracción. Por eso cada mitad lleva su etiqueta y la pantalla no las
    // confunde.
    const r = aplanarMuestra(MUESTRA, RETENIDOS, "Filler 1");
    expect(r.filter((f) => f.unidad === "%").every((f) => f.escala === "porcentaje")).toBe(true);
    expect(r.every((f) => f.fuente === "ensayos")).toBe(true);
    expect(r.every((f) => f.origen === "Filler 1")).toBe(true);
  });

  it("una muestra sin retenidos devuelve solo sus determinaciones, sin filas vacias", () => {
    // Pasa de verdad: hay muestras con humedad y nada más.
    const r = aplanarMuestra(MUESTRA, [], "Cal");
    expect(r.some((f) => f.determinacion === "Humedad bh (%)")).toBe(true);
    expect(r.some((f) => /Ret #/.test(f.determinacion))).toBe(false);
    expect(r.every((f) => f.valor !== null)).toBe(true);
  });

  it("no devuelve la determinacion que no se midio", () => {
    const sinNada: Muestra = {
      ...MUESTRA,
      humedad_p_recipiente: null, humedad_p_inicial: null, humedad_p_final: null,
      peso_vol_gramos: null, peso_vol_volumen_cc: null,
    };
    expect(aplanarMuestra(sinNada, [], "Cal")).toHaveLength(0);
  });
});

describe("normalizarParaBuscar", () => {
  it("ignora acentos y eñes", () => {
    // "Güemes" se escribe en la planilla con diéresis y se busca sin ella.
    expect(normalizarParaBuscar("Güemes")).toBe(normalizarParaBuscar("guemes"));
    expect(normalizarParaBuscar("Peña")).toBe(normalizarParaBuscar("pena"));
    expect(normalizarParaBuscar("BOLSAS CAL GÜEMES")).toContain("guemes");
  });
});
