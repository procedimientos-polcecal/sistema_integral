/**
 * El informe de cantera: perforaciones, voladuras y bochones de un período,
 * más los indicadores por cantera. Reemplaza al Apps Script que armaba la
 * pestaña `INFORME <MES> <AÑO>` de la planilla vieja.
 *
 * Es el módulo: la agregación que hoy corre a las 5 de la mañana sin que nadie
 * la revise pasa a ser esto, con tests.
 *
 * NO ESCRIBE UN INFORME EN PROSA. Da las tablas y las cuentas ya hechas —lo que
 * el usuario pidió es "un botón que genere las tablas y gráficos que tengo en
 * el Sheets, para yo escribir el informe después"—, exportables a Excel.
 *
 * Las perforaciones se cuentan por **fecha de fin de perforación**; las
 * voladuras y sus consumos, por **fecha de voladura**; los bochones, por su
 * fecha de voladura. Es la misma distinción que hacía la planilla: una
 * perforación de fin de mes puede volarse recién el mes siguiente.
 */

import { baseDeConsumosUsd, montoVoladura, TASA_SERVICIO_VOLADURA } from "./costos";
import { totalesDeConsumos, type RenglonDeConsumo } from "./consumos";

/** Un renglón de consumo con el nombre del insumo, para la tabla de detalle. */
export interface RenglonParaInforme extends RenglonDeConsumo {
  insumo?: string | null;
}

export interface VoladuraParaInforme {
  codigo: string;
  /** El código corto del yacimiento (D1, D6, C1, C3…). */
  cantera: string;
  perfFin: string | null;
  /** Cantidad de pozos (Σ tramos), para "Prof. (mts)" = metros / pozos. */
  perfPozos: number | null;
  /** Metros perforados totales (Σ tramos). */
  perfMetros: number | null;
  /** metros × precio USD/m, sin TC y sin noches de sereno: el "Total USD" de la planilla. */
  perfMontoUsd: number | null;
  /** El monto real que se pagó, en pesos (incluye noches de sereno). */
  perfMontoArs: number | null;
  volFecha: string | null;
  volTc: number | null;
  toneladas: number | null;
  consumos: RenglonParaInforme[];
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
  pozos: number | null;
  /** metros / pozos — la profundidad promedio, "Prof. (mts)" de la planilla. */
  profundidadProm: number | null;
  metros: number | null;
  montoUsd: number | null;
  montoArs: number | null;
}

export interface FilaVoladura {
  codigo: string;
  cantera: string;
  fecha: string | null;
  toneladas: number | null;
  /** Σ cantidad de los renglones de tipo "detonador": lo que la planilla llama "Gr Detonador". */
  gramosDetonador: number;
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
  gramosDetonador: number;
  /** (perforación + voladura) USD / toneladas, o `null` sin toneladas. */
  usdPorTon: number | null;
  /** toneladas / metros perforados, o `null` sin metros. */
  tonPorMetroPerforado: number | null;
  /** gramos de detonador / toneladas — "Gr Expl./Ton" de la planilla. */
  grExplosivoPorTon: number | null;
  /** perforación + voladura, en USD — "Costo Total USD por Cantera" (el gráfico de torta). */
  costoTotalUsd: number;
  /** "Explosivo USD" de la planilla. */
  detonadorUsd: number;
  /** "Accesorios USD" de la planilla. */
  otrosInsumosUsd: number;
  servicioUsd: number;
}

export interface Totales {
  perforacionUsd: number;
  perforacionArs: number;
  voladuraUsd: number;
  voladuraArs: number;
  bochonUsd: number;
  bochonArs: number;
  toneladas: number;
  metrosPerforados: number;
  gramosDetonador: number;
}

export interface FilaConsumoDetalle {
  codigo: string;
  tipo: string;
  insumo: string;
  cantidad: number;
  precioUsd: number | null;
  totalUsd: number | null;
  totalArs: number | null;
}

export interface Informe {
  desde: string;
  hasta: string;
  perforaciones: FilaPerforacion[];
  voladuras: FilaVoladura[];
  bochones: FilaBochon[];
  /**
   * El detalle de insumos de las voladuras del período, "CONSUMOS DEL MES" de
   * la planilla — incluido un renglón de servicio por voladura (4% de la
   * base), que ya no se guarda como fila propia pero la planilla sí la
   * mostraba.
   */
  consumosDetalle: FilaConsumoDetalle[];
  totales: Totales;
  porCantera: ResumenPorCantera[];
}

function sum(vs: (number | null)[]): number {
  return vs.reduce((s: number, v) => s + (v ?? 0), 0);
}

/**
 * Los gramos de explosivo: Σ `cantidad` de los renglones de tipo "detonador",
 * pasado de kilos a gramos. La `cantidad` se carga en kilos (confirmado con el
 * usuario); "Gr Detonador" de la planilla vieja está en gramos.
 */
const KG_A_GRAMOS = 1000;

function gramosDeDetonador(consumos: RenglonDeConsumo[]): number {
  return sum(consumos.filter((c) => c.tipo === "detonador").map((c) => c.cantidad)) * KG_A_GRAMOS;
}

function enRango(fecha: string | null, desde: string, hasta: string): boolean {
  return Boolean(fecha && fecha >= desde && fecha <= hasta);
}

function montoVoladuraUsd(consumos: RenglonDeConsumo[]): number | null {
  const base = baseDeConsumosUsd(consumos);
  return base > 0 ? base * 1.04 : null;
}

/**
 * El informe de un período `[desde, hasta]` (fechas ISO, inclusive). Es la
 * función que arma tanto "el mes de agosto" (`armarInformeMensual`) como
 * cualquier rango que se pida a mano desde el botón "Generar informe".
 */
export function armarInforme(
  desde: string,
  hasta: string,
  voladurasEntrada: VoladuraParaInforme[],
  bochonesEntrada: BochonParaInforme[]
): Informe {
  const conPerf = voladurasEntrada.filter((v) => enRango(v.perfFin, desde, hasta));
  const conVol = voladurasEntrada.filter((v) => enRango(v.volFecha, desde, hasta));
  const bochonesDelPeriodo = bochonesEntrada.filter((b) => enRango(b.fecha, desde, hasta));

  const perforaciones: FilaPerforacion[] = conPerf.map((v) => ({
    codigo: v.codigo,
    cantera: v.cantera,
    fin: v.perfFin,
    pozos: v.perfPozos,
    profundidadProm: v.perfPozos && v.perfMetros != null ? v.perfMetros / v.perfPozos : null,
    metros: v.perfMetros,
    montoUsd: v.perfMontoUsd,
    montoArs: v.perfMontoArs,
  }));

  const voladuras: FilaVoladura[] = conVol.map((v) => ({
    codigo: v.codigo,
    cantera: v.cantera,
    fecha: v.volFecha,
    toneladas: v.toneladas,
    gramosDetonador: gramosDeDetonador(v.consumos),
    montoUsd: montoVoladuraUsd(v.consumos),
    montoArs: montoVoladura(v.consumos, v.volTc),
  }));

  const bochones: FilaBochon[] = bochonesDelPeriodo.map((b) => ({
    codigo: b.codigo,
    cantera: b.cantera,
    fecha: b.fecha,
    metros: b.metros,
    montoUsd: b.montoUsd,
    montoArs: b.montoArs,
  }));

  const totales: Totales = {
    perforacionUsd: sum(perforaciones.map((p) => p.montoUsd)),
    perforacionArs: sum(perforaciones.map((p) => p.montoArs)),
    voladuraUsd: sum(voladuras.map((v) => v.montoUsd)),
    voladuraArs: sum(voladuras.map((v) => v.montoArs)),
    bochonUsd: sum(bochones.map((b) => b.montoUsd)),
    bochonArs: sum(bochones.map((b) => b.montoArs)),
    toneladas: sum(voladuras.map((v) => v.toneladas)),
    metrosPerforados: sum(perforaciones.map((p) => p.metros)),
    gramosDetonador: sum(voladuras.map((v) => v.gramosDetonador)),
  };

  // ── Por cantera ──
  const canteras = new Set([
    ...perforaciones.map((p) => p.cantera),
    ...voladuras.map((v) => v.cantera),
    ...bochones.map((b) => b.cantera),
  ]);

  const porCantera: ResumenPorCantera[] = [...canteras].sort().map((cantera) => {
    const perfDeEsta = perforaciones.filter((p) => p.cantera === cantera);
    const volDeEsta = conVol.filter((v) => v.cantera === cantera);
    const bochDeEsta = bochones.filter((b) => b.cantera === cantera);

    const perforacionUsd = sum(perfDeEsta.map((p) => p.montoUsd));
    const voladuraUsd = sum(volDeEsta.map((v) => montoVoladuraUsd(v.consumos)));
    const bochonUsd = sum(bochDeEsta.map((b) => b.montoUsd));
    const toneladas = sum(volDeEsta.map((v) => v.toneladas));
    const metrosPerforados = sum(perfDeEsta.map((p) => p.metros));
    const gramosDetonador = sum(volDeEsta.map((v) => gramosDeDetonador(v.consumos)));

    const consumosDeEsta = volDeEsta.flatMap((v) => v.consumos);
    const desglose = totalesDeConsumos(consumosDeEsta, 1); // tc=1: sólo interesa el USD

    return {
      cantera,
      perforacionUsd,
      voladuraUsd,
      bochonUsd,
      toneladas,
      metrosPerforados,
      gramosDetonador,
      usdPorTon: toneladas > 0 ? (perforacionUsd + voladuraUsd) / toneladas : null,
      tonPorMetroPerforado: metrosPerforados > 0 ? toneladas / metrosPerforados : null,
      grExplosivoPorTon: toneladas > 0 ? gramosDetonador / toneladas : null,
      costoTotalUsd: perforacionUsd + voladuraUsd,
      detonadorUsd: desglose.porTipo.detonador?.usd ?? 0,
      otrosInsumosUsd: desglose.porTipo.otros_insumos?.usd ?? 0,
      servicioUsd: desglose.porTipo.voladura?.usd ?? 0,
    };
  });

  // ── El detalle de consumos, con el servicio sintetizado por voladura ──
  // (ya no es una fila guardada: se recalcula, pero la planilla la mostraba).
  const consumosDetalle: FilaConsumoDetalle[] = [];
  for (const v of conVol) {
    for (const c of v.consumos) {
      if (c.cantidad === null) continue;
      const totalUsd = c.precio_usd !== null ? c.cantidad * c.precio_usd : null;
      consumosDetalle.push({
        codigo: v.codigo,
        tipo: c.tipo ?? "otros_insumos",
        insumo: c.insumo ?? "—",
        cantidad: c.cantidad,
        precioUsd: c.precio_usd,
        totalUsd,
        totalArs: totalUsd !== null && v.volTc !== null ? totalUsd * v.volTc : null,
      });
    }
    const base = baseDeConsumosUsd(v.consumos);
    if (base > 0) {
      const servicioUsd = base * TASA_SERVICIO_VOLADURA;
      consumosDetalle.push({
        codigo: v.codigo,
        tipo: "voladura",
        insumo: "Servicio de voladura",
        cantidad: 1,
        precioUsd: TASA_SERVICIO_VOLADURA,
        totalUsd: servicioUsd,
        totalArs: v.volTc !== null ? servicioUsd * v.volTc : null,
      });
    }
  }

  return { desde, hasta, perforaciones, voladuras, bochones, consumosDetalle, totales, porCantera };
}

/** El primer y último día de un mes `"2026-08"`, como límites de `armarInforme`. */
export function rangoDelMes(mes: string): { desde: string; hasta: string } {
  return { desde: `${mes}-01`, hasta: `${mes}-31` };
}

/** Atajo: el informe de un mes de calendario completo. */
export function armarInformeMensual(
  mes: string,
  voladuras: VoladuraParaInforme[],
  bochones: BochonParaInforme[]
): Informe {
  const { desde, hasta } = rangoDelMes(mes);
  return armarInforme(desde, hasta, voladuras, bochones);
}

export interface FilaSerieMensual {
  mes: string;
  toneladas: number;
  perforacionUsd: number;
  voladuraUsd: number;
  usdPorTon: number | null;
  gramosDetonador: number;
  grExplosivoPorTon: number | null;
}

/**
 * La serie mes a mes de todo el histórico cargado, para el gráfico de
 * variación. Un mes entra si hay al menos una perforación, voladura o bochón
 * con fecha en él.
 *
 * `cantera`, si se pasa, acota todo a esa cantera (para el filtro "ver estos
 * mismos gráficos por cantera" del informe) — sin ella, es el total de las
 * cuatro juntas.
 */
export function serieMensual(
  voladurasEntrada: VoladuraParaInforme[],
  bochonesEntrada: BochonParaInforme[],
  cantera?: string
): FilaSerieMensual[] {
  const voladuras = cantera ? voladurasEntrada.filter((v) => v.cantera === cantera) : voladurasEntrada;
  const bochones = cantera ? bochonesEntrada.filter((b) => b.cantera === cantera) : bochonesEntrada;

  const meses = new Set<string>();
  for (const v of voladuras) {
    if (v.perfFin) meses.add(v.perfFin.slice(0, 7));
    if (v.volFecha) meses.add(v.volFecha.slice(0, 7));
  }
  for (const b of bochones) {
    if (b.fecha) meses.add(b.fecha.slice(0, 7));
  }

  return [...meses].sort().map((mes) => {
    const informe = armarInformeMensual(mes, voladuras, bochones);
    const { toneladas, perforacionUsd, voladuraUsd, gramosDetonador } = informe.totales;
    return {
      mes,
      toneladas,
      perforacionUsd,
      voladuraUsd,
      usdPorTon: toneladas > 0 ? (perforacionUsd + voladuraUsd) / toneladas : null,
      gramosDetonador,
      grExplosivoPorTon: toneladas > 0 ? gramosDetonador / toneladas : null,
    };
  });
}
