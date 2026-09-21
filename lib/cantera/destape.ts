/**
 * El costo de destapar un frente de cantera — horas de máquina propia (con
 * su operario) o de un fletero externo con camión, por día. Puro: no toca
 * la base. Relevado contra la planilla real
 * (1SvF0HK3Zu6Mi5Z_tTokJAypWvHHHp9oEomucqJudE3Y) el 21/09/2026.
 */

export const TIPOS_DE_RECURSO = ["operario_propio", "fletero_externo"] as const;
export type TipoDeRecurso = (typeof TIPOS_DE_RECURSO)[number];

export const ETIQUETA_TIPO_RECURSO: Record<TipoDeRecurso, string> = {
  operario_propio: "Operario propio",
  fletero_externo: "Fletero externo",
};

export function esTipoDeRecursoValido(v: unknown): v is TipoDeRecurso {
  return typeof v === "string" && (TIPOS_DE_RECURSO as readonly string[]).includes(v);
}

export const TIPOS_DE_CAMION = ["camion_grande", "camion_chico"] as const;
export type TipoDeCamion = (typeof TIPOS_DE_CAMION)[number];

export const ETIQUETA_TIPO_CAMION: Record<TipoDeCamion, string> = {
  camion_grande: "Camión grande",
  camion_chico: "Camión chico",
};

export function esTipoDeCamionValido(v: unknown): v is TipoDeCamion {
  return typeof v === "string" && (TIPOS_DE_CAMION as readonly string[]).includes(v);
}

export const CATEGORIAS_DE_TARIFA = ["maquina_propia", "mo_propia", "fletero_externo"] as const;
export type CategoriaDeTarifa = (typeof CATEGORIAS_DE_TARIFA)[number];

export interface TarifaDestape {
  categoria: CategoriaDeTarifa;
  /** Código de equipo ("EM3") para maquina_propia; tipo de camión para fletero_externo; libre para mo_propia. */
  clave: string;
  desde: string; // "YYYY-MM-DD"
  hasta: string | null;
  tarifa: number;
}

/**
 * La tarifa vigente de una categoría+clave en una fecha — mismo criterio de
 * vigencia que `tarifaVigente` de `lib/cantera/acarreo.ts` (la más nueva
 * que ya empezó y no terminó). Null si no hay ninguna: no se inventa un
 * costo con una tarifa que no está cargada.
 */
export function tarifaVigenteDestape(
  tarifas: TarifaDestape[],
  categoria: CategoriaDeTarifa,
  clave: string,
  fecha: string
): number | null {
  const candidatas = tarifas
    .filter((t) => t.categoria === categoria && t.clave === clave && t.desde <= fecha && (t.hasta === null || t.hasta >= fecha))
    .sort((a, b) => b.desde.localeCompare(a.desde));
  return candidatas[0]?.tarifa ?? null;
}

export interface CapacidadFletero {
  fleteroId: string;
  tipoCamion: string;
  toneladasPorViaje: number;
}

/** 0 si no hay capacidad relevada para ese fletero+tipo de camión — mismo criterio que la planilla real, que también parte de 0. */
export function capacidadDe(capacidades: CapacidadFletero[], fleteroId: string | null, tipoCamion: string | null): number {
  if (!fleteroId || !tipoCamion) return 0;
  return capacidades.find((c) => c.fleteroId === fleteroId && c.tipoCamion === tipoCamion)?.toneladasPorViaje ?? 0;
}

export interface RegistroDestape {
  fecha: string; // "YYYY-MM-DD"
  tipoRecurso: TipoDeRecurso;
  /** Código de equipo ("EM3"), sólo con sentido si tipoRecurso = operario_propio. */
  equipoCodigo: string | null;
  fleteroId: string | null;
  tipoCamion: TipoDeCamion | null;
  horas: number;
  viajes: number | null;
}

export interface CostoDestape {
  costoMaquina: number;
  costoMo: number;
  costoFletero: number;
  costoTotal: number;
  /** viajes × capacidad — null sin viajes cargados (no es lo mismo que 0 viajes). */
  toneladasEstimadas: number | null;
}

/**
 * El costo de un registro — "Costo máquina (aux)"/"Costo MO (aux)"/"Costo
 * fletero (aux)" de la planilla real, calculados en vez de cacheados.
 * Verificado cifra por cifra: Orsatti "Camión grande", 8 h, agosto 2026 →
 * $445.084 = 8 × $55.635,50 (tarifa de "Camión grande" de agosto) — la
 * MISMA tarifa que Schneider con el mismo camión, confirmando que depende
 * del tipo de camión y no del fletero.
 */
export function costoDeRegistro(
  r: RegistroDestape,
  tarifas: TarifaDestape[],
  capacidades: CapacidadFletero[]
): CostoDestape {
  if (r.tipoRecurso === "operario_propio") {
    const tarifaMaquina = r.equipoCodigo ? tarifaVigenteDestape(tarifas, "maquina_propia", r.equipoCodigo, r.fecha) : null;
    const tarifaMo = tarifaVigenteDestape(tarifas, "mo_propia", "general", r.fecha);
    const costoMaquina = tarifaMaquina !== null ? r.horas * tarifaMaquina : 0;
    const costoMo = tarifaMo !== null ? r.horas * tarifaMo : 0;
    return { costoMaquina, costoMo, costoFletero: 0, costoTotal: costoMaquina + costoMo, toneladasEstimadas: null };
  }

  const tarifaFletero = r.tipoCamion ? tarifaVigenteDestape(tarifas, "fletero_externo", r.tipoCamion, r.fecha) : null;
  const costoFletero = tarifaFletero !== null ? r.horas * tarifaFletero : 0;
  const capacidad = capacidadDe(capacidades, r.fleteroId, r.tipoCamion);
  const toneladasEstimadas = r.viajes !== null ? r.viajes * capacidad : null;
  return { costoMaquina: 0, costoMo: 0, costoFletero, costoTotal: costoFletero, toneladasEstimadas };
}

export interface FleteroLiviano {
  id: string;
  nombre: string;
}

/**
 * "Orsatti", "Amaray"... de la columna "Operario / Empresa" de la planilla
 * real a un fletero de `cantera_fleteros`. Los fleteros están cargados con
 * un número cuando hay más de un camión del mismo apellido ("Orsatti 1",
 * "Orsatti 2") pero la planilla de destape los anota sin número — un match
 * exacto resuelve los que no repiten (Amaray, Schneider); "Orsatti" y
 * "Dumerauf" quedan sin resolver a propósito, mismo criterio que ya usa
 * Cantera con las pesadas de balanza sin fletero: enlazar a uno de los dos
 * al azar sería peor que null.
 */
export function resolverFleteroDestape(raw: string, fleteros: FleteroLiviano[]): string | null {
  const normalizado = raw.trim().toLowerCase();
  if (!normalizado) return null;

  const exacto = fleteros.find((f) => f.nombre.trim().toLowerCase() === normalizado);
  if (exacto) return exacto.id;

  const candidatos = fleteros.filter((f) => f.nombre.trim().toLowerCase().startsWith(`${normalizado} `));
  return candidatos.length === 1 ? candidatos[0].id : null;
}

export interface EmpleadoLiviano {
  id: string;
  nombre: string;
  apellido: string;
}

/**
 * "Jorge Becker", "Martín Farias"... a un empleado de `empleados`. La
 * planilla anota nombre+apellido en un solo texto libre, sin el orden fijo
 * de la base (`nombre`/`apellido` separados) — se busca por apellido
 * exacto (la última palabra del texto) y, si hay más de un empleado con ese
 * apellido, se desambigua por si el nombre de pila aparece en alguna de las
 * palabras restantes. Sin esa coincidencia, o con más de un candidato
 * igual de válido, queda sin resolver: mismo criterio que `resolverFleteroDestape`.
 */
export function resolverOperarioDestape(raw: string, empleados: EmpleadoLiviano[]): string | null {
  const palabras = raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return null;

  const apellidoBuscado = palabras[palabras.length - 1];
  const nombrePalabras = palabras.slice(0, -1);

  const porApellido = empleados.filter((e) => e.apellido.trim().toLowerCase() === apellidoBuscado);
  if (porApellido.length === 0) return null;
  if (porApellido.length === 1) return porApellido[0].id;

  const porNombreYApellido = porApellido.filter((e) => {
    const nombreLower = e.nombre.trim().toLowerCase();
    return nombrePalabras.some((p) => nombreLower.includes(p));
  });
  return porNombreYApellido.length === 1 ? porNombreYApellido[0].id : null;
}

export interface FilaResumenYacimiento {
  yacimientoCodigo: string;
  horasOperario: number;
  horasFletero: number;
  costoMaquina: number;
  costoMo: number;
  costoFletero: number;
  costoTotal: number;
}

/** "Resumen → Por yacimiento" — junta todos los registros de un período. */
export function resumenPorYacimiento(
  registros: (RegistroDestape & { yacimientoCodigo: string | null })[],
  tarifas: TarifaDestape[],
  capacidades: CapacidadFletero[]
): FilaResumenYacimiento[] {
  const porYacimiento = new Map<string, FilaResumenYacimiento>();
  for (const r of registros) {
    const clave = r.yacimientoCodigo ?? "(sin yacimiento)";
    const fila = porYacimiento.get(clave) ?? {
      yacimientoCodigo: clave, horasOperario: 0, horasFletero: 0, costoMaquina: 0, costoMo: 0, costoFletero: 0, costoTotal: 0,
    };
    const costo = costoDeRegistro(r, tarifas, capacidades);
    if (r.tipoRecurso === "operario_propio") fila.horasOperario += r.horas;
    else fila.horasFletero += r.horas;
    fila.costoMaquina += costo.costoMaquina;
    fila.costoMo += costo.costoMo;
    fila.costoFletero += costo.costoFletero;
    fila.costoTotal += costo.costoTotal;
    porYacimiento.set(clave, fila);
  }
  return [...porYacimiento.values()].sort((a, b) => b.costoTotal - a.costoTotal);
}
