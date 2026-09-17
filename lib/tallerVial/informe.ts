/**
 * El informe mensual de Taller Vial — reemplaza los tabs "INFORME OCUPACIÓN
 * EQUIPOS MÓVILES — <MES> <AÑO>" que hoy arma un Apps Script sobre la
 * planilla "SEGUIMIENTO EQUIPOS MÓVILES" (relevados en vivo: uno por mes,
 * abril a septiembre/2026). Mismo criterio que el informe de Cantera
 * (`lib/cantera/informe.ts`): da las tablas ya calculadas, no escribe nada en
 * prosa.
 *
 * DOS SECCIONES DE LA HOJA REAL QUEDAN AFUERA A PROPÓSITO, documentado y no
 * resuelto:
 *
 * - **"REF. HISTÓRICA (L/h)"** de la hoja real es un número cargado a mano
 *   por equipo, no calculado — no hay de dónde sacarlo. Acá se reemplaza por
 *   una referencia calculada: el consumo promedio de los `mesesDeReferencia`
 *   meses anteriores al que se mira. No es el mismo número que el de la
 *   planilla y no tiene por qué coincidir; es la mejor aproximación posible
 *   sin ese dato manual.
 *
 * - **UTILIZACIÓN Y PRODUCTIVIDAD** (HTD/HDR/HRU de la hoja real) dependen
 *   del régimen de turnos de cada equipo (cuántas horas por día se espera que
 *   trabaje) y del calendario de feriados — ninguno de los dos está cargado
 *   en el SdG todavía. Queda sólo la DISPONIBILIDAD, calculada distinto:
 *   días operativo sobre días con estado cargado (de
 *   `taller_vial_estados_diarios`), no horas sobre horas. "Operativo con
 *   fallas" y "Fuera de servicio" cuentan los dos como no disponible — la
 *   máquina anda con un problema, no lisa.
 *
 * El semáforo de disponibilidad (🔴 &lt;70% · 🟡 70-84% · 🟢 ≥85%) es el mismo
 * umbral de la hoja real, ver "2. INDICADORES OPERATIVOS" en los tabs
 * mensuales.
 */

import type { CargaConTrabajo } from "./combustible";
import type { ResumenMensualDeEstado } from "./estados";

export interface FilaInformeConsumo {
  equipoId: string;
  cargas: number;
  litrosTotal: number;
  /** litrosTotal / horas u km trabajados del mes. Null si no hay trabajado calculable. */
  consumoDelMes: number | null;
  /** Promedio de consumo de los meses de referencia (anteriores al mes del informe). Null sin datos previos. */
  referenciaHistorica: number | null;
  /** consumoDelMes − referenciaHistorica. Null si falta cualquiera de los dos. */
  desvio: number | null;
}

/** Meses de "YYYY-MM" hacia atrás, sin el mes dado — para la ventana de referencia histórica. */
function mesesAnteriores(mes: string, cantidad: number): string[] {
  const [anio, m] = mes.split("-").map(Number);
  const meses: string[] = [];
  for (let i = 1; i <= cantidad; i++) {
    const total = anio * 12 + (m - 1) - i;
    meses.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`);
  }
  return meses;
}

/** El resumen de consumo del mes, con la referencia histórica y el desvío al lado — "1. RESUMEN DE CONSUMO POR EQUIPO" de la hoja real. */
export function armarInformeConsumo(
  cargasConTrabajo: CargaConTrabajo[],
  mes: string,
  mesesDeReferencia = 6
): FilaInformeConsumo[] {
  const delMes = cargasConTrabajo.filter((c) => c.fecha.startsWith(mes));
  const equipoIds = [...new Set(delMes.map((c) => c.equipoId))];
  const ventana = new Set(mesesAnteriores(mes, mesesDeReferencia));

  return equipoIds.map((equipoId) => {
    const cargasDelEquipo = delMes.filter((c) => c.equipoId === equipoId);
    const cargas = cargasDelEquipo.length;
    const litrosTotal = cargasDelEquipo.reduce((s, c) => s + c.litros, 0);
    const trabajadoDelMes = cargasDelEquipo.reduce((s, c) => s + (c.trabajado && c.trabajado > 0 ? c.trabajado : 0), 0);
    const consumoDelMes = trabajadoDelMes > 0 ? litrosTotal / trabajadoDelMes : null;

    const referencia = cargasConTrabajo.filter((c) => c.equipoId === equipoId && ventana.has(c.fecha.slice(0, 7)));
    const litrosRef = referencia.reduce((s, c) => s + c.litros, 0);
    const trabajadoRef = referencia.reduce((s, c) => s + (c.trabajado && c.trabajado > 0 ? c.trabajado : 0), 0);
    const referenciaHistorica = trabajadoRef > 0 ? litrosRef / trabajadoRef : null;

    const desvio = consumoDelMes !== null && referenciaHistorica !== null ? consumoDelMes - referenciaHistorica : null;

    return { equipoId, cargas, litrosTotal, consumoDelMes, referenciaHistorica, desvio };
  });
}

export type LecturaDeDisponibilidad = "CRITICO" | "ACEPTABLE" | "BUENO";

const UMBRAL_CRITICO = 0.70;
const UMBRAL_ACEPTABLE = 0.85;

export interface FilaInformeDisponibilidad {
  equipoId: string;
  diasOperativo: number;
  diasRegistrados: number;
  /** diasOperativo / diasRegistrados × 100. Null si no hay ningún día registrado ese mes. */
  disponibilidadPct: number | null;
  lectura: LecturaDeDisponibilidad | null;
}

/** "2. INDICADORES OPERATIVOS" de la hoja real, reducido a disponibilidad — ver el porqué en el comentario del módulo. */
export function armarInformeDisponibilidad(resumenEstados: ResumenMensualDeEstado[]): FilaInformeDisponibilidad[] {
  return resumenEstados.map((r) => {
    const pct = r.diasRegistrados > 0 ? (r.diasOperativo / r.diasRegistrados) * 100 : null;
    let lectura: LecturaDeDisponibilidad | null = null;
    if (pct !== null) {
      lectura = pct < UMBRAL_CRITICO * 100 ? "CRITICO" : pct < UMBRAL_ACEPTABLE * 100 ? "ACEPTABLE" : "BUENO";
    }
    return {
      equipoId: r.equipoId,
      diasOperativo: r.diasOperativo,
      diasRegistrados: r.diasRegistrados,
      disponibilidadPct: pct,
      lectura,
    };
  });
}
