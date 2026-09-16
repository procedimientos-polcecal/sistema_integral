import { createAdminClient } from "@/lib/supabase/admin";
import { leerValores } from "@/lib/core/sheets";
import { FLETEROS_CONOCIDOS, pesadaDeFilaCruda, patentesParaMostrar } from "./pesadas";
import { TIPOS_DE_ACARREO } from "./acarreo";

/**
 * Trae de la planilla de balanza/transporte los fleteros, las tarifas
 * vigentes, las pesadas de "Datos" y las actividades sin pesada de "Ingreso
 * de Datos" (incluida "Materiales desde Pezzuchi") — la misma lógica que
 * `scripts/importar-acarreo-2026.mts`, que ahora es un envoltorio de esto
 * para poder correrla también desde un cron (`/api/cron/cantera-acarreo-sync`)
 * y no sólo a mano.
 *
 * **Los años están hardcodeados a 2026** (`PERIODOS_DE_TARIFA`, `MESES`): la
 * planilla real tiene "Ingreso de Datos"/"Tarifas" armadas para un año
 * calendario a la vez, con columnas fijas Enero-Diciembre. Cuando empiece
 * 2027 esto va a dejar de traer nada nuevo hasta que alguien lo actualice —no
 * hay forma de deducir el año de la estructura de la planilla, y adivinarlo
 * mal escribiría en el año equivocado. Documentado, no resuelto.
 */

// El script original nunca dependió de la variable de entorno —no está
// configurada en Vercel—, sólo de este id fijo. Se mantiene igual para que la
// sincronización automática funcione sin pedirle a nadie que agregue nada.
const LIBRO = () => process.env.GOOGLE_SHEETS_ACARREO_ID || "1E8mA7RPRPU3sXR0G0m9Oiwk7yBt0mo0rMTRFlX9ZHuw";

const PERIODOS_DE_TARIFA = [
  { columna: 3, desde: "2026-03-01", hasta: "2026-04-30" }, // marzo-abril
  { columna: 2, desde: "2026-05-01", hasta: "2026-06-30" }, // mayo-junio
  { columna: 1, desde: "2026-07-01", hasta: null as string | null }, // julio-agosto, vigente
];

const MESES = [
  "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
  "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12",
];

// Las cuatro actividades sin pesada: horas y viajes que Cantera carga a mano
// porque no pasan por la balanza, más "Materiales desde Pezzuchi" —piedra de
// un tercero, tonelada pero tampoco pesada acá. Ver el comentario grande que
// tenía el script para el porqué de cada una (Amaray julio, Schneider marzo).
const ACTIVIDADES_MANUALES = new Set([
  "Horas destape",
  "Viaje de bloques",
  "Hora movimiento bochones pozo",
  "Viajes de estabilizado",
  "Materiales desde Pezzuchi",
]);
// "Ingreso de Datos" dice "Materiales desde Pezzuchi"; "Tarifas" (de donde
// sale el `codigo` en TIPOS_DE_ACARREO) dice "Materiales pezzuchi".
const ALIAS_ACTIVIDAD: Record<string, string> = {
  "Materiales desde Pezzuchi": "Materiales Pezzuchi",
};

function tipoDeEtiqueta(etiqueta: string): string | null {
  const norm = etiqueta.trim().toLowerCase();
  return TIPOS_DE_ACARREO.find((t) => t.etiqueta.trim().toLowerCase() === norm)?.codigo ?? null;
}

function fleteroDeBloque(encabezado: string): string | null {
  // "Amaray  –  XAG 816" -> "Amaray"; "Schneider 1 y 2 – GBL 929 - (VGC 250)"
  // -> "Schneider". Por "empieza con", del nombre más largo al más corto para
  // que "Dumerauf 1" no caiga en un "Dumerauf" que no existe como fletero solo.
  const texto = encabezado.trim().toLowerCase();
  const porLargo = [...FLETEROS_CONOCIDOS].sort((a, b) => b.nombre.length - a.nombre.length);
  return porLargo.find((f) => texto.startsWith(f.nombre.toLowerCase()))?.nombre ?? null;
}

export interface ResultadoImportacionAcarreo {
  fleteros: number;
  vigenciasDeTarifa: number;
  pesadasLeidas: number;
  pesadasConFletero: number;
  pesadasSinFletero: number;
  pesadasInsertadas: number;
  actividadesInsertadas: number;
  bloquesSinFletero: string[];
  etiquetasSinTipo: string[];
}

/**
 * `escribir: false` sólo lee y cuenta —lo que usa el script a mano para
 * ensayar—; `true` además escribe. El cron siempre llama con `true`.
 */
export async function sincronizarAcarreoDesdeSheets(escribir: boolean): Promise<ResultadoImportacionAcarreo> {
  const libro = LIBRO();
  if (!libro) throw new Error("Falta GOOGLE_SHEETS_ACARREO_ID");

  const sb = createAdminClient();

  // ── 1. Fleteros: los 11 conocidos, con sus patentes (Schneider tiene dos) ──
  if (escribir) {
    const filas = FLETEROS_CONOCIDOS.map((f) => ({ nombre: f.nombre, patente: patentesParaMostrar(f.nombre) }));
    const { error } = await sb.from("cantera_fleteros").upsert(filas, { onConflict: "nombre" });
    if (error) throw new Error(`fleteros: ${error.message}`);
  }
  const { data: fleterosDB, error: errFleterosDB } = await sb.from("cantera_fleteros").select("id, nombre");
  if (errFleterosDB) throw new Error(`fleteros: ${errFleterosDB.message}`);
  const idPorFletero = new Map<string, string>((fleterosDB ?? []).map((f) => [f.nombre as string, f.id as string]));

  // ── 2. Tarifas: las tres vigencias reales relevadas ──
  const tarifasSheet = await leerValores(libro, "Tarifas");
  const tarifasAInsertar: { tipo: string; desde: string; hasta: string | null; tarifa: number }[] = [];
  const etiquetasSinTipo: string[] = [];
  for (const fila of tarifasSheet.slice(2)) {
    const etiqueta = (fila[0] ?? "").trim();
    if (!etiqueta) continue;
    const tipo = tipoDeEtiqueta(etiqueta);
    if (!tipo) { etiquetasSinTipo.push(etiqueta); continue; }
    for (const p of PERIODOS_DE_TARIFA) {
      const texto = (fila[p.columna] ?? "").trim();
      if (!texto) continue;
      const tarifa = Number(texto.replace(/[$.\s]/g, "").replace(",", "."));
      if (!isFinite(tarifa) || tarifa <= 0) continue;
      tarifasAInsertar.push({ tipo, desde: p.desde, hasta: p.hasta, tarifa });
    }
  }
  if (escribir && tarifasAInsertar.length) {
    const { error } = await sb.from("cantera_tarifas_acarreo").upsert(tarifasAInsertar, { onConflict: "tipo,desde" });
    if (error) throw new Error(`tarifas: ${error.message}`);
  }

  // ── 3. Pesadas: toda "Datos" ──
  const datosSheet = await leerValores(libro, "Datos!A2:Y100000");
  const pesadas = datosSheet.map(pesadaDeFilaCruda).filter((p): p is NonNullable<typeof p> => p !== null);
  const pesadasConFletero = pesadas.filter((p) => p.fleteroNombre).length;

  let pesadasInsertadas = 0;
  if (escribir) {
    // Sin clave natural (dos pesadas bien podrían tener misma fecha/hora/bruto)
    // no hay con qué hacer upsert: se borra todo y se recarga entero cada vez.
    // Es seguro porque esta tabla es 100% reproducible desde "Datos" —nada acá
    // lo carga a mano—, pero deja una ventana corta (entre el delete y el
    // insert) donde una lectura ve la tabla vacía. Asumido: correr esto cada
    // 15-30 min por cron hace esa ventana más frecuente que cuando era manual,
    // pero sigue siendo de segundos y sin clave natural no hay upsert posible
    // sin agregar una columna nueva (migración) que nadie pidió todavía.
    const { error: errDel } = await sb.from("cantera_pesadas").delete().not("id", "is", null);
    if (errDel) throw new Error(`pesadas (borrando lo anterior): ${errDel.message}`);

    const filas = pesadas.map((p) => ({
      fecha: p.fecha,
      hora: p.hora,
      bruto: p.bruto,
      tara: p.tara,
      tipo: p.tipo,
      toneladas: p.toneladas,
      origen: p.origen,
      destino: p.destino,
      fletero_raw: p.fleteroRaw,
      fletero_id: p.fleteroNombre ? (idPorFletero.get(p.fleteroNombre) ?? null) : null,
    }));
    const TAMANO_LOTE = 500;
    for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
      const lote = filas.slice(i, i + TAMANO_LOTE);
      const { error } = await sb.from("cantera_pesadas").insert(lote);
      if (error) throw new Error(`pesadas (lote ${i}): ${error.message}`);
      pesadasInsertadas += lote.length;
    }
  }

  // ── 4. Actividades y materiales sin pesada, desde "Ingreso de Datos" ──
  const ingresoSheet = await leerValores(libro, "Ingreso de Datos");
  const acarreosPorNombre: { fleteroNombre: string; tipo: string; mes: string; cantidad: number }[] = [];
  let fleteroActual: string | null = null;
  const bloquesSinFletero: string[] = [];
  for (const fila of ingresoSheet.slice(1)) {
    if (fila[0] && fila[0].trim()) {
      fleteroActual = fleteroDeBloque(fila[0]);
      if (!fleteroActual) bloquesSinFletero.push(fila[0]);
      continue;
    }
    const actividad = (fila[1] ?? "").trim();
    if (!fleteroActual || !ACTIVIDADES_MANUALES.has(actividad)) continue;
    const etiquetaBuscada = ALIAS_ACTIVIDAD[actividad] ?? actividad;
    const t = TIPOS_DE_ACARREO.find((t) => t.etiqueta === etiquetaBuscada);
    if (!t) continue;
    // Los materiales (acá sólo Pezzuchi) están en kilos con "." de miles, igual
    // que las columnas de "Datos"; la fórmula real de "Resumen" también divide
    // por 1000. Las horas y viajes son un conteo simple, sin conversión.
    const divisor = t.unidad === "tonelada" ? 1000 : 1;
    MESES.forEach((mes, i) => {
      const texto = (fila[2 + i] ?? "").trim();
      if (!texto || texto === "-") return;
      const cantidadCruda = Number(texto.replace(/\./g, "").replace(",", "."));
      if (!isFinite(cantidadCruda) || cantidadCruda <= 0) return;
      acarreosPorNombre.push({ fleteroNombre: fleteroActual!, tipo: t.codigo, mes: `${mes}-01`, cantidad: cantidadCruda / divisor });
    });
  }

  const acarreosAInsertar = acarreosPorNombre
    .map((a) => ({ fletero_id: idPorFletero.get(a.fleteroNombre), tipo: a.tipo, mes: a.mes, cantidad: a.cantidad }))
    .filter((a): a is { fletero_id: string; tipo: string; mes: string; cantidad: number } => Boolean(a.fletero_id));
  if (escribir && acarreosAInsertar.length) {
    const { error } = await sb.from("cantera_acarreos").upsert(acarreosAInsertar, { onConflict: "fletero_id,tipo,mes" });
    if (error) throw new Error(`actividades manuales: ${error.message}`);
  }

  return {
    fleteros: idPorFletero.size,
    vigenciasDeTarifa: tarifasAInsertar.length,
    pesadasLeidas: pesadas.length,
    pesadasConFletero,
    pesadasSinFletero: pesadas.length - pesadasConFletero,
    pesadasInsertadas,
    actividadesInsertadas: acarreosAInsertar.length,
    bloquesSinFletero,
    etiquetasSinTipo,
  };
}
