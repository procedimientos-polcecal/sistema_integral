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
