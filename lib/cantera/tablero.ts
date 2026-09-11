/**
 * Las filas del tablero de Registros, con el monto y las toneladas ya
 * despejados — nada de esto se guarda, se recalcula al leer.
 *
 * Separado de la ruta para poder reusarlo: lo arma tanto `/cantera/registros`
 * como la página de inicio del módulo, que muestra un adelanto de las últimas
 * voladuras. Antes vivía sólo en `registros/page.tsx`.
 */

import { montoBochon, montoPerforacion, montoVoladura, cruce, type LecturaDeCruce } from "./costos";
import { desvioContraPlanilla, toneladasEstimadas } from "./toneladas";
import { metrosYPozos } from "./tramos";
import type { Bochon, Voladura, Yacimiento } from "./types";

export interface FilaVoladura {
  codigo: string;
  yacimiento: string;
  vol_fecha: string | null;
  perf_fin: string | null;
  pozos: number | null;
  montoPerf: number | null;
  montoVol: number | null;
  toneladas: number | null;
  toneladas_planilla: number | null;
  desvioFuera: boolean;
  crucePerf: LecturaDeCruce;
  cruceVol: LecturaDeCruce;
  sheets_pendiente: string | null;
}

export interface FilaBochon {
  codigo: string;
  yacimiento: string;
  fecha: string | null;
  voladura_codigo: string | null;
  cantidad: number | null;
  metros_perforados: number | null;
  monto: number | null;
  cruce: LecturaDeCruce;
  sheets_pendiente: string | null;
}

export function armarFilaVoladura(
  v: Voladura,
  yac: Yacimiento | null,
  consumos: { cantidad: number | null; precio_usd: number | null; tipo: string | null }[]
): FilaVoladura {
  const perf = metrosYPozos(v.perf_tramos, v.pozos, v.metros_por_pozo);
  const vol = metrosYPozos(v.vol_tramos, v.vol_pozos, v.vol_metros_por_pozo);
  const metrosVol = vol.metros ?? perf.metros;

  const montoPerf = montoPerforacion({
    metros: perf.metros,
    precioUsdM: v.perf_precio_usd_m,
    tc: v.perf_tc_usd,
    nochesSereno: v.perf_noches_sereno,
    montoNoche: v.perf_monto_noche,
  });
  const montoVol = montoVoladura(consumos, v.vol_tc_usd);
  const toneladas = toneladasEstimadas({
    metros: metrosVol,
    densidad: v.densidad_t_m3 ?? yac?.densidad_t_m3 ?? null,
    burden: v.vol_burden_m ?? v.burden_m ?? yac?.burden_m ?? null,
    espaciamiento: v.vol_espaciamiento_m ?? v.espaciamiento_m ?? yac?.espaciamiento_m ?? null,
  });

  return {
    codigo: v.codigo,
    yacimiento: yac?.codigo ?? "?",
    vol_fecha: v.vol_fecha,
    perf_fin: v.perf_fin,
    pozos: perf.pozos,
    montoPerf,
    montoVol,
    toneladas,
    toneladas_planilla: v.toneladas_planilla,
    desvioFuera: desvioContraPlanilla(toneladas, v.toneladas_planilla).fueraDeRango,
    crucePerf: cruce(montoPerf, v.perf_odoo_importe).lectura,
    cruceVol: cruce(montoVol, v.vol_odoo_importe).lectura,
    sheets_pendiente: v.sheets_pendiente,
  };
}

export function armarFilaBochon(b: Bochon, yac: Yacimiento | null): FilaBochon {
  const monto = montoBochon({
    cantidad: b.cantidad,
    metrosPerforados: b.metros_perforados,
    precioUsdM: b.precio_usd_m,
    tc: b.tc_usd,
  });
  return {
    codigo: b.codigo,
    yacimiento: yac?.codigo ?? "?",
    fecha: b.fecha_voladura ?? b.fin,
    voladura_codigo: b.voladura_codigo,
    cantidad: b.cantidad,
    metros_perforados: b.metros_perforados,
    monto,
    cruce: cruce(monto, b.odoo_importe).lectura,
    sheets_pendiente: b.sheets_pendiente,
  };
}

export interface ConteoDeAvisos {
  sinConciliar: number;
  desvios: number;
  pendientes: number;
}

/**
 * Los tres números detrás de los avisos del tablero, sin todavía convertirlos
 * en texto — separado de `avisosDe` para que la página de inicio pueda mostrar
 * el número solo, en una tarjeta, sin tener que parsear la frase.
 */
export function contarAvisos(voladuras: FilaVoladura[], bochones: FilaBochon[]): ConteoDeAvisos {
  const sinConciliar = [...voladuras, ...bochones].filter((f) =>
    "montoPerf" in f
      ? f.crucePerf === "sin_factura" || f.cruceVol === "sin_factura" || f.crucePerf === "revisar" || f.cruceVol === "revisar"
      : f.cruce === "sin_factura" || f.cruce === "revisar"
  ).length;
  const desvios = voladuras.filter((v) => v.desvioFuera).length;
  const pendientes = [...voladuras, ...bochones].filter((f) => f.sheets_pendiente).length;
  return { sinConciliar, desvios, pendientes };
}

/** Los avisos del tablero, en texto: mismo criterio en Registros y en la página de inicio. */
export function avisosDe(voladuras: FilaVoladura[], bochones: FilaBochon[]): string[] {
  const { sinConciliar, desvios, pendientes } = contarAvisos(voladuras, bochones);
  const avisos: string[] = [];
  if (sinConciliar > 0) avisos.push(`${sinConciliar} registro(s) con factura sin conciliar o a revisar.`);
  if (desvios > 0) avisos.push(`${desvios} voladura(s) con toneladas fuera del ±15% de la planilla histórica.`);
  if (pendientes > 0) avisos.push(`${pendientes} fila(s) que no llegaron a la planilla.`);
  return avisos;
}
