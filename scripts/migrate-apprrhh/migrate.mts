// Migra a Supabase los datos reales que Karen siguió cargando en APPRRHH
// (Neon/Postgres) después del import inicial de Fase 2: marcaciones,
// ausencias/licencias, vacaciones, y las horas corregidas a mano.
//
// Uso:
//   DATABASE_URL="postgresql://..." npx tsx migrate.mts            (dry-run)
//   DATABASE_URL="postgresql://..." npx tsx migrate.mts --apply    (escribe)
import pg from "pg";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { recalcularSectorPeriodo } from "../../lib/rrhh/engine/recalcular.ts";

// Carga .env.local del proyecto (sin depender de dotenv) sin pisar env vars ya seteadas (ej. DATABASE_URL pasada por CLI).
for (const line of readFileSync(new URL("../../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const APPLY = process.argv.includes("--apply");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const neonUrl = process.env.DATABASE_URL;
if (!supabaseUrl || !serviceKey || !neonUrl) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / DATABASE_URL");
  process.exit(1);
}

const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const neon = new pg.Client({ connectionString: neonUrl, ssl: { rejectUnauthorized: false } });
await neon.connect();

function fechaStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log(`Modo: ${APPLY ? "APPLY (escribe en la base real)" : "DRY-RUN"}`);
  console.log("---------------------------------------------------------------");

  // ── 1. Mapas de referencia ──────────────────────────────────────────
  const { rows: neonEmpleados } = await neon.query('select id, legajo from "Employee"');
  const { data: sbEmpleados } = await sb.from("empleados").select("id, legajo");
  const legajoToSbId = new Map((sbEmpleados ?? []).map((e) => [e.legajo, e.id]));
  const neonIdToEmpleadoId = new Map<string, string>();
  const sinMatch: string[] = [];
  for (const e of neonEmpleados) {
    const sbId = legajoToSbId.get(e.legajo);
    if (sbId) neonIdToEmpleadoId.set(e.id, sbId);
    else sinMatch.push(e.legajo);
  }
  console.log(`Empleados: ${neonIdToEmpleadoId.size}/${neonEmpleados.length} matcheados por legajo`);
  if (sinMatch.length) console.log("  SIN MATCH:", sinMatch);

  const { rows: neonUsers } = await neon.query('select id, email from "User"');
  const { data: sbUsuarios } = await sb.from("usuarios").select("id, email, rol");
  const emailToSbUserId = new Map((sbUsuarios ?? []).map((u) => [u.email, u.id]));
  const adminSistemaId = (sbUsuarios ?? []).find((u) => u.rol === "admin_sistema")?.id;
  const neonIdToUserId = new Map<string, string>();
  for (const u of neonUsers) {
    neonIdToUserId.set(u.id, emailToSbUserId.get(u.email) ?? adminSistemaId ?? "");
  }

  // ── 2. Fichadas (TimeRecord → fichadas) ─────────────────────────────
  const { rows: timeRecords } = await neon.query(
    'select id, "employeeId", fecha, "horaEntrada", "horaSalida", origen, observaciones from "TimeRecord" order by fecha'
  );
  const { rows: fRango } = await neon.query('select min(fecha) as min, max(fecha) as max from "TimeRecord"');
  const fichadaDesde = fechaStr(fRango[0].min);
  const fichadaHasta = fechaStr(fRango[0].max);
  console.log(`\nFichadas en Neon: ${timeRecords.length} (${fichadaDesde} → ${fichadaHasta})`);

  const empleadosConFichadas = [...new Set(timeRecords.map((r) => neonIdToEmpleadoId.get(r.employeeId)).filter(Boolean))] as string[];
  const fichadaRows = timeRecords
    .filter((r) => neonIdToEmpleadoId.has(r.employeeId))
    .map((r) => ({
      empleado_id: neonIdToEmpleadoId.get(r.employeeId),
      fecha: fechaStr(r.fecha),
      hora_entrada: r.horaEntrada,
      hora_salida: r.horaSalida,
      origen: r.origen,
      observaciones: r.observaciones,
    }));

  if (APPLY) {
    const { error: eDel } = await sb.from("fichadas").delete().in("empleado_id", empleadosConFichadas).gte("fecha", fichadaDesde).lte("fecha", fichadaHasta);
    if (eDel) throw new Error("Borrando fichadas viejas: " + eDel.message);
    for (let i = 0; i < fichadaRows.length; i += 500) {
      const { error } = await sb.from("fichadas").insert(fichadaRows.slice(i, i + 500));
      if (error) throw new Error("Insertando fichadas: " + error.message);
    }
  }
  console.log(`  -> reemplazo completo de fichadas para ${empleadosConFichadas.length} empleados en ese rango (${fichadaRows.length} filas)`);

  // ── 3. Ausencias / Vacaciones (Absence → ausencias | vacaciones) ────
  const { rows: absences } = await neon.query(
    'select id, "employeeId", "fechaDesde", "fechaHasta", tipo, justificada, observaciones, "cargadoPorId" from "Absence" order by "fechaDesde"'
  );
  const { rows: aRango } = await neon.query('select min("fechaDesde") as min, max("fechaHasta") as max from "Absence"');
  const ausenciaDesde = fechaStr(aRango[0].min);
  const ausenciaHasta = fechaStr(aRango[0].max);
  console.log(`\nAusencias/Licencias en Neon: ${absences.length} (${ausenciaDesde} → ${ausenciaHasta})`);

  const empleadosConAusencias = [...new Set(absences.map((r) => neonIdToEmpleadoId.get(r.employeeId)).filter(Boolean))] as string[];
  const ausenciaRows = absences
    .filter((r) => r.tipo !== "VACACIONES" && neonIdToEmpleadoId.has(r.employeeId))
    .map((r) => ({
      empleado_id: neonIdToEmpleadoId.get(r.employeeId),
      fecha_desde: fechaStr(r.fechaDesde),
      fecha_hasta: fechaStr(r.fechaHasta),
      tipo: r.tipo,
      justificada: r.justificada,
      observaciones: r.observaciones,
      cargado_por_id: neonIdToUserId.get(r.cargadoPorId) || adminSistemaId,
    }));
  const vacacionRows = absences
    .filter((r) => r.tipo === "VACACIONES" && neonIdToEmpleadoId.has(r.employeeId))
    .map((r) => {
      const desde = new Date(r.fechaDesde);
      const hasta = new Date(r.fechaHasta);
      const dias = Math.round((hasta.getTime() - desde.getTime()) / 86400000) + 1;
      return {
        empleado_id: neonIdToEmpleadoId.get(r.employeeId),
        anio_correspondiente: desde.getUTCFullYear(),
        fecha_desde: fechaStr(desde),
        fecha_hasta: fechaStr(hasta),
        dias_tomados: dias,
        observaciones: r.observaciones,
      };
    });
  console.log(`  -> ${ausenciaRows.length} van a "ausencias", ${vacacionRows.length} van a "vacaciones" (tipo VACACIONES)`);

  if (APPLY) {
    const { error: eDelA } = await sb.from("ausencias").delete().in("empleado_id", empleadosConAusencias).gte("fecha_desde", ausenciaDesde).lte("fecha_hasta", ausenciaHasta);
    if (eDelA) throw new Error("Borrando ausencias viejas: " + eDelA.message);
    if (ausenciaRows.length) {
      const { error } = await sb.from("ausencias").insert(ausenciaRows);
      if (error) throw new Error("Insertando ausencias: " + error.message);
    }
    const { error: eDelV } = await sb.from("vacaciones").delete().in("empleado_id", empleadosConAusencias).gte("fecha_desde", ausenciaDesde).lte("fecha_hasta", ausenciaHasta);
    if (eDelV) throw new Error("Borrando vacaciones viejas: " + eDelV.message);
    if (vacacionRows.length) {
      const { error } = await sb.from("vacaciones").insert(vacacionRows);
      if (error) throw new Error("Insertando vacaciones: " + error.message);
    }
  }

  // ── 4. Correcciones manuales de Karen (DailyCalculation.horasManual) ─
  const { rows: manuales } = await neon.query(
    `select "employeeId", fecha, "tipoDia", "horasNormales", "horasExtra50", "horasExtra100", "francoGenerado",
            ausente, justificada, "tipoAusencia", observaciones, tarde, "retiroAnticipado",
            "extrasValidadas", "validadoPorId", "fechaValidacion"
     from "DailyCalculation" where "horasManual" = true`
  );
  console.log(`\nDías con horas corregidas a mano por Karen: ${manuales.length}`);
  const manualRows = manuales
    .filter((r) => neonIdToEmpleadoId.has(r.employeeId))
    .map((r) => ({
      empleado_id: neonIdToEmpleadoId.get(r.employeeId),
      fecha: fechaStr(r.fecha),
      tipo_dia: r.tipoDia,
      horas_normales: r.horasNormales,
      horas_extra_50: r.horasExtra50,
      horas_extra_100: r.horasExtra100,
      franco_generado: r.francoGenerado,
      ausente: r.ausente,
      justificada: r.justificada,
      tipo_ausencia: r.tipoAusencia,
      observaciones: r.observaciones,
      tarde: r.tarde,
      retiro_anticipado: r.retiroAnticipado,
      horas_manual: true,
      extras_validadas: r.extrasValidadas,
      validado_por_id: r.validadoPorId ? neonIdToUserId.get(r.validadoPorId) || null : null,
      fecha_validacion: r.fechaValidacion,
    }));
  if (APPLY && manualRows.length) {
    for (let i = 0; i < manualRows.length; i += 500) {
      const { error } = await sb.from("calculos_diarios").upsert(manualRows.slice(i, i + 500), { onConflict: "empleado_id,fecha" });
      if (error) throw new Error("Insertando overrides manuales: " + error.message);
    }
  }
  console.log(`  -> insertados como horas_manual=true (el motor de recálculo los va a saltear)`);

  // ── 5. Recalcular calculos_diarios + francos con los inputs frescos ─
  const desdeRecalculo = fichadaDesde < ausenciaDesde ? fichadaDesde : ausenciaDesde;
  const hastaRecalculo = fichadaHasta > ausenciaHasta ? fichadaHasta : ausenciaHasta;
  console.log(`\nRecálculo del período ${desdeRecalculo} → ${hastaRecalculo} para todos los empleados activos...`);
  if (APPLY) {
    const n = await recalcularSectorPeriodo(sb, null, new Date(desdeRecalculo), new Date(hastaRecalculo));
    console.log(`  -> ${n} empleados recalculados`);
  } else {
    console.log("  -> (se ejecutaría recalcularSectorPeriodo acá)");
  }

  console.log("\n---------------------------------------------------------------");
  console.log(APPLY ? "LISTO." : "Fin del dry-run. Corré con --apply para escribir de verdad.");
}

main()
  .catch((err) => {
    console.error("ERROR:", err.message || err);
    process.exitCode = 1;
  })
  .finally(() => neon.end());
