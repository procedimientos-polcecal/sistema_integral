import { createAdminClient } from "@/lib/supabase/admin";
import { leerValores } from "@/lib/core/sheets";
import { partesDeFilaCruda, type ParteParaInsertar } from "./partes";

/**
 * Trae del Google Form "PARTE DIARIO EQUIPOS MÓVILES" (planilla de
 * respuestas `GOOGLE_SHEETS_TALLER_VIAL_PARTES_ID`) los partes diarios que
 * todavía no están en `taller_vial_partes`, y por cada uno cuyo sector sea
 * "Destape <yacimiento>" y tenga equipo y operario resueltos, crea la fila
 * correspondiente en `cantera_destape` — ver la migración
 * `20260922113621_...sql` para el porqué del diseño.
 *
 * `escribir: false` sólo lee y cuenta —para ensayar—; `true` además
 * escribe. Mismo patrón que `sincronizarCargasDesdeSheets`
 * (`lib/tallerVial/importar.ts`).
 */

const LIBRO = () => process.env.GOOGLE_SHEETS_TALLER_VIAL_PARTES_ID;

export interface ResultadoSincronizacionPartes {
  filasLeidas: number;
  partesLeidos: number;
  partesNuevos: number;
  destapesCreados: number;
  sinOperarioResuelto: number;
  sinEquipoResuelto: number;
}

export async function sincronizarPartesDesdeSheets(escribir: boolean): Promise<ResultadoSincronizacionPartes> {
  const libro = LIBRO();
  if (!libro) throw new Error("Falta GOOGLE_SHEETS_TALLER_VIAL_PARTES_ID");
  const sb = createAdminClient();

  const [{ data: equiposDB, error: errEquipos }, { data: empleadosDB, error: errEmpleados }] = await Promise.all([
    sb.from("equipos").select("id, code").ilike("code", "EM%"),
    sb.from("empleados").select("id, nombre, apellido").eq("activo", true),
  ]);
  if (errEquipos) throw new Error(`equipos: ${errEquipos.message}`);
  if (errEmpleados) throw new Error(`empleados: ${errEmpleados.message}`);

  // `sinFormato: true`: la fecha y las horas viajan como serial de Sheets,
  // no como texto dependiente del locale — `fechaDeSheets`/`horaDeCelda`
  // (via partesDeFilaCruda) ya saben leer esa forma. Mismo criterio que
  // documenta `lib/core/sheets.ts`.
  const valores = await leerValores(libro, "'Respuestas de formulario 1'", { sinFormato: true });
  const filas = valores.slice(1); // sin encabezado

  const catalogos = { equipos: equiposDB ?? [], empleados: empleadosDB ?? [] };
  const todosLosPartes = filas.flatMap((fila) => partesDeFilaCruda(fila, catalogos));

  // Qué (marca_temporal, bloque) ya están en la base, para no reprocesar —
  // el form no permite editar una respuesta ya enviada, así que un parte ya
  // guardado no cambia nunca.
  const { data: yaGuardados, error: errYaGuardados } = await sb
    .from("taller_vial_partes")
    .select("marca_temporal, bloque");
  if (errYaGuardados) throw new Error(`taller_vial_partes (leyendo lo ya sincronizado): ${errYaGuardados.message}`);
  const clavesGuardadas = new Set((yaGuardados ?? []).map((p) => `${p.marca_temporal}|${p.bloque}`));

  const partesNuevos = todosLosPartes.filter((p) => !clavesGuardadas.has(`${p.marcaTemporal}|${p.bloque}`));
  const sinOperarioResuelto = partesNuevos.filter((p) => p.operarioId === null).length;
  const sinEquipoResuelto = partesNuevos.filter((p) => p.equipoId === null).length;

  let destapesCreados = 0;
  if (escribir) {
    for (const parte of partesNuevos) {
      const destapeId = await crearDestapeSiCorresponde(sb, parte);
      if (destapeId) destapesCreados++;

      const { error } = await sb.from("taller_vial_partes").insert({
        marca_temporal: parte.marcaTemporal,
        bloque: parte.bloque,
        fecha: parte.fecha,
        operario_raw: parte.operarioRaw,
        operario_id: parte.operarioId,
        equipo_raw: parte.equipoRaw,
        equipo_id: parte.equipoId,
        sector_raw: parte.sectorRaw,
        yacimiento_destape_codigo: parte.yacimientoDestapeCodigo,
        hora_inicio: parte.horaInicio,
        hora_fin: parte.horaFin,
        horas: parte.horas,
        cargaste_todo: parte.cargasteTodo,
        observaciones: parte.observaciones,
        destape_id: destapeId,
      });
      if (error) throw new Error(`taller_vial_partes (marca_temporal ${parte.marcaTemporal}, bloque ${parte.bloque}): ${error.message}`);
    }
  }

  return {
    filasLeidas: filas.length,
    partesLeidos: todosLosPartes.length,
    partesNuevos: partesNuevos.length,
    destapesCreados,
    sinOperarioResuelto,
    sinEquipoResuelto,
  };
}

/**
 * Si el parte es de destape y tiene equipo, operario y horas resueltos,
 * crea la fila en `cantera_destape` (misma forma que arma `POST
 * /api/cantera/destape`) y devuelve su id. Si falta cualquiera de los
 * cuatro, no crea nada y devuelve `null` — no se inventa a quién o con qué
 * máquina fue.
 */
async function crearDestapeSiCorresponde(
  sb: ReturnType<typeof createAdminClient>,
  parte: ParteParaInsertar
): Promise<string | null> {
  if (!parte.yacimientoDestapeCodigo || !parte.equipoId || !parte.operarioId || parte.horas === null || parte.horas <= 0) {
    return null;
  }

  const { data, error } = await sb
    .from("cantera_destape")
    .insert({
      fecha: parte.fecha,
      yacimiento_codigo: parte.yacimientoDestapeCodigo,
      tipo_recurso: "operario_propio",
      operario_id: parte.operarioId,
      recurso_raw: parte.operarioRaw,
      equipo_id: parte.equipoId,
      equipo_o_vehiculo_raw: parte.equipoRaw,
      horas: parte.horas,
      origen: "taller_vial_form",
    })
    .select("id")
    .single();

  if (error) throw new Error(`cantera_destape (desde parte de ${parte.marcaTemporal}): ${error.message}`);
  return (data as { id: string }).id;
}
