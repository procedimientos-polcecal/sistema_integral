/**
 * El estado diario de un equipo, espejado de "HISTORIAL ESTADOS" de la
 * planilla real: una matriz fecha × equipo con tres códigos por celda.
 * Confirmado con el usuario: OP = Operativo, FS = Fuera de Servicio,
 * OCF = Operativo Con Fallas.
 */

export type EstadoDiario = "OPERATIVO" | "FUERA_DE_SERVICIO" | "OPERATIVO_CON_FALLAS";

const CODIGO_A_ESTADO: Record<string, EstadoDiario> = {
  OP: "OPERATIVO",
  FS: "FUERA_DE_SERVICIO",
  OCF: "OPERATIVO_CON_FALLAS",
};

/** Null si el código de la planilla no es ninguno de los tres conocidos — no se adivina. */
export function estadoDesdeCodigoSheet(codigo: string): EstadoDiario | null {
  return CODIGO_A_ESTADO[codigo.trim().toUpperCase()] ?? null;
}

/** El sentido contrario: el código de la planilla para un estado cargado desde el SdG — ver `lib/tallerVial/espejo.ts`. */
export function codigoSheetDesdeEstado(estado: EstadoDiario): string {
  return { OPERATIVO: "OP", FUERA_DE_SERVICIO: "FS", OPERATIVO_CON_FALLAS: "OCF" }[estado];
}

/** Si el texto es uno de los tres estados válidos — para validar lo que llega por la API. */
export function esEstadoDiarioValido(v: unknown): v is EstadoDiario {
  return v === "OPERATIVO" || v === "FUERA_DE_SERVICIO" || v === "OPERATIVO_CON_FALLAS";
}

export const ETIQUETA_ESTADO: Record<EstadoDiario, string> = {
  OPERATIVO: "Operativo",
  FUERA_DE_SERVICIO: "Fuera de servicio",
  OPERATIVO_CON_FALLAS: "Operativo con fallas",
};

export interface EstadoPlano {
  equipoId: string;
  fecha: string; // "YYYY-MM-DD"
  estado: EstadoDiario;
}

export interface ResumenMensualDeEstado {
  equipoId: string;
  diasRegistrados: number;
  diasOperativo: number;
  diasFueraDeServicio: number;
  diasConFallas: number;
}

/** Cuántos días de cada estado tuvo cada equipo en el mes — la alarma es `diasFueraDeServicio`. */
export function resumenMensualDeEstados(estados: EstadoPlano[], mes: string): ResumenMensualDeEstado[] {
  const delMes = estados.filter((e) => e.fecha.startsWith(mes));
  const totales = new Map<string, { operativo: number; fs: number; ocf: number; total: number }>();

  for (const e of delMes) {
    const acc = totales.get(e.equipoId) ?? { operativo: 0, fs: 0, ocf: 0, total: 0 };
    acc.total += 1;
    if (e.estado === "OPERATIVO") acc.operativo += 1;
    else if (e.estado === "FUERA_DE_SERVICIO") acc.fs += 1;
    else if (e.estado === "OPERATIVO_CON_FALLAS") acc.ocf += 1;
    totales.set(e.equipoId, acc);
  }

  return [...totales.entries()].map(([equipoId, acc]) => ({
    equipoId,
    diasRegistrados: acc.total,
    diasOperativo: acc.operativo,
    diasFueraDeServicio: acc.fs,
    diasConFallas: acc.ocf,
  }));
}

/** El último estado registrado de cada equipo — no exige que sea "hoy": cada equipo puede tener su último dato en un día distinto. */
export function estadoActualPorEquipo(estados: EstadoPlano[]): Map<string, EstadoDiario> {
  const masReciente = new Map<string, { fecha: string; estado: EstadoDiario }>();
  for (const e of estados) {
    const actual = masReciente.get(e.equipoId);
    if (!actual || e.fecha > actual.fecha) masReciente.set(e.equipoId, { fecha: e.fecha, estado: e.estado });
  }
  return new Map([...masReciente.entries()].map(([equipoId, v]) => [equipoId, v.estado]));
}

export interface ResumenDeEstadoActual {
  operativos: number;
  fueraDeServicio: number;
  conFallas: number;
  /** Equipos sin ningún estado cargado todavía — no cuentan para el %, pero hay que poder mostrarlo. */
  sinDato: number;
  total: number;
}

/** Cuántos equipos están, ahora mismo, en cada estado — para los indicadores en % del inicio del módulo. */
export function resumenDeEstadoActual(estadoActual: Map<string, EstadoDiario>, equipoIds: string[]): ResumenDeEstadoActual {
  let operativos = 0, fueraDeServicio = 0, conFallas = 0, sinDato = 0;
  for (const id of equipoIds) {
    const estado = estadoActual.get(id);
    if (estado === "OPERATIVO") operativos++;
    else if (estado === "FUERA_DE_SERVICIO") fueraDeServicio++;
    else if (estado === "OPERATIVO_CON_FALLAS") conFallas++;
    else sinDato++;
  }
  return { operativos, fueraDeServicio, conFallas, sinDato, total: equipoIds.length };
}
