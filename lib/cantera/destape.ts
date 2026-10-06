/**
 * El costo de destapar un frente de cantera — horas de máquina propia (con
 * su operario) o de un fletero externo con camión, por día. Puro: no toca
 * la base. Relevado contra la planilla real
 * (1SvF0HK3Zu6Mi5Z_tTokJAypWvHHHp9oEomucqJudE3Y) el 21/09/2026.
 *
 * A pedido del usuario (21/09/2026) ninguna de las tres fuentes de costo es
 * ya una tarifa propia de destape cargada a mano:
 * - **Mano de obra propia** vale lo que cobra ESE operario
 *   (`empleados.valor_hora_normal`), no una tarifa "mo_propia" única — que
 *   además nunca se llegó a cargar en producción.
 * - **Máquina propia** se calcula afuera de este archivo (necesita Odoo y
 *   Taller Vial, no es puro) en `lib/cantera/costoMaquinaOdoo.ts` y llega acá
 *   ya resuelto en $/h por equipo — `costoDeRegistro` sólo lo multiplica por
 *   las horas.
 * - **Fletero externo** es la tarifa "horas_destape" de Acarreo
 *   (`lib/cantera/acarreo.ts`, `cantera_tarifas_acarreo`) × 2 si el camión es
 *   grande, × 1 si es chico. Verificado contra la pestaña "Tarifas" real: el
 *   valor de "Camión grande" es EXACTAMENTE el doble de "Camión chico" en
 *   las 4 vigencias cargadas (48017,64/24008,82, 51638,16/25819,08,
 *   53754,52/26877,26, 55635,5/27817,75) — no una tarifa aparte, el doble de
 *   la de siempre. `cantera_tarifas_destape` ya no existe.
 */

import { tarifaVigente, type TarifaAcarreo } from "./acarreo";

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

/** El multiplicador de la tarifa "horas_destape" de Acarreo según el camión — verificado contra la planilla real, ver el comment de arriba del archivo. */
const MULTIPLICADOR_POR_CAMION: Record<TipoDeCamion, number> = {
  camion_grande: 2,
  camion_chico: 1,
};

export interface RegistroDestape {
  fecha: string; // "YYYY-MM-DD"
  tipoRecurso: TipoDeRecurso;
  /** Código de equipo ("EM3"), sólo con sentido si tipoRecurso = operario_propio. */
  equipoCodigo: string | null;
  /** `empleados.valor_hora_normal` del operario, resuelto por quien llama — sólo con sentido si tipoRecurso = operario_propio. */
  operarioValorHora: number | null;
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
  /** viajes × promedio de toneladas por viaje del fletero — null sin viajes cargados o sin historial de acarreo para estimar (no es lo mismo que 0 viajes). */
  toneladasEstimadas: number | null;
}

/**
 * El costo de un registro — "Costo máquina (aux)"/"Costo MO (aux)"/"Costo
 * fletero (aux)" de la planilla real, calculados en vez de cacheados.
 * Verificado cifra por cifra: Orsatti "Camión grande", 8 h, agosto 2026 →
 * $445.084 = 8 × $55.635,50 (tarifa de "Camión grande" de agosto) — la
 * MISMA tarifa que Schneider con el mismo camión, confirmando que depende
 * del tipo de camión y no del fletero.
 *
 * `costoHoraPorEquipo` llega ya resuelto por equipo ("EM3" → $/h de ese mes,
 * de `lib/cantera/costoMaquinaOdoo.ts`) — acá sólo se multiplica por las
 * horas, no se calcula.
 */
export function costoDeRegistro(
  r: RegistroDestape,
  tarifasAcarreo: TarifaAcarreo[],
  toneladasPromedioPorFletero: Record<string, number>,
  costoHoraPorEquipo: Record<string, number>
): CostoDestape {
  if (r.tipoRecurso === "operario_propio") {
    const costoHoraMaquina = r.equipoCodigo ? costoHoraPorEquipo[r.equipoCodigo] : undefined;
    const costoMaquina = costoHoraMaquina !== undefined ? r.horas * costoHoraMaquina : 0;
    const costoMo = r.operarioValorHora !== null ? r.horas * r.operarioValorHora : 0;
    return { costoMaquina, costoMo, costoFletero: 0, costoTotal: costoMaquina + costoMo, toneladasEstimadas: null };
  }

  const tarifaBase = tarifaVigente(tarifasAcarreo, "horas_destape", r.fecha)?.tarifa ?? null;
  const costoFletero = tarifaBase !== null && r.tipoCamion !== null
    ? r.horas * tarifaBase * MULTIPLICADOR_POR_CAMION[r.tipoCamion]
    : 0;
  const promedio = r.fleteroId ? toneladasPromedioPorFletero[r.fleteroId] : undefined;
  const toneladasEstimadas = r.viajes !== null && promedio !== undefined ? r.viajes * promedio : null;
  return { costoMaquina: 0, costoMo: 0, costoFletero, costoTotal: costoFletero, toneladasEstimadas };
}

/**
 * Cuánto transporta en promedio un fletero por viaje, medido sobre TODAS sus
 * pesadas reales de Acarreo (`cantera_pesadas`), sin filtrar por material —
 * reemplaza a la "capacidad" que se cargaba a mano por fletero+tipo de
 * camión (se sacó de destape: no había forma de relevarla, y en la práctica
 * quedaba en 0 para casi todos). Un fletero sin ninguna pesada resuelta no
 * aparece en el resultado — mismo criterio que el resto del sistema: no
 * inventar un 0 donde no hay dato.
 */
export function toneladasPromedioPorFletero(
  pesadas: { fleteroId: string | null; toneladas: number }[]
): Record<string, number> {
  const totales = new Map<string, { suma: number; cantidad: number }>();
  for (const p of pesadas) {
    if (!p.fleteroId) continue;
    const acc = totales.get(p.fleteroId) ?? { suma: 0, cantidad: 0 };
    acc.suma += p.toneladas;
    acc.cantidad += 1;
    totales.set(p.fleteroId, acc);
  }
  return Object.fromEntries([...totales.entries()].map(([id, { suma, cantidad }]) => [id, suma / cantidad]));
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
  tarifasAcarreo: TarifaAcarreo[],
  toneladasPromedioPorFletero: Record<string, number>,
  costoHoraPorEquipo: Record<string, number>
): FilaResumenYacimiento[] {
  const porYacimiento = new Map<string, FilaResumenYacimiento>();
  for (const r of registros) {
    const clave = r.yacimientoCodigo ?? "(sin yacimiento)";
    const fila = porYacimiento.get(clave) ?? {
      yacimientoCodigo: clave, horasOperario: 0, horasFletero: 0, costoMaquina: 0, costoMo: 0, costoFletero: 0, costoTotal: 0,
    };
    const costo = costoDeRegistro(r, tarifasAcarreo, toneladasPromedioPorFletero, costoHoraPorEquipo);
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
