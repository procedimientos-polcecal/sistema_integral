import { createAdminClient } from "@/lib/supabase/admin";
import { leerValores } from "@/lib/core/sheets";
import { FLETEROS_CONOCIDOS, pesadaDeFilaCruda, patentesParaMostrar } from "./pesadas";
import { TIPOS_DE_ACARREO } from "./acarreo";

/**
 * Trae de la planilla de balanza/transporte los fleteros, las tarifas
 * vigentes y las pesadas de "Datos" — la misma lógica que
 * `scripts/importar-acarreo-2026.mts`, que ahora es un envoltorio de esto
 * para poder correrla también desde un cron (`/api/cron/cantera-acarreo-sync`)
 * y no sólo a mano.
 *
 * **Ya NO trae las 5 actividades sin pesada de "Ingreso de Datos"** (horas de
 * destape, viaje de bloques, horas de bochones, viajes de estabilizado,
 * materiales Pezzuchi). Hasta el 21/09/2026 sí las traía; el usuario
 * confirmó que el equipo dejó de cargarlas en esa pestaña —de acá en más se
 * cargan por día directo en el SdG (`/cantera/acarreo/cargar`, migración
 * 20260921092307)— así que seguir leyéndolas de ahí las pisaría con un dato
 * viejo cada 15-30 minutos. Si el equipo vuelve a usar la planilla algún día,
 * hay que revisar esto de nuevo, no solo reactivarlo: la carga por día que
 * pidió el usuario y un total mensual tipeado en la planilla son dos fuentes
 * que pueden decir cosas distintas del mismo mes.
 *
 * **Los años están hardcodeados a 2026** (`PERIODOS_DE_TARIFA`): la planilla
 * real tiene "Tarifas" armada para un año calendario a la vez, con columnas
 * fijas por período. Cuando empiece 2027 esto va a dejar de traer nada nuevo
 * hasta que alguien lo actualice —no hay forma de deducir el año de la
 * estructura de la planilla, y adivinarlo mal escribiría en el año
 * equivocado. Documentado, no resuelto.
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

function tipoDeEtiqueta(etiqueta: string): string | null {
  const norm = etiqueta.trim().toLowerCase();
  return TIPOS_DE_ACARREO.find((t) => t.etiqueta.trim().toLowerCase() === norm)?.codigo ?? null;
}

export interface ResultadoImportacionAcarreo {
  fleteros: number;
  vigenciasDeTarifa: number;
  pesadasLeidas: number;
  pesadasConFletero: number;
  pesadasSinFletero: number;
  pesadasInsertadas: number;
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

  // Las 5 actividades sin pesada ("Ingreso de Datos") ya NO se sincronizan
  // desde acá — ver el comentario grande de arriba del archivo. Se cargan
  // por día directo en el SdG desde el 21/09/2026.

  return {
    fleteros: idPorFletero.size,
    vigenciasDeTarifa: tarifasAInsertar.length,
    pesadasLeidas: pesadas.length,
    pesadasConFletero,
    pesadasSinFletero: pesadas.length - pesadasConFletero,
    pesadasInsertadas,
    etiquetasSinTipo,
  };
}
