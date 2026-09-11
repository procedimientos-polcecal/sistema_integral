/**
 * El informe mensual de cantera: perforaciones, voladuras y bochones del mes,
 * más los indicadores por cantera. Reemplaza al Apps Script que armaba la
 * pestaña `INFORME <MES> <AÑO>` de la planilla vieja.
 *
 * Es el módulo: la agregación que hoy corre a las 5 de la mañana sin que nadie
 * la revise pasa a ser esto, con tests.
 *
 * Las perforaciones del mes se cuentan por **fecha de fin de perforación**; las
 * voladuras y sus consumos, por **fecha de voladura**; los bochones, por su
 * fecha de voladura. Es la misma distinción que hacía la planilla: una
 * perforación de fin de mes puede volarse recién el mes siguiente.
 */

import { baseDeConsumosUsd, montoVoladura } from "./costos";
import { totalesDeConsumos, type RenglonDeConsumo } from "./consumos";

export interface VoladuraParaInforme {
  codigo: string;
  /** El código corto del yacimiento (D1, D6, C1, C3…). */
  cantera: string;
  perfFin: string | null;
  /** Metros perforados totales (Σ tramos). */
  perfMetros: number | null;
  /** metros × precio USD/m, sin TC y sin noches de sereno: el "Total USD" de la planilla. */
  perfMontoUsd: number | null;
  /** El monto real que se pagó, en pesos (incluye noches de sereno). */
  perfMontoArs: number | null;
  volFecha: string | null;
  volTc: number | null;
  toneladas: number | null;
  consumos: RenglonDeConsumo[];
}

export interface BochonParaInforme {
  codigo: string;
  cantera: string;
  fecha: string | null;
  metros: number | null;
  montoUsd: number | null;
  montoArs: number | null;
}

export interface FilaPerforacion {
  codigo: string;
  cantera: string;
  fin: string | null;
  metros: number | null;
  montoUsd: number | null;
  montoArs: number | null;
}

export interface FilaVoladura {
  codigo: string;
  cantera: string;
  fecha: string | null;
  toneladas: number | null;
  montoUsd: number | null;
  montoArs: number | null;
}

export interface FilaBochon {
  codigo: string;
  cantera: string;
  fecha: string | null;
  metros: number | null;
  montoUsd: number | null;
  montoArs: number | null;
}

export interface ResumenPorCantera {
  cantera: string;
  perforacionUsd: number;
  voladuraUsd: number;
  bochonUsd: number;
  toneladas: number;
  metrosPerforados: number;
  /** (perforación + voladura) USD / toneladas, o `null` sin toneladas. */
  usdPorTon: number | null;
  /** toneladas / metros perforados, o `null` sin metros. */
  tonPorMetroPerforado: number | null;
  detonadorUsd: number;
  otrosInsumosUsd: number;
  servicioUsd: number;
}

export interface InformeMensual {
  mes: string;
  perforaciones: FilaPerforacion[];
  voladuras: FilaVoladura[];
  bochones: FilaBochon[];
  totales: {
    perforacionUsd: number;
    perforacionArs: number;
    voladuraUsd: number;
    voladuraArs: number;
    bochonUsd: number;
    bochonArs: number;
    toneladas: number;
    metrosPerforados: number;
  };
  porCantera: ResumenPorCantera[];
}

function sum(vs: (number | null)[]): number {
  return vs.reduce((s: number, v) => s + (v ?? 0), 0);
}

/** ¿Esta fecha cae en el mes `"2026-08"`? */
function esDelMes(fecha: string | null, mes: string): boolean {
  return Boolean(fecha && fecha.startsWith(mes));
}

export function armarInformeMensual(
  mes: string,
  voladurasEntrada: VoladuraParaInforme[],
  bochonesEntrada: BochonParaInforme[]
): InformeMensual {
  const conPerfEsteMes = voladurasEntrada.filter((v) => esDelMes(v.perfFin, mes));
  const conVolEsteMes = voladurasEntrada.filter((v) => esDelMes(v.volFecha, mes));
  const bochonesEsteMes = bochonesEntrada.filter((b) => esDelMes(b.fecha, mes));

  const perforaciones: FilaPerforacion[] = conPerfEsteMes.map((v) => ({
    codigo: v.codigo,
    cantera: v.cantera,
    fin: v.perfFin,
    metros: v.perfMetros,
    montoUsd: v.perfMontoUsd,
    montoArs: v.perfMontoArs,
  }));

  const voladuras: FilaVoladura[] = conVolEsteMes.map((v) => ({
    codigo: v.codigo,
    cantera: v.cantera,
    fecha: v.volFecha,
    toneladas: v.toneladas,
    montoUsd: baseDeConsumosUsd(v.consumos) > 0 ? baseDeConsumosUsd(v.consumos) * 1.04 : null,
    montoArs: montoVoladura(v.consumos, v.volTc),
  }));

  const bochones: FilaBochon[] = bochonesEsteMes.map((b) => ({
    codigo: b.codigo,
    cantera: b.cantera,
    fecha: b.fecha,
    metros: b.metros,
    montoUsd: b.montoUsd,
    montoArs: b.montoArs,
  }));

  const totales = {
    perforacionUsd: sum(perforaciones.map((p) => p.montoUsd)),
    perforacionArs: sum(perforaciones.map((p) => p.montoArs)),
    voladuraUsd: sum(voladuras.map((v) => v.montoUsd)),
    voladuraArs: sum(voladuras.map((v) => v.montoArs)),
    bochonUsd: sum(bochones.map((b) => b.montoUsd)),
    bochonArs: sum(bochones.map((b) => b.montoArs)),
    toneladas: sum(voladuras.map((v) => v.toneladas)),
    metrosPerforados: sum(perforaciones.map((p) => p.metros)),
  };

  // ── Por cantera ──
  const canteras = new Set([
    ...perforaciones.map((p) => p.cantera),
    ...voladuras.map((v) => v.cantera),
    ...bochones.map((b) => b.cantera),
  ]);

  const porCantera: ResumenPorCantera[] = [...canteras].sort().map((cantera) => {
    const perfDeEsta = perforaciones.filter((p) => p.cantera === cantera);
    const volDeEsta = conVolEsteMes.filter((v) => v.cantera === cantera);
    const bochDeEsta = bochones.filter((b) => b.cantera === cantera);

    const perforacionUsd = sum(perfDeEsta.map((p) => p.montoUsd));
    const voladuraUsd = sum(volDeEsta.map((v) => (baseDeConsumosUsd(v.consumos) > 0 ? baseDeConsumosUsd(v.consumos) * 1.04 : null)));
    const bochonUsd = sum(bochDeEsta.map((b) => b.montoUsd));
    const toneladas = sum(volDeEsta.map((v) => v.toneladas));
    const metrosPerforados = sum(perfDeEsta.map((p) => p.metros));

    const consumosDeEsta = volDeEsta.flatMap((v) => v.consumos);
    const desglose = totalesDeConsumos(consumosDeEsta, 1); // tc=1: sólo interesa el USD

    return {
      cantera,
      perforacionUsd,
      voladuraUsd,
      bochonUsd,
      toneladas,
      metrosPerforados,
      usdPorTon: toneladas > 0 ? (perforacionUsd + voladuraUsd) / toneladas : null,
      tonPorMetroPerforado: metrosPerforados > 0 ? toneladas / metrosPerforados : null,
      detonadorUsd: desglose.porTipo.detonador?.usd ?? 0,
      otrosInsumosUsd: desglose.porTipo.otros_insumos?.usd ?? 0,
      servicioUsd: desglose.porTipo.voladura?.usd ?? 0,
    };
  });

  return { mes, perforaciones, voladuras, bochones, totales, porCantera };
}
