/**
 * Una pesada de la balanza: una fila de la pestaña "Datos" de la planilla de
 * transporte, ya resuelta a un tipo de `lib/cantera/acarreo.ts` y a un
 * fletero — cuando se puede, sin adivinar cuando no.
 *
 * Todo lo de acá es puro (sin red): parsea filas ya leídas de la planilla o
 * ya traídas de la base. `scripts/importar-acarreo-2026.mts` es quien habla
 * con Sheets y con Supabase.
 */

import type { AcarreoPlano } from "./acarreo";
import type { PesadaDB } from "./types";

/**
 * Las columnas de material de "Datos", en el mismo orden en que están en la
 * planilla, mapeadas al tipo de `lib/cantera/acarreo.ts` que les corresponde.
 * Las tres "Destape ..." quedan sin tipo a propósito: es sobrecarga, no
 * piedra tarifada, y no hay un tipo de acarreo para eso todavía.
 */
export const COLUMNAS_DE_MATERIAL: { columna: string; tipo: string | null }[] = [
  { columna: "Dolomita D1", tipo: "dolomita_d1" },
  { columna: "Dolomita D6", tipo: "dolomita_d6" },
  { columna: "Chocolata 1", tipo: "chocolata_1" },
  { columna: "Chocolata 3", tipo: "chocolata_3" },
  { columna: "Caliza", tipo: "caliza" },
  { columna: "Arcilla", tipo: "arcilla" },
  { columna: "Finos Dolomita", tipo: "finos_dolomita" },
  { columna: "Descarte Dolomita", tipo: "descarte_dolomita" },
  { columna: "Finos Chocolata", tipo: "finos_chocolata" },
  { columna: "Descarte Chocolata", tipo: "descarte_chocolata" },
  { columna: "Material a Pavone (Arena)", tipo: "material_a_pavone" },
  { columna: "Finos Caliza", tipo: "finos_caliza" },
  { columna: "Material desde Pavone", tipo: "material_desde_pavone" },
  { columna: "Estabilizado a Cantera", tipo: "estabilizado_a_cantera" },
  { columna: "Destape D1", tipo: null },
  { columna: "Destape D4", tipo: null },
  { columna: "Destape Caliza", tipo: null },
];

/**
 * Los 11 fleteros reales (relevados de "Ingreso de Datos"), con las patentes
 * tal como aparecen entre paréntesis en "Datos" — sin espacios, para
 * comparar. "Schneider" junta dos camiones (GBL 929 y VGC 250) bajo un solo
 * fletero, como ya está en la planilla ("Schneider 1 y 2").
 */
export const FLETEROS_CONOCIDOS: { nombre: string; patentes: string[] }[] = [
  { nombre: "Amaray", patentes: ["XAG816"] },
  { nombre: "Arenzo", patentes: ["XKH193"] },
  { nombre: "Dumerauf 1", patentes: ["SQV625"] },
  { nombre: "Dumerauf 2", patentes: ["SNJ857"] },
  { nombre: "Luna", patentes: ["WIR377"] },
  { nombre: "Maneri", patentes: ["XDI196"] },
  { nombre: "Orsatti 1", patentes: ["CBL541"] },
  { nombre: "Orsatti 2", patentes: ["WVI773"] },
  { nombre: "Priola", patentes: ["SQE513"] },
  { nombre: "Schneider", patentes: ["GBL929", "VGC250"] },
  { nombre: "Timpanaro", patentes: ["UYY807"] },
];

function normalizarPatente(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Resuelve el texto de fletero de una fila de "Datos" a uno de los 11
 * conocidos, o `null` si no se puede sin adivinar.
 *
 * Se prueba primero por patente —entre paréntesis, es inequívoca— y recién
 * si no hay o no matchea, por nombre. Por nombre sólo resuelve cuando el
 * fletero tiene un solo camión conocido: "Priola" o "Schneider" a secas no
 * son ambiguos porque en la lista real hay uno solo de cada uno, pero
 * "Dumerauf" u "Orsatti" a secas sí lo son —hay dos de cada uno— y
 * "enlazar al que se le parece" ahí sería una apuesta, no una lectura.
 */
export function normalizarFletero(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const texto = raw.trim();
  if (!texto) return null;

  const patenteMatch = texto.match(/\(([^)]+)\)/);
  if (patenteMatch) {
    const patente = normalizarPatente(patenteMatch[1]);
    const porPatente = FLETEROS_CONOCIDOS.find((f) => f.patentes.some((p) => normalizarPatente(p) === patente));
    if (porPatente) return porPatente.nombre;
  }

  const nombre = texto.replace(/\([^)]*\)/g, "").trim().toUpperCase().replace(/\s+/g, " ");

  // Un solo camión conocido con ese nombre: "PRIOLA2"/"PRIOLA 2" también caen
  // acá, porque no hay un segundo Priola con el que confundirse.
  const SIN_AMBIGUEDAD: Record<string, string> = {
    AMARAY: "Amaray",
    ARENZO: "Arenzo",
    LUNA: "Luna",
    MANERI: "Maneri",
    TIMPANARO: "Timpanaro",
    PRIOLA: "Priola",
    PRIOLA2: "Priola",
    "PRIOLA 2": "Priola",
    SCHNEIDER: "Schneider",
    "SCHNEIDER 1": "Schneider",
    "SCHNEIDER 2": "Schneider",
  };
  if (nombre in SIN_AMBIGUEDAD) return SIN_AMBIGUEDAD[nombre];

  // Con número, no son ambiguos.
  if (nombre === "DUMERAUF 1") return "Dumerauf 1";
  if (nombre === "DUMERAUF 2") return "Dumerauf 2";
  if (nombre === "ORSATTI 1") return "Orsatti 1";
  if (nombre === "ORSATTI 2") return "Orsatti 2";

  // "Dumerauf" y "Orsatti" a secas, "Orsatti 3" (no existe un tercero
  // conocido), "Conte"/"Taibo Rubén" (no están en la lista de 11): sin
  // fletero. Se guarda `fletero_raw` igual, para poder revisarlo después.
  return null;
}

/**
 * Una pesada ya resuelta, lista para `cantera_pesadas`.
 */
export interface PesadaResuelta {
  fecha: string; // "YYYY-MM-DD"
  hora: string | null;
  bruto: number | null;
  tara: number | null;
  tipo: string | null;
  toneladas: number;
  origen: string | null;
  destino: string | null;
  fleteroRaw: string | null;
  fleteroNombre: string | null;
}

/**
 * "2/1/2026" (d/m/yyyy de la planilla) a ISO. Nunca m/d — ya dio vuelta 885
 * fechas en Compras.
 */
export function fechaDatosAIso(valor: string): string | null {
  const m = valor.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mes, anio] = m;
  return `${anio}-${mes.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/**
 * Una fila cruda de "Datos" (el orden real de columnas, `Datos!A:Y`) a una
 * pesada resuelta, o `null` si la fila no tiene fecha o no tiene ningún
 * material con neto cargado (filas en blanco al final de la hoja).
 *
 * `fila` tiene que venir de un rango con columna final explícita
 * (`Datos!A2:Y...`): pedido sin rango, Sheets recorta las celdas vacías del
 * final de cada fila y un índice fijo deja de servir fila por fila —así se
 * leyó mal esta columna la primera vez.
 */
export function pesadaDeFilaCruda(fila: string[]): PesadaResuelta | null {
  const fecha = fechaDatosAIso(fila[0] ?? "");
  if (!fecha) return null;

  let tipo: string | null = null;
  let toneladas = 0;
  for (let i = 0; i < COLUMNAS_DE_MATERIAL.length; i++) {
    const valor = Number(String(fila[4 + i] ?? "").replace(",", "."));
    if (!isFinite(valor) || valor === 0) continue;
    tipo = COLUMNAS_DE_MATERIAL[i].tipo;
    toneladas = valor / 1000; // la planilla lo da en kilos
    break; // una sola columna de material tiene valor por fila, medido
  }
  if (toneladas === 0) return null;

  const fleteroRaw = fila[23]?.trim() || null;

  return {
    fecha,
    hora: fila[1]?.trim() || null,
    bruto: fila[2] ? Number(fila[2]) : null,
    tara: fila[3] ? Number(fila[3]) : null,
    tipo,
    toneladas,
    origen: fila[21]?.trim() || null,
    destino: fila[22]?.trim() || null,
    fleteroRaw,
    fleteroNombre: normalizarFletero(fleteroRaw),
  };
}

/**
 * Las pesadas ya en la base, sumadas por fletero+tipo+mes — el mismo formato
 * (`AcarreoPlano`) que usan `resumenPorFletero`/`toneladasPorYacimiento` de
 * `acarreo.ts`, para poder juntarlas con las tres actividades manuales sin
 * que esas funciones sepan que unas vienen de una pesada y otras de un
 * formulario.
 *
 * Sin fletero o sin tipo (destape, o un fletero que no se pudo resolver al
 * importar) quedan afuera: no hay a quién ni a qué tarifa cargárselas.
 */
export function agruparPesadasPorFleteroTipoMes(pesadas: PesadaDB[]): AcarreoPlano[] {
  const totales = new Map<string, number>();
  for (const p of pesadas) {
    if (!p.fletero_id || !p.tipo) continue;
    const mes = `${p.fecha.slice(0, 7)}-01`;
    const clave = `${p.fletero_id}|${p.tipo}|${mes}`;
    totales.set(clave, (totales.get(clave) ?? 0) + p.toneladas);
  }
  return [...totales.entries()].map(([clave, cantidad]) => {
    const [fleteroId, tipo, mes] = clave.split("|");
    return { fleteroId, tipo, mes, cantidad };
  });
}
