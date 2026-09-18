/**
 * Todo lo que el Excel real trae calculado (horas teóricas, paradas totales,
 * horas reales, disponibilidad, ton/camión, las dos productividades) sale de
 * acá — no se guarda en `trituracion_partes`. Mismo criterio que
 * `produccionDelTurno` en `lib/produccion/produccion.ts`: lo que se puede
 * despejar de lo cargado no se pisa con un número tipeado aparte, que es
 * justo lo que puede quedar viejo.
 *
 * Verificado cifra por cifra contra PLANTA 1 real (2/6/2026: 04:40→11:30,
 * 1,1667 h de falta de piedra → 6,8333 h teóricas, 5,6667 h reales,
 * disponibilidad 0,8293 — exacto).
 */

export interface ParteHoras {
  horaInicio: string | null; // "HH:MM"
  horaFin: string | null; // "HH:MM"
  horasMantenimiento: number;
  horasFaltaPiedra: number;
  horasProduccion: number;
  horasOtro: number;
  toneladasProcesadas: number | null;
  camionesLlegados: number | null;
}

export interface ParteDespejado {
  horasTeoricas: number | null;
  horasParadasTotal: number;
  horasRealesTrabajadas: number | null;
  /** null sin horas teóricas contra qué dividir. */
  disponibilidad: number | null;
  /** null sin camiones llegados, o si dio cero. */
  tonPorCamion: number | null;
  /** null sin horas teóricas. */
  productividadAbsoluta: number | null;
  /** null sin horas reales trabajadas positivas. */
  productividadReal: number | null;
}

/** Minutos desde medianoche de "HH:MM". Null si el formato no matchea. */
function minutosDelDia(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Horas entre inicio y fin. Null si falta alguno de los dos o el formato no
 * matchea — no se asume medianoche ni se recorta a cero. No contempla cruzar
 * medianoche (el horario real de las plantas arranca de madrugada y termina
 * el mismo día, según el relevamiento: 04:00–16:00 como máximo visto).
 */
export function horasTeoricas(horaInicio: string | null, horaFin: string | null): number | null {
  if (!horaInicio || !horaFin) return null;
  const inicio = minutosDelDia(horaInicio);
  const fin = minutosDelDia(horaFin);
  if (inicio === null || fin === null || fin < inicio) return null;
  return (fin - inicio) / 60;
}

export function despejarParte(p: ParteHoras): ParteDespejado {
  const teoricas = horasTeoricas(p.horaInicio, p.horaFin);
  const paradasTotal = p.horasMantenimiento + p.horasFaltaPiedra + p.horasProduccion + p.horasOtro;
  const reales = teoricas === null ? null : teoricas - paradasTotal;

  return {
    horasTeoricas: teoricas,
    horasParadasTotal: paradasTotal,
    horasRealesTrabajadas: reales,
    disponibilidad: teoricas && teoricas > 0 && reales !== null ? reales / teoricas : null,
    tonPorCamion:
      p.toneladasProcesadas != null && p.camionesLlegados
        ? p.toneladasProcesadas / p.camionesLlegados
        : null,
    productividadAbsoluta:
      p.toneladasProcesadas != null && teoricas && teoricas > 0 ? p.toneladasProcesadas / teoricas : null,
    productividadReal:
      p.toneladasProcesadas != null && reales && reales > 0 ? p.toneladasProcesadas / reales : null,
  };
}
