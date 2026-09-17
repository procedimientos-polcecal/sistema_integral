/**
 * Backfill único de "HISTORIAL REPARACIONES" (50 filas de datos) de la planilla real
 * de Taller Vial. A diferencia de las cargas de combustible y los estados
 * diarios, esto NO deja un sync corriendo: de acá en más se carga desde el
 * SdG (`/taller-vial/reparaciones` y `/taller-vial/services`).
 *
 * La columna "TIPO" mezcla dos cosas que en el SdG son tablas separadas:
 * "Service 250h"/"Service 500h"/"Service 1000h"/"Service 2000h" son un
 * service por horómetro (→ taller_vial_services); todo lo demás
 * (" Reparación", "Revisión", vacío) es una intervención común
 * (→ taller_vial_reparaciones).
 *
 *   npx tsx --env-file=.env.local scripts/importar-taller-vial-reparaciones-historico.mts
 */
import { createClient } from "@supabase/supabase-js";
import { leerValores } from "../lib/core/sheets";
import { fechaDeSheets } from "../lib/core/fechaDeSheets";
import { codigoDesdeTextoLibre } from "../lib/tallerVial/equipos";
import { tierDesdeTipoSheet } from "../lib/tallerVial/service";

const PLANILLA_ID = "1P1bZb3CxDgR_EulR8-lXUJTNsIZLu5rMVLh-VIY6N4g";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function numeroDeCelda(v: string | undefined): number | null {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return isFinite(n) ? n : null;
}

async function main() {
  const { data: equipos, error } = await supabase.from("equipos").select("id, code").ilike("code", "EM%");
  if (error) throw new Error(error.message);
  const idPorCodigo = new Map((equipos ?? []).map((e) => [e.code, e.id]));

  const valores = await leerValores(PLANILLA_ID, "HISTORIAL REPARACIONES");
  const filas = valores.slice(1);

  const services: { equipo_id: string; tier: number; fecha: string; horometro: number }[] = [];
  const reparaciones: {
    equipo_id: string; tipo: string; fecha: string; descripcion: string; horas: number | null; horometro: number | null;
  }[] = [];
  let sinEquipo = 0;
  let sinFecha = 0;
  let serviceSinHorometro = 0;

  for (const fila of filas) {
    const [equipoRaw, tipoRaw, fechaRaw, descripcion, horasRaw, horometroRaw] = fila;
    const codigo = codigoDesdeTextoLibre(String(equipoRaw ?? ""));
    const equipoId = codigo ? idPorCodigo.get(codigo) : undefined;
    if (!equipoId) { sinEquipo++; continue; }

    const fecha = fechaDeSheets(fechaRaw);
    if (!fecha) { sinFecha++; continue; }

    const tipo = String(tipoRaw ?? "").trim();
    const tier = tierDesdeTipoSheet(tipo);
    const horometro = numeroDeCelda(horometroRaw);

    if (tier !== null) {
      if (horometro === null) { serviceSinHorometro++; continue; } // un service sin horómetro no sirve para la cascada
      services.push({ equipo_id: equipoId, tier, fecha, horometro });
    } else {
      reparaciones.push({
        equipo_id: equipoId,
        tipo: tipo || "Reparación",
        fecha,
        descripcion: String(descripcion ?? "").trim() || "(sin descripción)",
        horas: numeroDeCelda(horasRaw),
        horometro,
      });
    }
  }

  console.log(`${filas.length} filas leídas: ${services.length} services, ${reparaciones.length} reparaciones/revisiones.`);
  console.log(`Descartadas: ${sinEquipo} sin equipo, ${sinFecha} sin fecha, ${serviceSinHorometro} services sin horómetro.`);

  if (services.length > 0) {
    const { error: errServices } = await supabase.from("taller_vial_services").insert(services);
    if (errServices) throw new Error(`services: ${errServices.message}`);
  }
  if (reparaciones.length > 0) {
    const { error: errReparaciones } = await supabase.from("taller_vial_reparaciones").insert(reparaciones);
    if (errReparaciones) throw new Error(`reparaciones: ${errReparaciones.message}`);
  }
  console.log("Listo.");
}

main();
