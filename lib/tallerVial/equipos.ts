/**
 * Lo que la planilla real no guarda por carga sino que se sabe de memoria: qué
 * combustible toma cada equipo y en qué se mide su avance. No vive en
 * `equipos` (tabla compartida con Mantenimiento) porque es un dato propio de
 * Taller Vial — mismo criterio que `TIPOS_DE_ACARREO` de Cantera, que tampoco
 * agrega columnas a un catálogo que otro módulo ya usa.
 */

export type UnidadDeUso = "horas" | "km";
export type TipoDeCombustible = "DIESEL_500" | "INFINIA";

/**
 * Nafta en vez de gasoil: EM7 (Liu Gong 856) y EM9 (Scania 420 8x4), tal cual
 * la fórmula real de la planilla ("DATOS", columna E) y confirmado contra
 * filas reales — el resto siempre carga DIESEL 500.
 */
const CODIGOS_A_INFINIA = new Set(["EM7", "EM9"]);

export function tipoDeCombustible(codigo: string): TipoDeCombustible {
  return CODIGOS_A_INFINIA.has(codigo) ? "INFINIA" : "DIESEL_500";
}

/**
 * Camiones y camioneta se miden por odómetro (km); excavadoras, cargadoras y
 * autoelevadores por horómetro (horas). Sólo EM9 (Scania 420 8x4, lectura real
 * de 199.342) se pudo confirmar contra un dato real de la planilla — el resto
 * de este grupo se asume por ser el mismo tipo de vehículo (EM8, otro Scania;
 * EM13, una camioneta; EM15, un camión). Si alguno resulta estar mal, se
 * corrige acá y no hace falta tocar nada más: nada en `lib/tallerVial/`
 * depende de que la lista sea perfecta desde el día uno, sólo la etiqueta que
 * ve quien carga y el cálculo de trabajado.
 */
const CODIGOS_EN_KM = new Set(["EM8", "EM9", "EM13", "EM15"]);

export function unidadDeUso(codigo: string): UnidadDeUso {
  return CODIGOS_EN_KM.has(codigo) ? "km" : "horas";
}

export const ETIQUETA_UNIDAD: Record<UnidadDeUso, string> = {
  horas: "hs",
  km: "km",
};

/**
 * El código EM al principio de un texto libre ("EM5 - Doosan SD 300" → "EM5").
 * Null si el texto no arranca con uno — la planilla real también tiene filas
 * sueltas de combustible que no son de un equipo móvil ("empresa piparo",
 * "sección hornos"), y esas no tienen que matchear ninguno.
 */
export function codigoDesdeTextoLibre(raw: string): string | null {
  const m = raw.trim().match(/^(EM\d+)\b/i);
  return m ? m[1].toUpperCase() : null;
}

/** Orden numérico de códigos EM (EM2 antes que EM10), no alfabético. */
export function compararCodigosEM(a: string, b: string): number {
  const na = Number(a.replace(/^EM/i, ""));
  const nb = Number(b.replace(/^EM/i, ""));
  if (isFinite(na) && isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}
