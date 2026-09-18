/**
 * El service de un equipo por horómetro: cuatro escalones (250, 500, 1000,
 * 2000 horas) en cascada — confirmado con el usuario: hacer el de 1000
 * también cubre el de 500 y el de 250 en ese mismo horómetro, igual que el de
 * 2000 cubre a los otros tres. Por eso "el último service de un escalón" no
 * es sólo el último registrado en ESE escalón: es el mayor horómetro entre
 * todos los registrados en ese escalón **o uno más grande**.
 *
 * El horómetro contra el que se mide "cuánto falta" no vive acá: lo trae
 * quien llama, de la lectura más reciente de `taller_vial_cargas` — no hay
 * un segundo horómetro que se pueda desincronizar del de combustible.
 */

export const TIERS_DE_SERVICE = [250, 500, 1000, 2000] as const;
export type TierDeService = (typeof TIERS_DE_SERVICE)[number];

export function esTierDeServiceValido(v: unknown): v is TierDeService {
  return typeof v === "number" && (TIERS_DE_SERVICE as readonly number[]).includes(v);
}

/**
 * Las tareas de rutina de un service, relevadas de "HISTORIAL REPARACIONES"
 * real: casi todas las descripciones de "Service 250h/500h/1000h/2000h" se
 * arman combinando este mismo puñado de tareas ("Cambio filtro de aire
 * primario y secundario", "se cambió aceite de motor y filtro de aceite...",
 * etc.). El usuario pidió una checklist en vez de escribir la descripción a
 * mano cada vez, con el repuesto del pañol al lado de la que corresponda.
 *
 * Es una lista fija y no un catálogo en la base: son ocho tareas que no
 * cambian, mismo criterio que `TIERS_DE_SERVICE` — si el día de mañana se
 * agrega o saca una, es un cambio de una línea acá.
 */
export interface TareaDeService {
  codigo: string;
  etiqueta: string;
}

export const TAREAS_DE_SERVICE: readonly TareaDeService[] = [
  { codigo: "filtro_aire_primario", etiqueta: "Filtro de aire primario" },
  { codigo: "filtro_aire_secundario", etiqueta: "Filtro de aire secundario" },
  { codigo: "aceite_motor", etiqueta: "Aceite de motor" },
  { codigo: "filtro_aceite", etiqueta: "Filtro de aceite" },
  { codigo: "filtro_combustible", etiqueta: "Filtro de combustible" },
  { codigo: "filtro_precombustible", etiqueta: "Filtro precombustible" },
  { codigo: "engrase", etiqueta: "Engrase general" },
  { codigo: "control_niveles", etiqueta: "Control de niveles (agua / aceite)" },
] as const;

/** "Filtro de aire primario, Aceite de motor" — para armar la descripción sola a partir de lo tildado. */
export function descripcionDeTareas(codigos: string[]): string {
  const etiquetas = TAREAS_DE_SERVICE.filter((t) => codigos.includes(t.codigo)).map((t) => t.etiqueta);
  return etiquetas.join(", ");
}

/**
 * El escalón a partir del "TIPO" de una fila de "HISTORIAL REPARACIONES"
 * ("Service 250h", "Service 1000h", ...) — sólo para el backfill único del
 * histórico. Null si no matchea el patrón (una reparación o revisión común)
 * o si el número no es uno de los cuatro escalones válidos.
 */
export function tierDesdeTipoSheet(tipo: string): TierDeService | null {
  const m = tipo.trim().match(/^Service\s*(\d+)\s*h$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return esTierDeServiceValido(n) ? n : null;
}

export interface ServicePlano {
  id: string;
  equipoId: string;
  tier: number;
  fecha: string; // "YYYY-MM-DD"
  horometro: number;
}

export type LecturaDeService = "VENCIDO" | "PROXIMO" | "AL_DIA";

/** Margen antes del vencimiento para avisar "próximo" en vez de recién marcar "vencido" en la hora exacta. */
const UMBRAL_PROXIMO_HORAS = 50;

export interface EstadoDeServicePorTier {
  tier: TierDeService;
  /** Horómetro del último service que cubre este escalón (propio o de uno mayor). Null si nunca se cargó ninguno. */
  ultimoHorometro: number | null;
  /** ultimoHorometro + tier. Null si nunca se cargó un service de este escalón (o mayor). */
  proximoVencimiento: number | null;
  /** proximoVencimiento − horómetro actual. Null si falta el vencimiento o el horómetro actual. */
  horasFaltantes: number | null;
  /** Null si no hay nada que leer todavía (nunca se cargó un service para este escalón). */
  lectura: LecturaDeService | null;
}

/**
 * El estado de los cuatro escalones de un equipo, dado su historial de
 * services y su horómetro actual (o null si no se conoce todavía).
 */
export function estadoDeServicePorEquipo(
  servicesDelEquipo: ServicePlano[],
  horometroActual: number | null
): EstadoDeServicePorTier[] {
  return TIERS_DE_SERVICE.map((tier) => {
    // Cascada: un service de este escalón o de uno más grande lo cubre.
    const relevantes = servicesDelEquipo.filter((s) => s.tier >= tier);
    const ultimoHorometro = relevantes.length > 0 ? Math.max(...relevantes.map((s) => s.horometro)) : null;
    const proximoVencimiento = ultimoHorometro !== null ? ultimoHorometro + tier : null;
    const horasFaltantes =
      proximoVencimiento !== null && horometroActual !== null ? proximoVencimiento - horometroActual : null;

    let lectura: LecturaDeService | null = null;
    if (horasFaltantes !== null) {
      lectura = horasFaltantes <= 0 ? "VENCIDO" : horasFaltantes <= UMBRAL_PROXIMO_HORAS ? "PROXIMO" : "AL_DIA";
    }

    return { tier, ultimoHorometro, proximoVencimiento, horasFaltantes, lectura };
  });
}

export interface ServiceDeEquipo {
  equipoId: string;
  horometroActual: number | null;
  escalones: EstadoDeServicePorTier[];
}

/** El estado de service de cada equipo de una lista, en un solo llamado — para no repetir el filtrado en cada pantalla que lo necesita. */
export function resumenServicePorEquipo(
  equipoIds: string[],
  todosLosServices: ServicePlano[],
  horometroActualPorEquipo: Map<string, number>
): ServiceDeEquipo[] {
  return equipoIds.map((equipoId) => {
    const servicesDelEquipo = todosLosServices.filter((s) => s.equipoId === equipoId);
    const horometroActual = horometroActualPorEquipo.get(equipoId) ?? null;
    return { equipoId, horometroActual, escalones: estadoDeServicePorEquipo(servicesDelEquipo, horometroActual) };
  });
}

/** La lectura más reciente **con lectura** de cada equipo, de `taller_vial_cargas` — el horómetro "actual" para el service. */
export function ultimaLecturaPorEquipo(
  cargas: { equipoId: string; fecha: string; lectura: number | null }[]
): Map<string, number> {
  const masReciente = new Map<string, { fecha: string; lectura: number }>();
  for (const c of cargas) {
    if (c.lectura === null) continue;
    const actual = masReciente.get(c.equipoId);
    if (!actual || c.fecha > actual.fecha) masReciente.set(c.equipoId, { fecha: c.fecha, lectura: c.lectura });
  }
  return new Map([...masReciente.entries()].map(([equipoId, v]) => [equipoId, v.lectura]));
}
