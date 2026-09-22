/**
 * Parsea una fila cruda de "Respuestas de formulario 1" (el form "PARTE
 * DIARIO EQUIPOS MÓVILES") a uno o dos partes para insertar. Puro, sin red
 * — lo usa `lib/tallerVial/importarPartes.ts`.
 *
 * El form junta dos "Datos del turno" (equipo/sector/horario) en una sola
 * respuesta cuando el operario contesta "No, hice otra actividad." en el
 * primero — la hoja de respuestas los pone en columnas repetidas, no en
 * filas separadas. Acá se separan en hasta dos `ParteParaInsertar`, uno por
 * bloque, porque cada uno es una unidad de trabajo independiente (puede
 * tener equipo y sector distintos).
 *
 * Columnas reales (relevadas el 22/09/2026 contra el form y su planilla):
 *   0 Marca temporal · 1 Fecha · 2 Operador ·
 *   3 Equipo utilizado (bloque 1) · 4 Sector trabajado (bloque 1) ·
 *   5 Hora de inicio (bloque 1) · 6 Hora de fin (bloque 1) ·
 *   7 ¿Cargaste todo tu trabajo de hoy? (bloque 1) ·
 *   8-12 lo mismo para el bloque 2 · 13 Observaciones
 */

import { fechaDeSheets } from "@/lib/core/fechaDeSheets";
import { horaDeCelda } from "@/lib/core/horaDeCelda";
import { horasTeoricas } from "@/lib/trituracion/horas";
import { codigoDesdeTextoLibre } from "./equipos";
import { resolverOperarioPorNombreCompleto, type EmpleadoLiviano } from "./operarios";

/** Los únicos 4 yacimientos que el dropdown de "Sector trabajado" ofrece para destape. */
const YACIMIENTOS_VALIDOS = ["D1", "D6", "C1", "C3"];

/** "Destape D1" → "D1". Cualquier otro sector (incluido "D1" solo, sin destape) da null. */
export function yacimientoDeDestape(sectorRaw: string): string | null {
  const m = sectorRaw.trim().match(/^Destape\s+(.+)$/i);
  if (!m) return null;
  const codigo = m[1].trim().toUpperCase();
  return YACIMIENTOS_VALIDOS.includes(codigo) ? codigo : null;
}

export interface ParteParaInsertar {
  marcaTemporal: string;
  bloque: 1 | 2;
  fecha: string; // "YYYY-MM-DD"
  operarioRaw: string;
  operarioId: string | null;
  equipoRaw: string;
  equipoId: string | null;
  sectorRaw: string;
  yacimientoDestapeCodigo: string | null;
  horaInicio: string | null;
  horaFin: string | null;
  horas: number | null;
  cargasteTodo: string | null;
  observaciones: string | null;
}

export interface EquipoLiviano {
  id: string;
  code: string;
}

function textoONull(valor: unknown): string | null {
  const s = String(valor ?? "").trim();
  return s === "" ? null : s;
}

function armarBloque(
  fila: unknown[],
  offsetEquipo: number,
  bloque: 1 | 2,
  comun: { marcaTemporal: string; fecha: string; operarioRaw: string; operarioId: string | null; observaciones: string | null },
  idPorCodigoEquipo: Map<string, string>
): ParteParaInsertar | null {
  const equipoRaw = textoONull(fila[offsetEquipo]);
  const sectorRaw = textoONull(fila[offsetEquipo + 1]);
  if (!equipoRaw || !sectorRaw) return null; // bloque 2 sin cargar: no hubo "otra actividad" ese día

  const codigoEquipo = codigoDesdeTextoLibre(equipoRaw);
  const horaInicio = horaDeCelda(fila[offsetEquipo + 2]);
  const horaFin = horaDeCelda(fila[offsetEquipo + 3]);

  return {
    ...comun,
    bloque,
    equipoRaw,
    equipoId: codigoEquipo ? idPorCodigoEquipo.get(codigoEquipo) ?? null : null,
    sectorRaw,
    yacimientoDestapeCodigo: yacimientoDeDestape(sectorRaw),
    horaInicio,
    horaFin,
    horas: horasTeoricas(horaInicio, horaFin),
    cargasteTodo: textoONull(fila[offsetEquipo + 4]),
    // Las Observaciones del form son una sola, al final de la respuesta: se anotan en el último bloque cargado, no en los dos.
    observaciones: bloque === 1 ? null : comun.observaciones,
  };
}

/**
 * Hasta dos partes de una fila cruda de respuestas. El bloque 2 sólo
 * aparece si el operario cargó "otra actividad" ese día (columnas 8-12 no
 * vacías) — si no, `armarBloque` devuelve `null` para ese offset y se
 * descarta.
 */
export function partesDeFilaCruda(
  fila: unknown[],
  catalogos: { equipos: EquipoLiviano[]; empleados: EmpleadoLiviano[] }
): ParteParaInsertar[] {
  const marcaTemporal = textoONull(fila[0]);
  const fecha = fechaDeSheets(fila[1]);
  const operarioRaw = textoONull(fila[2]);
  if (!marcaTemporal || !fecha || !operarioRaw) return []; // fila sin lo mínimo para identificarla, no se procesa

  const comun = {
    marcaTemporal,
    fecha,
    operarioRaw,
    operarioId: resolverOperarioPorNombreCompleto(operarioRaw, catalogos.empleados),
    observaciones: textoONull(fila[13]),
  };
  const idPorCodigoEquipo = new Map(catalogos.equipos.map((e) => [e.code, e.id]));

  const bloque1 = armarBloque(fila, 3, 1, comun, idPorCodigoEquipo);
  const bloque2 = armarBloque(fila, 8, 2, comun, idPorCodigoEquipo);
  return [bloque1, bloque2].filter((p): p is ParteParaInsertar => p !== null);
}
