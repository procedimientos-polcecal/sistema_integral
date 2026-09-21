/**
 * Cuánto material registró Cantera como llegado a cada planta, por día —
 * para compararlo (nunca corregirlo solo) contra `toneladas_procesadas` del
 * parte. Fuente: `cantera_pesadas`, la pesada real de balanza, columnas
 * `destino` y `tipo`.
 *
 * `destino` es texto libre cargado a mano en la planilla de balanza y
 * después transcripto por `lib/cantera/pesadas.ts`: conviven "PT 1" (4957
 * pesadas reales) y "P T 1" (463) para la misma planta, además de "PT 2",
 * "PT 3" y "P T 3" — se normaliza sacando espacios y mayúsculas antes de
 * comparar. Un destino que no matchea el patrón "PT<n>" (RESERVA A, GALPÓN
 * 2, PAVONE, un yacimiento...) no es una planta y da `null` — no se inventa
 * a cuál asignarlo, mismo criterio que `lib/trituracion/origen.ts`.
 *
 * `tipo` es el código de `lib/cantera/acarreo.ts` (`dolomita_d1`,
 * `chocolata_3`, `caliza`...) — quien llama resuelve la etiqueta legible con
 * `tipoDeAcarreo(tipo)?.etiqueta`; acá se guarda el código tal cual para no
 * duplicar ese vocabulario.
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
  tipo: string | null;
}

export interface MaterialLlegado {
  tipo: string;
  toneladas: number;
}

export interface LlegadaDelDia {
  total: number;
  /** De mayor a menor toneladas. Sin las pesadas de `tipo` null (destape, sin tipo de acarreo asignado). */
  porTipo: MaterialLlegado[];
}

const SIN_LLEGADAS: LlegadaDelDia = { total: 0, porTipo: [] };

/** Lo que Cantera registró como llegado a cada planta, por día — clave `"{codigoPlanta}|{fecha}"`. */
export function llegadasPorDiaYPlanta(pesadas: PesadaParaCruce[]): Map<string, LlegadaDelDia> {
  const acumulado = new Map<string, { total: number; porTipo: Map<string, number> }>();

  for (const p of pesadas) {
    const planta = plantaDelDestino(p.destino);
    if (!planta) continue;
    const clave = `${planta}|${p.fecha}`;
    const actual = acumulado.get(clave) ?? { total: 0, porTipo: new Map<string, number>() };
    actual.total += p.toneladas;
    if (p.tipo) actual.porTipo.set(p.tipo, (actual.porTipo.get(p.tipo) ?? 0) + p.toneladas);
    acumulado.set(clave, actual);
  }

  const resultado = new Map<string, LlegadaDelDia>();
  for (const [clave, { total, porTipo }] of acumulado) {
    resultado.set(clave, {
      total,
      porTipo: [...porTipo.entries()]
        .map(([tipo, toneladas]) => ({ tipo, toneladas }))
        .sort((a, b) => b.toneladas - a.toneladas),
    });
  }
  return resultado;
}

/** Lo que llegó (Cantera) ese día a esa planta — nunca null: sin pesadas ese día es `{ total: 0, porTipo: [] }`, un dato y no una ausencia. */
export function llegadaDelDia(
  totales: Map<string, LlegadaDelDia>,
  codigoPlanta: string,
  fecha: string
): LlegadaDelDia {
  return totales.get(`${codigoPlanta}|${fecha}`) ?? SIN_LLEGADAS;
}

/** Cuánto llegó (Cantera) en total en un mes ("YYYY-MM") a esa planta — suma los días de ese mes, sin desglose por material. */
export function llegadoEnElMes(totales: Map<string, LlegadaDelDia>, codigoPlanta: string, mes: string): number {
  let suma = 0;
  for (const [clave, { total }] of totales) {
    const [codigo, fecha] = clave.split("|");
    if (codigo === codigoPlanta && fecha.startsWith(mes)) suma += total;
  }
  return suma;
}
