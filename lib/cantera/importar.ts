/**
 * Parsear las pestañas de la planilla de cantera a registros del SdG.
 *
 * Es la **importación inicial y única** de la fase 1: trae las filas de 2026 de
 * `PERFORACIÓN`, `VOLADURAS`, `BOCHONES` y `CONSUMOS`. De ahí en adelante manda
 * el SdG y no se lee más de la planilla.
 *
 * Todo lo que decide algo vive acá y no en el script, para poder probarlo con
 * los valores reales relevados —que tienen `#VALUE!`, textos en celdas
 * numéricas y fechas con `inicio > fin`— sin salir a la red. Es el molde de
 * `lib/despacho/importar.ts`.
 */

import { fechaDeSheets } from "@/lib/core/fechaDeSheets";
import { parsearCodigo } from "./codigos";
import type { TipoDeConsumo } from "./types";

/** Una fila cruda de una pestaña (valores sin formato). */
export type FilaCruda = (string | number | boolean | null)[];

/** Un número, o `null` si la celda trae `#VALUE!`, un texto, vacío o algo raro. */
export function aNumero(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v !== "string") return null;

  const raw = v.trim();
  if (raw === "" || /^#|esperar|no se pudo|verificar/i.test(raw)) return null;

  // "1.450,00" (miles con punto, decimal con coma) → "1450.00"; "74,2" → "74.2".
  // Sin coma se deja como está: un "3.5" es tres y medio, no treinta y cinco.
  let s = raw.replace(/[$\s]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");

  const n = Number(s);
  return isFinite(n) ? n : null;
}

function aTexto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\r/g, "").trim();
  return s === "" ? null : s;
}

/** "Alcancia" / "Alcancía" → "A"; el resto (D6, C3…) queda igual, en mayúsculas. */
export function normalizarCantera(texto: unknown): string | null {
  const s = aTexto(texto);
  if (!s) return null;
  if (/^alcanc/i.test(s)) return "A";
  return s.toUpperCase();
}

// ── PERFORACIÓN ──────────────────────────────────────────────
// [0]cod [1]inicio [2]fin [3]cantera [4]perf_mts(por pozo) [5]pozos
// [6]metros_perf [7]tc [8]precio_usd [9]total [10]factura [11]coincide [12]obs

interface Perforacion {
  perf_inicio: string | null;
  perf_fin: string | null;
  pozos: number | null;
  metros_por_pozo: number | null;
  perf_precio_usd_m: number | null;
  perf_tc_usd: number | null;
  perf_odoo_ref: string | null;
  coincide: string | null;
  obs: string | null;
}

function parsearPerforacion(f: FilaCruda): Perforacion {
  return {
    perf_inicio: fechaDeSheets(f[1]),
    perf_fin: fechaDeSheets(f[2]),
    metros_por_pozo: aNumero(f[4]),
    pozos: aNumero(f[5]),
    perf_tc_usd: aNumero(f[7]),
    perf_precio_usd_m: aNumero(f[8]),
    perf_odoo_ref: aTexto(f[10]),
    coincide: aTexto(f[11]),
    obs: aTexto(f[12]),
  };
}

// ── VOLADURAS ────────────────────────────────────────────────
// [0]cod [1]fecha_carga [2]fecha_voladura [3]cantera [4]pozos [5]metros
// [6]toneladas [7]explosivos [8]tc [9]pesos [10]factura [11]coincide [12]obs
// [13]pozos_volados [14]metros_volados [15]burden [16]espaciam [17]densidad [18]factor

interface Voladura {
  vol_fecha_carga: string | null;
  vol_fecha: string | null;
  vol_pozos: number | null;
  vol_metros: number | null;
  toneladas_planilla: number | null;
  explosivos_raw: string | null;
  vol_tc_usd: number | null;
  vol_odoo_ref: string | null;
  vol_burden_m: number | null;
  vol_espaciamiento_m: number | null;
  densidad_t_m3: number | null;
  coincide: string | null;
  obs: string | null;
}

function parsearVoladura(f: FilaCruda): Voladura {
  return {
    vol_fecha_carga: fechaDeSheets(f[1]),
    vol_fecha: fechaDeSheets(f[2]),
    vol_pozos: aNumero(f[13]) ?? aNumero(f[4]),
    vol_metros: aNumero(f[14]) ?? aNumero(f[5]),
    toneladas_planilla: aNumero(f[6]),
    explosivos_raw: aTexto(f[7]),
    vol_tc_usd: aNumero(f[8]),
    vol_odoo_ref: aTexto(f[10]),
    vol_burden_m: aNumero(f[15]),
    vol_espaciamiento_m: aNumero(f[16]),
    densidad_t_m3: aNumero(f[17]),
    coincide: aTexto(f[11]),
    obs: aTexto(f[12]),
  };
}

export interface VoladuraParaImportar {
  codigo: string;
  yacimiento_codigo: string;
  anio: number;
  correlativo: number;
  perf_inicio: string | null;
  perf_fin: string | null;
  pozos: number | null;
  metros_por_pozo: number | null;
  perf_precio_usd_m: number | null;
  perf_tc_usd: number | null;
  perf_odoo_ref: string | null;
  vol_fecha_carga: string | null;
  vol_fecha: string | null;
  vol_pozos: number | null;
  vol_metros_por_pozo: number | null;
  vol_burden_m: number | null;
  vol_espaciamiento_m: number | null;
  densidad_t_m3: number | null;
  vol_tc_usd: number | null;
  vol_odoo_ref: string | null;
  explosivos_raw: string | null;
  toneladas_planilla: number | null;
  observaciones: string | null;
}

export interface Saltada {
  codigo: string;
  motivo: string;
}

/**
 * Combina `PERFORACIÓN` y `VOLADURAS` en una fila de `cantera_voladuras`,
 * quedándose sólo con las de 2026 cuyo yacimiento existe en el SdG.
 *
 * La clave es el código. Una voladura puede estar en las dos pestañas, en una
 * sola, o con el código escrito distinto: se toma la unión y se reporta lo que
 * no entra.
 */
export function voladurasDe2026(
  perfRows: FilaCruda[],
  volRows: FilaCruda[],
  yacimientoCodigos: string[]
): { filas: VoladuraParaImportar[]; saltadas: Saltada[] } {
  const codigos = new Set<string>();
  const perfPorCodigo = new Map<string, Perforacion>();
  const volPorCodigo = new Map<string, Voladura>();

  for (const f of perfRows.slice(1)) {
    const cod = aTexto(f[0]);
    if (!cod) continue;
    codigos.add(cod);
    perfPorCodigo.set(cod, parsearPerforacion(f));
  }
  for (const f of volRows.slice(1)) {
    const cod = aTexto(f[0]);
    if (!cod) continue;
    codigos.add(cod);
    volPorCodigo.set(cod, parsearVoladura(f));
  }

  const filas: VoladuraParaImportar[] = [];
  const saltadas: Saltada[] = [];

  for (const codigo of codigos) {
    const desarmado = parsearCodigo(codigo, [...yacimientoCodigos, "A"]);
    if (!desarmado || desarmado.tipo !== "V") {
      saltadas.push({ codigo, motivo: "el código no se pudo interpretar" });
      continue;
    }
    if (desarmado.anio !== 2026) continue; // sólo 2026, sin ruido
    if (!yacimientoCodigos.includes(desarmado.yacimiento)) {
      saltadas.push({
        codigo,
        motivo: `el yacimiento ${desarmado.yacimiento} no está cargado en el SdG`,
      });
      continue;
    }

    const p = perfPorCodigo.get(codigo);
    const v = volPorCodigo.get(codigo);
    const vol_metros_por_pozo =
      v?.vol_metros != null && v.vol_pozos ? v.vol_metros / v.vol_pozos : (p?.metros_por_pozo ?? null);

    const obs = [
      p?.obs,
      v?.obs,
      p?.coincide && p.coincide !== "COINCIDE" ? `Perf: ${p.coincide}` : null,
      v?.coincide && v.coincide !== "COINCIDE" ? `Vol: ${v.coincide}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || null;

    filas.push({
      codigo,
      yacimiento_codigo: desarmado.yacimiento,
      anio: 2026,
      correlativo: desarmado.correlativo,
      perf_inicio: p?.perf_inicio ?? null,
      perf_fin: p?.perf_fin ?? null,
      pozos: p?.pozos ?? null,
      metros_por_pozo: p?.metros_por_pozo ?? null,
      perf_precio_usd_m: p?.perf_precio_usd_m ?? null,
      perf_tc_usd: p?.perf_tc_usd ?? null,
      perf_odoo_ref: p?.perf_odoo_ref ?? null,
      vol_fecha_carga: v?.vol_fecha_carga ?? null,
      vol_fecha: v?.vol_fecha ?? null,
      vol_pozos: v?.vol_pozos ?? null,
      vol_metros_por_pozo,
      vol_burden_m: v?.vol_burden_m ?? null,
      vol_espaciamiento_m: v?.vol_espaciamiento_m ?? null,
      densidad_t_m3: v?.densidad_t_m3 ?? null,
      vol_tc_usd: v?.vol_tc_usd ?? null,
      vol_odoo_ref: v?.vol_odoo_ref ?? null,
      explosivos_raw: v?.explosivos_raw ?? null,
      toneladas_planilla: v?.toneladas_planilla ?? null,
      observaciones: obs,
    });
  }

  filas.sort((a, b) => a.codigo.localeCompare(b.codigo));
  return { filas, saltadas };
}

// ── BOCHONES ─────────────────────────────────────────────────
// [0]cod [1]inicio [2]fin [3]precio_usd_m [4]cantera [5]voladura_asoc
// [6]"Metros perf." (=1, en realidad la cantidad de pozos)
// [7]"Perforaciones" (los metros; es lo que usa el costo) [8]tc [9]pesos
// [10]factura [11]coincide [12]obs
//
// Las columnas 6 y 7 están al revés de sus nombres: el total en pesos sale de
// col 7 × precio × tc, así que col 7 son los metros y col 6 la cantidad de
// pozos. Confirmar con cantera.

export interface BochonParaImportar {
  codigo: string;
  yacimiento_codigo: string;
  anio: number;
  correlativo: number;
  voladura_codigo: string | null;
  inicio: string | null;
  fin: string | null;
  cantidad: number | null;
  metros_perforados: number | null;
  precio_usd_m: number | null;
  tc_usd: number | null;
  odoo_ref: string | null;
  observaciones: string | null;
}

export function bochonesDe2026(
  rows: FilaCruda[],
  yacimientoCodigos: string[]
): { filas: BochonParaImportar[]; saltadas: Saltada[] } {
  const filas: BochonParaImportar[] = [];
  const saltadas: Saltada[] = [];

  for (const f of rows.slice(1)) {
    const codigo = aTexto(f[0]);
    if (!codigo) continue;
    const desarmado = parsearCodigo(codigo, [...yacimientoCodigos, "A"]);
    if (!desarmado || desarmado.tipo !== "B") {
      saltadas.push({ codigo, motivo: "el código no se pudo interpretar" });
      continue;
    }
    if (desarmado.anio !== 2026) continue;
    if (!yacimientoCodigos.includes(desarmado.yacimiento)) {
      saltadas.push({ codigo, motivo: `el yacimiento ${desarmado.yacimiento} no está cargado` });
      continue;
    }

    const coincide = aTexto(f[11]);
    filas.push({
      codigo,
      yacimiento_codigo: desarmado.yacimiento,
      anio: 2026,
      correlativo: desarmado.correlativo,
      voladura_codigo: aTexto(f[5]),
      inicio: fechaDeSheets(f[1]),
      fin: fechaDeSheets(f[2]),
      cantidad: aNumero(f[6]),
      metros_perforados: aNumero(f[7]),
      precio_usd_m: aNumero(f[3]),
      tc_usd: aNumero(f[8]),
      odoo_ref: aTexto(f[10]),
      observaciones: [aTexto(f[12]), coincide && coincide !== "COINCIDE" ? coincide : null]
        .filter(Boolean)
        .join(" · ") || null,
    });
  }

  filas.sort((a, b) => a.codigo.localeCompare(b.codigo));
  return { filas, saltadas };
}

// ── CONSUMOS ─────────────────────────────────────────────────
// [0]cod [1]tipo [2]insumo [3]cantidad [4]precio_usd [5]total_usd [6]total_ars

const TIPO_CONSUMO: Record<string, TipoDeConsumo> = {
  detonador: "detonador",
  "otros insumos": "otros_insumos",
  voladura: "voladura",
};

export interface ConsumoParaImportar {
  voladura_codigo: string;
  insumo_raw: string | null;
  tipo: TipoDeConsumo | null;
  cantidad: number;
  precio_usd: number | null;
  orden: number;
}

/** Los renglones de consumo cuyas voladuras están entre las importadas. */
export function consumosDe(
  rows: FilaCruda[],
  codigosValidos: Set<string>
): ConsumoParaImportar[] {
  const salida: ConsumoParaImportar[] = [];
  const ordenPorCodigo = new Map<string, number>();

  for (const f of rows.slice(1)) {
    const codigo = aTexto(f[0]);
    if (!codigo || !codigosValidos.has(codigo)) continue;
    const tipo = TIPO_CONSUMO[aTexto(f[1])?.toLowerCase() ?? ""] ?? null;
    // El servicio de voladura no se importa: es el 4% de la base y se recalcula.
    if (tipo === "voladura") continue;
    const cantidad = aNumero(f[3]);
    if (cantidad === null) continue;

    const orden = ordenPorCodigo.get(codigo) ?? 0;
    ordenPorCodigo.set(codigo, orden + 1);

    salida.push({
      voladura_codigo: codigo,
      insumo_raw: aTexto(f[2]),
      tipo,
      cantidad,
      precio_usd: aNumero(f[4]),
      orden,
    });
  }

  return salida;
}
