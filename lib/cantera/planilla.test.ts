import { describe, it, expect } from "vitest";
import {
  fechaComoSeEscribe,
  coincideComoSeEscribe,
  resumenExplosivos,
  filaPerforacion,
  filaVoladura,
  filaBochon,
} from "./planilla";
import type { Bochon, Voladura, Yacimiento } from "./types";

function voladura(p: Partial<Voladura>): Voladura {
  return {
    id: "1", codigo: "V01D625", yacimiento_id: "y1", anio: 2025, correlativo: 1,
    perf_inicio: null, perf_fin: null, pozos: null, metros_por_pozo: null,
    perf_tramos: null, vol_tramos: null, material: null, densidad_t_m3: null,
    burden_m: null, espaciamiento_m: null, perf_precio_usd_m: null, perf_tc_usd: null,
    perf_noches_sereno: null, perf_monto_noche: null,
    perf_odoo_move_id: null, perf_odoo_move_name: null, perf_odoo_empresa: null,
    perf_odoo_ref: null, perf_odoo_importe: null, perf_odoo_leido_en: null,
    perf_conforme: null, perf_conforme_obs: null, perf_conforme_por: null, perf_conforme_en: null,
    vol_fecha_carga: null, vol_fecha: null, vol_pozos: null, vol_metros_por_pozo: null,
    vol_burden_m: null, vol_espaciamiento_m: null, vol_tc_usd: null,
    explosivos_raw: null, toneladas_planilla: null,
    vol_odoo_move_id: null, vol_odoo_move_name: null, vol_odoo_empresa: null,
    vol_odoo_ref: null, vol_odoo_importe: null, vol_odoo_leido_en: null,
    vol_conforme: null, vol_conforme_obs: null, vol_conforme_por: null, vol_conforme_en: null,
    observaciones: null, origen: "sdg", sheets_pendiente: null, sheets_pendiente_en: null,
    cargado_por: null, cargado_en: "2025-09-19T00:00:00Z", actualizado_por: null, actualizado_en: null,
    ...p,
  };
}

function bochon(p: Partial<Bochon>): Bochon {
  return {
    id: "1", codigo: "B01D625", yacimiento_id: "y1", anio: 2025, correlativo: 1,
    voladura_codigo: null, inicio: null, fin: null, fecha_voladura: null,
    cantidad: null, metros_perforados: null, precio_usd_m: null, tc_usd: null,
    odoo_move_id: null, odoo_move_name: null, odoo_empresa: null, odoo_ref: null,
    odoo_importe: null, odoo_leido_en: null, conforme: null, conforme_obs: null,
    conforme_por: null, conforme_en: null, observaciones: null, origen: "sdg",
    sheets_pendiente: null, sheets_pendiente_en: null, cargado_por: null,
    cargado_en: "2025-09-19T00:00:00Z", actualizado_por: null, actualizado_en: null,
    ...p,
  };
}

const yacimiento: Yacimiento = {
  id: "y1", codigo: "D6", nombre: "D6", material: "Dolomita", densidad_t_m3: 2.65,
  burden_m: 2.8, espaciamiento_m: 2.5, activo: true, orden: 1,
};

describe("fechaComoSeEscribe", () => {
  it("d/m/yyyy, nunca m/d", () => {
    expect(fechaComoSeEscribe("2026-09-08")).toBe("8/9/2026");
  });
  it("null y vacío dan celda vacía", () => {
    expect(fechaComoSeEscribe(null)).toBe("");
  });
});

describe("coincideComoSeEscribe", () => {
  it("mapea las cuatro lecturas, con el vocabulario ya usado en la planilla", () => {
    expect(coincideComoSeEscribe("coincide")).toBe("COINCIDE");
    expect(coincideComoSeEscribe("revisar")).toBe("NO COINCIDE");
    expect(coincideComoSeEscribe("sin_factura")).toBe("");
    expect(coincideComoSeEscribe("sin_monto")).toBe("");
  });
});

describe("resumenExplosivos", () => {
  it("sólo junta los de tipo detonador (el explosivo a granel), salteando accesorios y servicio", () => {
    const texto = resumenExplosivos([
      { insumo: "emulex", cantidad: 235, precio_usd: 4.24, tipo: "detonador" },
      { insumo: "anfo premium", cantidad: 845, precio_usd: 1.1, tipo: "detonador" },
      { insumo: "Detonadores x 4,80", cantidad: 30, precio_usd: 5.34, tipo: "otros_insumos" },
      { insumo: "Servicio de voladura", cantidad: 1, precio_usd: null, tipo: "voladura" },
    ]);
    expect(texto).toBe("emulex: 235 - anfo premium: 845");
  });
});

describe("filaPerforacion", () => {
  it("arma las 13 columnas en el orden de la planilla", () => {
    const v = voladura({
      perf_inicio: "2025-09-19", perf_fin: "2025-09-19",
      perf_tramos: [{ pozos: 36, metros: 3 }],
      perf_precio_usd_m: 13.43, perf_tc_usd: 1515,
      perf_odoo_ref: "FC A 0002-00002748",
    });
    const fila = filaPerforacion(v, yacimiento);
    expect(fila).toHaveLength(13);
    expect(fila[0]).toBe("V01D625");
    expect(fila[1]).toBe("19/9/2025");
    expect(fila[3]).toBe("D6");
    expect(fila[4]).toBe("3"); // profundidad promedio
    expect(fila[5]).toBe("36"); // pozos
    expect(fila[6]).toBe("108"); // metros totales
    expect(fila[10]).toBe("FC A 0002-00002748");
  });

  it("sin datos de malla, las celdas numéricas quedan vacías y no en '0' o 'NaN'", () => {
    const fila = filaPerforacion(voladura({}), null);
    expect(fila[4]).toBe("");
    expect(fila[5]).toBe("");
    expect(fila[9]).toBe(""); // el monto, sin precio ni TC
  });
});

describe("filaVoladura", () => {
  it("arma las 19 columnas, con las volados igual a los perforados si no hay override", () => {
    const v = voladura({
      perf_tramos: [{ pozos: 36, metros: 3 }],
      vol_fecha: "2025-09-19",
      vol_tc_usd: 1515,
      densidad_t_m3: 2.65,
    });
    const consumos = [{ insumo: "Emulex", cantidad: 48.5, precio_usd: 4.24, tipo: "detonador" }];
    const fila = filaVoladura(v, yacimiento, consumos);
    expect(fila).toHaveLength(19);
    expect(fila[4]).toBe("36"); // Pozos
    expect(fila[13]).toBe("36"); // Pozos volados = igual, sin override
    expect(fila[14]).toBe("108"); // Metros volados = igual
    expect(fila[7]).toBe("Emulex: 48.5"); // Explosivos
    expect(Number(fila[18])).toBeCloseTo(18.55, 5); // Factor t/m = densidad × burden × espaciamiento
  });

  it("prioriza toneladas_planilla sobre la fórmula, para no pisar el histórico", () => {
    const v = voladura({ perf_tramos: [{ pozos: 36, metros: 3 }], densidad_t_m3: 2.65, toneladas_planilla: 1687 });
    const fila = filaVoladura(v, yacimiento, []);
    expect(fila[6]).toBe("1687"); // Toneladas
  });
});

describe("filaBochon", () => {
  it("escribe cantidad y metros_perforados en las mismas columnas de las que se leyó al importar", () => {
    const b = bochon({ cantidad: 197, metros_perforados: 1, precio_usd_m: 5.07, tc_usd: 1515 });
    const fila = filaBochon(b, yacimiento);
    expect(fila).toHaveLength(13);
    expect(fila[6]).toBe("1"); // "Metros perf." = metros_perforados
    expect(fila[7]).toBe("197"); // "Perforaciones" = cantidad
  });
});
