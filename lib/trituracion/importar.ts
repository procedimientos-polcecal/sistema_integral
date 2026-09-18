/**
 * Parsea una fila cruda de `PLANTA {N}` (leída con `sinFormato: true`, o sea
 * `UNFORMATTED_VALUE`) a un parte para insertar. Puro, sin red — lo usa
 * `scripts/importar-trituracion-2026.mts`.
 *
 * Sin `dateTimeRenderOption: FORMATTED_STRING` (que `lib/core/sheets.ts` no
 * ofrece y no hace falta pedir aparte: `fechaDeSheets` ya sabe leer el serial
 * numérico), la fecha viaja como serial de Sheets y no como texto — así que
 * los tres formatos de fecha distintos por pestaña (d/m/yyyy, dd-mm-yy,
 * dd/mm/yy) NUNCA llegan a ser un problema acá: son sólo cómo se ve la
 * celda, no cómo viaja el dato. Documentado en el spec como si hiciera falta
 * un parser por pestaña — no hace falta, y queda esta nota para no repetir
 * la búsqueda.
 *
 * La hora sí viaja distinto: una celda de hora es una fracción del día
 * (0,1944… para las 4:40), no un texto — `horaDeCelda` la convierte a
 * "HH:MM".
 */

import { fechaDeSheets } from "@/lib/core/fechaDeSheets";

/** Fracción de día (0..1) → "HH:MM". Null si no es una fracción de día válida. */
export function horaDeCelda(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "string" && /^\d{1,2}:\d{2}$/.test(valor)) {
    const [h, m] = valor.split(":");
    return `${h.padStart(2, "0")}:${m}`;
  }
  const n = Number(valor);
  if (isNaN(n) || n < 0 || n >= 1) return null;
  const minutosTotales = Math.round(n * 24 * 60);
  const h = Math.floor(minutosTotales / 60);
  const m = minutosTotales % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function numeroOCero(valor: unknown): number {
  const n = Number(valor);
  return isNaN(n) ? 0 : n;
}

function numeroONull(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return isNaN(n) ? null : n;
}

function textoONull(valor: unknown): string | null {
  const s = String(valor ?? "").trim();
  return s === "" ? null : s;
}

export interface ParteImportado {
  fecha: string; // "YYYY-MM-DD"
  estado: "opero" | "no_opero";
  motivo_no_operativo: string | null;
  material: string | null;
  origen: string | null;
  hora_inicio: string | null;
  hora_fin: string | null;
  horas_mantenimiento: number;
  horas_falta_piedra: number;
  horas_produccion: number;
  horas_otro: number;
  camiones_llegados: number | null;
  toneladas_procesadas: number | null;
  observaciones: string | null;
}

/**
 * Una fila es "real" cuando alguien la transcribió, no cuando la fecha existe:
 * las tres pestañas tienen fechas pre-rellenadas por fórmula hasta 2027-2029
 * sin ningún otro dato. `Estado` o `Material` no vacío es la señal.
 */
export function parteDeFilaCruda(fila: unknown[]): ParteImportado | null {
  const fecha = fechaDeSheets(fila[0]);
  if (!fecha || !fecha.startsWith("2026-")) return null;

  const estadoTexto = String(fila[1] ?? "").trim();
  const material = textoONull(fila[2]);
  const observaciones = textoONull(fila[19]);

  // Fila sin ningún dato real (fecha pre-rellenada por fórmula, nunca cargada).
  if (estadoTexto === "" && !material) return null;

  const noOpero = estadoTexto === "No operó";

  return {
    fecha,
    estado: noOpero ? "no_opero" : "opero",
    motivo_no_operativo: noOpero ? observaciones : null,
    material: noOpero ? null : material,
    origen: noOpero ? null : textoONull(fila[3]),
    hora_inicio: noOpero ? null : horaDeCelda(fila[4]),
    hora_fin: noOpero ? null : horaDeCelda(fila[5]),
    horas_mantenimiento: numeroOCero(fila[7]),
    horas_falta_piedra: numeroOCero(fila[8]),
    horas_produccion: numeroOCero(fila[9]),
    horas_otro: numeroOCero(fila[10]),
    camiones_llegados: numeroONull(fila[14]),
    toneladas_procesadas: numeroONull(fila[15]),
    observaciones: noOpero ? null : observaciones,
  };
}

/**
 * Combina dos partes del mismo día (mismo `unique(planta_id, fecha)`) en
 * uno solo. Encontrado en el relevamiento: 4 de 179 días reales (2%) tienen
 * DOS filas — dos turnos consecutivos con material distinto, no un error de
 * carga (ej. Planta 1, 16/07/2026: 04:50–11:00 con Caliza/PEZZUCCHI, luego
 * 11:30–15:00 con Chocolata/ACOPIO). El horario, las horas paradas, los
 * camiones y las toneladas son aditivos y se suman sin perder nada — es
 * justamente lo que ya hace el "Total del mes" de la propia planilla, que
 * suma renglones y no días. Material/origen no se pueden sumar, así que se
 * listan los dos y se anota en observaciones que es un día combinado.
 */
function combinarPartesDelMismoDia(a: ParteImportado, b: ParteImportado): ParteImportado {
  const horaInicio = [a.hora_inicio, b.hora_inicio].filter((h): h is string => h !== null).sort()[0] ?? null;
  const horaFin = [a.hora_fin, b.hora_fin].filter((h): h is string => h !== null).sort().slice(-1)[0] ?? null;
  const material = [a.material, b.material].filter(Boolean).join(" + ") || null;
  const origen = [a.origen, b.origen].filter(Boolean).join(" + ") || null;
  const nota = `Día con 2 registros en la planilla, combinados al importar: ${a.material ?? "?"}/${a.origen ?? "?"} y ${b.material ?? "?"}/${b.origen ?? "?"}.`;
  const observaciones = [nota, a.observaciones, b.observaciones].filter(Boolean).join(" — ");

  return {
    fecha: a.fecha,
    estado: "opero",
    motivo_no_operativo: null,
    material,
    origen,
    hora_inicio: horaInicio,
    hora_fin: horaFin,
    horas_mantenimiento: a.horas_mantenimiento + b.horas_mantenimiento,
    horas_falta_piedra: a.horas_falta_piedra + b.horas_falta_piedra,
    horas_produccion: a.horas_produccion + b.horas_produccion,
    horas_otro: a.horas_otro + b.horas_otro,
    camiones_llegados: (a.camiones_llegados ?? 0) + (b.camiones_llegados ?? 0),
    toneladas_procesadas: (a.toneladas_procesadas ?? 0) + (b.toneladas_procesadas ?? 0),
    observaciones,
  };
}

/**
 * Todas las filas reales de 2026 de una pestaña `PLANTA {N}`, con los días
 * de dos filas ya combinados en una. Las tres primeras filas son
 * encabezados (título, sub-encabezados, columnas).
 */
export function partesDe2026(filas: unknown[][]): { partes: ParteImportado[]; saltadas: number } {
  const crudas: ParteImportado[] = [];
  let saltadas = 0;
  for (const fila of filas.slice(3)) {
    const p = parteDeFilaCruda(fila);
    if (p) crudas.push(p);
    else saltadas++;
  }

  const porFecha = new Map<string, ParteImportado>();
  for (const p of crudas) {
    const existente = porFecha.get(p.fecha);
    porFecha.set(p.fecha, existente ? combinarPartesDelMismoDia(existente, p) : p);
  }

  return { partes: [...porFecha.values()].sort((x, y) => x.fecha.localeCompare(y.fecha)), saltadas };
}
