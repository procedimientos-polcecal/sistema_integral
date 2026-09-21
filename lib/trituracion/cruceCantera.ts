/**
 * Cuánto material registró Cantera como llegado a cada planta, por día —
 * para compararlo (nunca corregirlo solo) contra `toneladas_procesadas` del
 * parte. Fuente: `cantera_pesadas`, la pesada real de balanza, columna
 * `destino`.
 *
 * `destino` es texto libre cargado a mano en la planilla de balanza y
 * después transcripto por `lib/cantera/pesadas.ts`: conviven "PT 1" (4957
 * pesadas reales) y "P T 1" (463) para la misma planta, además de "PT 2",
 * "PT 3" y "P T 3" — se normaliza sacando espacios y mayúsculas antes de
 * comparar. Un destino que no matchea el patrón "PT<n>" (RESERVA A, GALPÓN
 * 2, PAVONE, un yacimiento...) no es una planta y da `null` — no se inventa
 * a cuál asignarlo, mismo criterio que `lib/trituracion/origen.ts`.
 */

const PATRON_PT = /^PT(\d)$/;

/** El código de planta ("1"/"2"/"3") que corresponde a un `destino` de pesada, o null si no es una planta. */
export function plantaDelDestino(destino: string | null): string | null {
  if (!destino) return null;
  const sinEspacios = destino.toUpperCase().replace(/\s+/g, "");
  const m = sinEspacios.match(PATRON_PT);
  return m ? m[1] : null;
}

export interface PesadaParaCruce {
  fecha: string; // "YYYY-MM-DD"
  destino: string | null;
  toneladas: number;
}

/** Toneladas que Cantera registró como llegadas a cada planta, por día — clave `"{codigoPlanta}|{fecha}"`. */
export function toneladasLlegadasPorDiaYPlanta(pesadas: PesadaParaCruce[]): Map<string, number> {
  const totales = new Map<string, number>();
  for (const p of pesadas) {
    const planta = plantaDelDestino(p.destino);
    if (!planta) continue;
    const clave = `${planta}|${p.fecha}`;
    totales.set(clave, (totales.get(clave) ?? 0) + p.toneladas);
  }
  return totales;
}

/** Cuánto llegó (Cantera) ese día a esa planta — 0 si no hay ninguna pesada con ese destino ese día, no `null`: "no llegó nada" es un dato, no una ausencia. */
export function llegadoElDia(
  totales: Map<string, number>,
  codigoPlanta: string,
  fecha: string
): number {
  return totales.get(`${codigoPlanta}|${fecha}`) ?? 0;
}

/** Cuánto llegó (Cantera) en todo un mes ("YYYY-MM") a esa planta — suma los días de ese mes. */
export function llegadoEnElMes(totales: Map<string, number>, codigoPlanta: string, mes: string): number {
  let suma = 0;
  for (const [clave, toneladas] of totales) {
    const [codigo, fecha] = clave.split("|");
    if (codigo === codigoPlanta && fecha.startsWith(mes)) suma += toneladas;
  }
  return suma;
}
