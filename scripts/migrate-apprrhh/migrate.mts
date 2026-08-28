// Migra a Supabase los datos reales que Karen siguió cargando en APPRRHH
// (Neon/Postgres) después del import inicial de Fase 2: modalidad de pago,
// marcaciones, ausencias/licencias, vacaciones, y las horas corregidas a mano.
//
// Se puede correr todas las veces que haga falta: cada paso REEMPLAZA el rango
// que trae (no acumula), así que volver a correrlo con datos nuevos en APPRRHH
// deja el SdG al día sin duplicar nada. Lo que se cargó a mano en el SdG dentro
// de ese rango se pierde: la base vieja es la fuente de verdad mientras las dos
// convivan.
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

/**
 * APPRRHH guarda los horarios en columnas `timestamp WITHOUT time zone`, y el
 * valor que hay ahí es UTC: la app de origen lo convierte a hora de Argentina
 * recién al mostrarlo (sus commits 171b94b / cd03d92 / b6497ba). node-pg, en
 * cambio, interpreta esas columnas en el huso del PROCESO, así que corriendo
 * el script desde Buenos Aires una marcación de las 11:03 se leía como 11:03
 * ART = 14:03 UTC y entraba al SdG tres horas adelantada.
 *
 * Por eso los timestamps se traen como texto y se interpretan explícitamente
 * como UTC: así el instante que se guarda en `timestamptz` es el real, y la
 * app lo muestra en hora argentina igual que APPRRHH.
 */
function instanteUtc(texto: string | null): Date | null {
  if (!texto) return null;
  return new Date(texto.trim().replace(" ", "T") + "Z");
}

/** El día calendario de una columna de fecha, tal cual, sin pasar por Date. */
function soloFecha(texto: string): string {
  return texto.slice(0, 10);
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

  // ── 1.5 Modalidad de pago (Employee.modalidadPago → empleados) ──────
  // La columna existe en APPRRHH desde su migración 20260731_add_modalidad_pago.
  // Si la base vieja es anterior, no está y se saltea el paso.
  const { rows: tieneModalidad } = await neon.query(
    `select 1 from information_schema.columns where table_name = 'Employee' and column_name = 'modalidadPago'`
  );
  if (tieneModalidad.length === 0) {
    console.log("\nModalidad de pago: la base vieja no tiene la columna, se saltea (todos quedan JORNAL)");
  } else {
    const { rows: modalidades } = await neon.query('select legajo, "modalidadPago" from "Employee"');
    const porModalidad = { JORNAL: [] as string[], MENSUAL: [] as string[] };
    for (const m of modalidades) {
      if (!legajoToSbId.has(m.legajo)) continue;
      (m.modalidadPago === "MENSUAL" ? porModalidad.MENSUAL : porModalidad.JORNAL).push(m.legajo);
    }
    console.log(
      `\nModalidad de pago en Neon: ${porModalidad.MENSUAL.length} MENSUAL, ${porModalidad.JORNAL.length} JORNAL`
    );
    if (porModalidad.MENSUAL.length) console.log("  mensuales:", porModalidad.MENSUAL.join(", "));
    if (APPLY) {
      for (const [modalidad, legajos] of Object.entries(porModalidad)) {
        if (!legajos.length) continue;
        const { error } = await sb.from("empleados").update({ modalidad_pago: modalidad }).in("legajo", legajos);
        if (error) throw new Error(`Actualizando modalidad ${modalidad}: ` + error.message);
      }
    }
  }

  // ── 2. Fichadas (TimeRecord → fichadas) ─────────────────────────────
  const { rows: timeRecords } = await neon.query(
    'select id, "employeeId", fecha::text fecha, "horaEntrada"::text "horaEntrada", "horaSalida"::text "horaSalida", origen, observaciones from "TimeRecord" order by fecha'
  );
  const { rows: fRango } = await neon.query('select min(fecha)::text as min, max(fecha)::text as max from "TimeRecord"');
  const fichadaDesde = soloFecha(fRango[0].min);
  const fichadaHasta = soloFecha(fRango[0].max);
  console.log(`\nFichadas en Neon: ${timeRecords.length} (${fichadaDesde} → ${fichadaHasta})`);

  const empleadosConFichadas = [...new Set(timeRecords.map((r) => neonIdToEmpleadoId.get(r.employeeId)).filter(Boolean))] as string[];
  const fichadaRows = timeRecords
    .filter((r) => neonIdToEmpleadoId.has(r.employeeId))
    .map((r) => ({
      empleado_id: neonIdToEmpleadoId.get(r.employeeId),
      fecha: soloFecha(r.fecha),
      hora_entrada: instanteUtc(r.horaEntrada),
      hora_salida: instanteUtc(r.horaSalida),
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
    'select id, "employeeId", "fechaDesde"::text "fechaDesde", "fechaHasta"::text "fechaHasta", tipo, justificada, observaciones, "cargadoPorId" from "Absence" order by "fechaDesde"'
  );
  const { rows: aRango } = await neon.query('select min("fechaDesde")::text as min, max("fechaHasta")::text as max from "Absence"');
  const ausenciaDesde = soloFecha(aRango[0].min);
  const ausenciaHasta = soloFecha(aRango[0].max);
  console.log(`\nAusencias/Licencias en Neon: ${absences.length} (${ausenciaDesde} → ${ausenciaHasta})`);

  const empleadosConAusencias = [...new Set(absences.map((r) => neonIdToEmpleadoId.get(r.employeeId)).filter(Boolean))] as string[];

  // TODAS las ausencias van a "ausencias", incluidas las de tipo VACACIONES.
  // En el modelo nuevo conviven con su período de vacaciones: el recálculo le da
  // prioridad a la vacación, así que el día no queda marcado como falta.
  const absencesMatcheadas = absences.filter((r) => neonIdToEmpleadoId.has(r.employeeId));
  const ausenciaRows = absencesMatcheadas.map((r) => ({
    empleado_id: neonIdToEmpleadoId.get(r.employeeId),
    fecha_desde: soloFecha(r.fechaDesde),
    fecha_hasta: soloFecha(r.fechaHasta),
    tipo: r.tipo,
    justificada: r.justificada,
    observaciones: r.observaciones,
    cargado_por_id: neonIdToUserId.get(r.cargadoPorId) || adminSistemaId,
  }));

  // Los períodos de vacaciones salen de la tabla VacationPeriod, que es la que
  // tiene el AÑO CORRESPONDIENTE explícito. Derivarlo de la fecha de inicio
  // (como se hacía antes) manda mal las vacaciones adeudadas de años
  // anteriores, que es justo el caso que la app de origen arregló.
  //
  // `absenceId` lo agregó su migración 20260730_link_vacation_period_to_absence,
  // distinta de la de modalidad de pago: se chequea por separado.
  const { rows: tieneAbsenceId } = await neon.query(
    `select 1 from information_schema.columns where table_name = 'VacationPeriod' and column_name = 'absenceId'`
  );
  if (tieneAbsenceId.length === 0) {
    console.log('  (la base vieja no vincula períodos con ausencias: se derivan todos)');
  }
  const { rows: periodos } = await neon.query(
    `select id, "employeeId", "anioCorrespondiente", "fechaDesde"::text "fechaDesde", "fechaHasta"::text "fechaHasta", "diasTomados", observaciones,
            ${tieneAbsenceId.length ? '"absenceId"' : 'null as "absenceId"'}
     from "VacationPeriod" order by "fechaDesde"`
  );
  const periodosMatcheados = periodos.filter((p) => neonIdToEmpleadoId.has(p.employeeId));

  // Una ausencia de VACACIONES sin período que la apunte es de antes de que la
  // app de origen los vinculara: se le deriva uno, para no perder el descuento
  // del balance. El año sale de la fecha de inicio, que es lo mejor que hay.
  const absencesConPeriodo = new Set(periodosMatcheados.map((p) => p.absenceId).filter(Boolean));
  const vacacionesHuerfanas = absencesMatcheadas.filter(
    (r) => r.tipo === "VACACIONES" && !absencesConPeriodo.has(r.id)
  );

  console.log(`  -> ${ausenciaRows.length} van a "ausencias" (todas, incluidas las de VACACIONES)`);
  console.log(`  -> ${periodosMatcheados.length} períodos desde "VacationPeriod" (${absencesConPeriodo.size} vinculados a una ausencia)`);
  console.log(`  -> ${vacacionesHuerfanas.length} ausencias de VACACIONES sin período: se les deriva uno`);

  // El borrado de vacaciones NO puede ir acotado a los empleados con ausencias:
  // un empleado puede tener período de vacaciones y ninguna ausencia (las
  // vacaciones cargadas a mano allá), y entonces su fila vieja del SdG sobrevive
  // y el import le agrega una segunda copia, duplicándole el balance. Pasó con
  // PC_125 y PS_021 en la corrida del 27/08/2026.
  const empleadosConVacaciones = [...new Set(periodosMatcheados.map((p) => neonIdToEmpleadoId.get(p.employeeId)).filter(Boolean))] as string[];
  const empleadosAfectados = [...new Set([...empleadosConAusencias, ...empleadosConVacaciones])];

  if (APPLY) {
    // Borrar ausencias primero: el on delete cascade se lleva los períodos
    // vinculados. Después se limpian los períodos sueltos que queden en rango.
    const { error: eDelA } = await sb.from("ausencias").delete().in("empleado_id", empleadosConAusencias).gte("fecha_desde", ausenciaDesde).lte("fecha_hasta", ausenciaHasta);
    if (eDelA) throw new Error("Borrando ausencias viejas: " + eDelA.message);
    const { error: eDelV } = await sb.from("vacaciones").delete().in("empleado_id", empleadosAfectados).gte("fecha_desde", ausenciaDesde).lte("fecha_hasta", ausenciaHasta);
    if (eDelV) throw new Error("Borrando vacaciones viejas: " + eDelV.message);

    // Se insertan pidiendo el id de vuelta para poder rearmar el vínculo. El
    // orden de las filas devueltas es el de las enviadas.
    const neonAbsenceIds: string[] = absencesMatcheadas.map((r) => r.id);
    const ausenciaIdPorNeonId = new Map<string, string>();
    if (ausenciaRows.length) {
      const { data: insertadas, error } = await sb.from("ausencias").insert(ausenciaRows).select("id");
      if (error) throw new Error("Insertando ausencias: " + error.message);
      if ((insertadas ?? []).length !== neonAbsenceIds.length) {
        throw new Error(`Se insertaron ${insertadas?.length} ausencias de ${neonAbsenceIds.length}: no se puede rearmar el vínculo con vacaciones`);
      }
      (insertadas ?? []).forEach((fila, i) => ausenciaIdPorNeonId.set(neonAbsenceIds[i], fila.id));
    }

    const vacacionRows = [
      ...periodosMatcheados.map((p) => ({
        empleado_id: neonIdToEmpleadoId.get(p.employeeId),
        anio_correspondiente: p.anioCorrespondiente,
        fecha_desde: soloFecha(p.fechaDesde),
        fecha_hasta: soloFecha(p.fechaHasta),
        dias_tomados: p.diasTomados,
        observaciones: p.observaciones,
        ausencia_id: p.absenceId ? ausenciaIdPorNeonId.get(p.absenceId) ?? null : null,
      })),
      ...vacacionesHuerfanas.map((r) => {
        const desde = new Date(`${soloFecha(r.fechaDesde)}T00:00:00Z`);
        const hasta = new Date(`${soloFecha(r.fechaHasta)}T00:00:00Z`);
        return {
          empleado_id: neonIdToEmpleadoId.get(r.employeeId),
          anio_correspondiente: desde.getUTCFullYear(),
          fecha_desde: soloFecha(r.fechaDesde),
          fecha_hasta: soloFecha(r.fechaHasta),
          dias_tomados: Math.round((hasta.getTime() - desde.getTime()) / 86400000) + 1,
          observaciones: r.observaciones,
          ausencia_id: ausenciaIdPorNeonId.get(r.id) ?? null,
        };
      }),
    ];
    if (vacacionRows.length) {
      const { error } = await sb.from("vacaciones").insert(vacacionRows);
      if (error) throw new Error("Insertando vacaciones: " + error.message);
    }
    console.log(`  -> ${vacacionRows.length} períodos de vacaciones insertados`);
  }

  // ── 4. Correcciones manuales de Karen (DailyCalculation.horasManual) ─
  const { rows: manuales } = await neon.query(
    `select "employeeId", fecha::text fecha, "tipoDia", "horasNormales", "horasExtra50", "horasExtra100", "francoGenerado",
            ausente, justificada, "tipoAusencia", observaciones, tarde, "retiroAnticipado",
            "extrasValidadas", "validadoPorId", "fechaValidacion"::text "fechaValidacion"
     from "DailyCalculation" where "horasManual" = true`
  );
  console.log(`\nDías con horas corregidas a mano por Karen: ${manuales.length}`);
  const manualRows = manuales
    .filter((r) => neonIdToEmpleadoId.has(r.employeeId))
    .map((r) => ({
      empleado_id: neonIdToEmpleadoId.get(r.employeeId),
      fecha: soloFecha(r.fecha),
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
      fecha_validacion: instanteUtc(r.fechaValidacion),
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
  const finDatos = fichadaHasta > ausenciaHasta ? fichadaHasta : ausenciaHasta;
  // El recálculo NO puede pasar de hoy. El rango sale de los datos, y las
  // ausencias suelen estar cargadas hacia adelante (una licencia que termina la
  // semana que viene), así que el fin de los datos cae en el futuro. Para un día
  // que todavía no pasó no hay fichadas, y el motor lo marca como falta sin
  // clasificar: en la corrida del 27/08/2026 eso generó 460 faltas fantasma
  // entre el 28/08 y el 04/09 que hubo que borrar a mano.
  const hoyStr = fechaStr(new Date());
  const hastaRecalculo = finDatos > hoyStr ? hoyStr : finDatos;
  console.log(`\nRecálculo del período ${desdeRecalculo} → ${hastaRecalculo} para todos los empleados activos...`);
  if (finDatos > hoyStr) console.log(`  (los datos llegan hasta ${finDatos}, pero no se recalcula más allá de hoy)`);
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
