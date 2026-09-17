/**
 * Backfill único de "DATOS" (759 filas) de la planilla real de Taller Vial a
 * `taller_vial_cargas`. No queda como sync: de acá en adelante manda el SdG y
 * la carga es desde la pantalla, igual que Producción, Despacho y Cantera
 * fase 1. Se corre una sola vez, después de que las dos migraciones
 * (20260917094035 y 20260917094056) ya estén aplicadas.
 *
 *   npx tsx --env-file=.env.local scripts/importar-taller-vial-historico.mts
 */
import { createClient } from "@supabase/supabase-js";
import { leerValores } from "../lib/core/sheets";
import { fechaDeSheets } from "../lib/core/fechaDeSheets";
import { codigoDesdeTextoLibre } from "../lib/tallerVial/equipos";

const PLANILLA_ID = "1P1bZb3CxDgR_EulR8-lXUJTNsIZLu5rMVLh-VIY6N4g";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: equipos, error } = await supabase.from("equipos").select("id, code").ilike("code", "EM%");
  if (error) throw new Error(error.message);
  const idPorCodigo = new Map((equipos ?? []).map((e) => [e.code, e.id]));

  const valores = await leerValores(PLANILLA_ID, "DATOS");
  const filas = valores.slice(1); // sin encabezado

  const filasParaInsertar: {
    equipo_id: string | null;
    equipo_raw: string;
    fecha: string;
    litros: number;
    lectura: number | null;
  }[] = [];

  let sinFecha = 0;
  let sinLitros = 0;

  for (const fila of filas) {
    const [fechaRaw, equipoRaw, litrosRaw, lecturaRaw] = fila;
    const fecha = fechaDeSheets(fechaRaw);
    if (!fecha) { sinFecha++; continue; }

    const litros = Number(String(litrosRaw ?? "").replace(",", "."));
    if (!isFinite(litros) || litros <= 0) { sinLitros++; continue; }

    const equipoRawLimpio = String(equipoRaw ?? "").trim();
    const codigo = codigoDesdeTextoLibre(equipoRawLimpio);
    const equipoId = codigo ? (idPorCodigo.get(codigo) ?? null) : null;

    const lectura = lecturaRaw === undefined || lecturaRaw === "" ? null : Number(String(lecturaRaw).replace(",", "."));

    filasParaInsertar.push({
      equipo_id: equipoId,
      equipo_raw: equipoRawLimpio,
      fecha,
      litros,
      lectura: lectura !== null && isFinite(lectura) ? lectura : null,
    });
  }

  console.log(`${filas.length} filas leídas, ${filasParaInsertar.length} para insertar (${sinFecha} sin fecha, ${sinLitros} sin litros).`);
  const sinEquipo = filasParaInsertar.filter((f) => f.equipo_id === null).length;
  console.log(`${sinEquipo} sin equipo reconocido (no empiezan con un código EM).`);

  // De a 500: el insert de Supabase tiene su propio límite de payload.
  for (let i = 0; i < filasParaInsertar.length; i += 500) {
    const lote = filasParaInsertar.slice(i, i + 500);
    const { error: errorInsert } = await supabase.from("taller_vial_cargas").insert(lote);
    if (errorInsert) throw new Error(errorInsert.message);
    console.log(`Insertadas ${Math.min(i + 500, filasParaInsertar.length)}/${filasParaInsertar.length}`);
  }
}

main();
