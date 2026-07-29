// Migra el documento orgs/{uid} de Firestore (ya exportado y limpiado a JSON)
// hacia el esquema de Supabase de Fase 3 (Remises).
//
// Uso:
//   node --env-file=../../.env.local migrate.mjs           (dry-run: solo reporta)
//   node --env-file=../../.env.local migrate.mjs --apply   (escribe de verdad)

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');

const ORG_JSON_PATH = join(
  __dirname,
  '..',
  'export-firestore-org',
  'orgs_9VDBBTgYkXZeUL5aEUNaFQaqJIk2.json'
);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  console.error('Corré con: node --env-file=../../.env.local migrate.mjs');
  process.exit(1);
}

const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

function normalizeName(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function wordsOf(s) {
  return new Set(normalizeName(s).split(' ').filter(Boolean));
}

function sameWords(a, b) {
  if (a.size !== b.size) return false;
  for (const w of a) if (!b.has(w)) return false;
  return true;
}

// Alias manuales para casos que ni el subset-match resuelve (typos en la
// base del núcleo, apodos). Clave: nombre tal cual aparece en Firestore.
const NAME_ALIASES = {
  'MARCELO DANIEL MENGUILLO': 'MENGUILLO, MARCEL DANIE',
  'KAREN SHTECFEC': 'SHTEFEC KUSZMIRUK, KAREN JEANNETT',
};

function isSubset(small, big) {
  for (const w of small) if (!big.has(w)) return false;
  return true;
}

async function chunkedInsert(table, rows, { select } = {}) {
  const out = [];
  const size = 500;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    if (!APPLY) continue;
    let q = sb.from(table).insert(chunk);
    if (select) q = q.select(select);
    const { data, error } = await q;
    if (error) throw new Error(`Insert en ${table} falló: ${error.message}`);
    if (data) out.push(...data);
  }
  return out;
}

async function main() {
  const org = JSON.parse(readFileSync(ORG_JSON_PATH, 'utf-8'));
  console.log(`Modo: ${APPLY ? 'APPLY (escribe en la base real)' : 'DRY-RUN (solo reporte, no escribe nada)'}`);
  console.log('---------------------------------------------------------------');

  // ── 1. empleados existentes (para matchear por nombre) ─────────────────
  const { data: empleadosDb, error: empErr } = await sb.from('empleados').select('id, nombre, apellido');
  if (empErr) throw new Error('No pude leer empleados: ' + empErr.message);

  const empleadosByWords = empleadosDb.map((e) => ({
    id: e.id,
    words: wordsOf(`${e.apellido} ${e.nombre}`),
    label: `${e.apellido}, ${e.nombre}`,
  }));
  const byLabel = new Map(empleadosByWords.map((e) => [e.label, e]));

  const empMap = new Map(); // firestoreEmpId -> supabase empleado uuid
  const unmatched = [];
  const ambiguous = [];
  for (const fsEmp of org.employees) {
    const alias = NAME_ALIASES[normalizeName(fsEmp.name)] || NAME_ALIASES[fsEmp.name];
    if (alias && byLabel.has(alias)) {
      empMap.set(fsEmp.id, byLabel.get(alias).id);
      continue;
    }
    const fsWords = wordsOf(fsEmp.name);
    const exact = empleadosByWords.filter((e) => sameWords(e.words, fsWords));
    const candidates = exact.length ? exact : empleadosByWords.filter((e) => isSubset(fsWords, e.words));
    if (candidates.length === 1) empMap.set(fsEmp.id, candidates[0].id);
    else if (candidates.length > 1) ambiguous.push({ name: fsEmp.name, candidates: candidates.map((c) => c.label) });
    else unmatched.push(fsEmp.name);
  }

  console.log(`Empleados en Firestore: ${org.employees.length}`);
  console.log(`Matcheados contra empleados (núcleo): ${empMap.size}`);
  if (ambiguous.length) {
    console.log(`AMBIGUOS (${ambiguous.length}) — más de un candidato posible:`);
    ambiguous.forEach((a) => console.log(`  - ${a.name} -> ${a.candidates.join(' | ')}`));
  }
  if (unmatched.length) {
    console.log(`SIN MATCH (${unmatched.length}) — no se les cargará dato de Remises:`);
    unmatched.forEach((n) => console.log('  - ' + n));
  }
  console.log('---------------------------------------------------------------');

  // ── 2. remises_turnos: reemplazar los 3 seed genéricos por los 5 reales ─
  const { data: turnosSeed, error: turnosErr } = await sb.from('remises_turnos').select('id, nombre');
  if (turnosErr) throw new Error('No pude leer remises_turnos: ' + turnosErr.message);
  console.log(`Turnos seed actuales en Supabase: ${turnosSeed.map((t) => t.nombre).join(', ') || '(ninguno)'}`);
  console.log(`Turnos reales en Firestore: ${org.shifts.map((s) => `${s.name} (${s.start}-${s.end})`).join(', ')}`);

  const turnoMap = new Map(); // firestoreShiftId -> supabase turno uuid

  if (APPLY) {
    if (turnosSeed.length) {
      const { error } = await sb.from('remises_turnos').delete().in('id', turnosSeed.map((t) => t.id));
      if (error) throw new Error('No pude borrar turnos seed: ' + error.message);
    }
    const rows = org.shifts.map((s) => ({
      nombre: s.name,
      hora_inicio: s.start,
      hora_fin: s.end,
      color: s.color,
      activo: true,
    }));
    const { data, error } = await sb.from('remises_turnos').insert(rows).select('id, nombre');
    if (error) throw new Error('No pude insertar turnos reales: ' + error.message);
    org.shifts.forEach((s, i) => turnoMap.set(s.id, data[i].id));
  } else {
    org.shifts.forEach((s) => turnoMap.set(s.id, `<uuid-nuevo-turno:${s.name}>`));
  }
  console.log('---------------------------------------------------------------');

  // ── 3. vehiculos ─────────────────────────────────────────────────────
  const vehiculoMap = new Map(); // firestoreVehicleId -> supabase vehiculo uuid
  console.log(`Vehículos en Firestore: ${org.vehicles.length}`);
  if (APPLY) {
    const rows = org.vehicles.map((v) => ({ nombre: v.name, capacidad: v.capacity || 8, activo: true }));
    const { data, error } = await sb.from('vehiculos').insert(rows).select('id');
    if (error) throw new Error('No pude insertar vehiculos: ' + error.message);
    org.vehicles.forEach((v, i) => vehiculoMap.set(v.id, data[i].id));
  } else {
    org.vehicles.forEach((v) => vehiculoMap.set(v.id, `<uuid-nuevo-vehiculo:${v.name}>`));
  }
  console.log('---------------------------------------------------------------');

  // ── 4. remises_empleados_datos ───────────────────────────────────────
  const empDatosRows = [];
  for (const fsEmp of org.employees) {
    const empleadoId = empMap.get(fsEmp.id);
    if (!empleadoId) continue;
    empDatosRows.push({
      empleado_id: empleadoId,
      direccion: fsEmp.address || null,
      lat: fsEmp.lat ?? null,
      lng: fsEmp.lng ?? null,
      turno_default_id: turnoMap.get(fsEmp.defaultShiftId) || null,
    });
  }
  console.log(`remises_empleados_datos a insertar: ${empDatosRows.length}`);
  if (APPLY && empDatosRows.length) {
    const { error } = await sb.from('remises_empleados_datos').insert(empDatosRows);
    if (error) throw new Error('No pude insertar remises_empleados_datos: ' + error.message);
  }

  // ── 5. remises_asistencia ────────────────────────────────────────────
  const asistenciaRows = [];
  let asistenciaSkipped = 0;
  for (const [key, empIds] of Object.entries(org.attendance || {})) {
    const idx = key.indexOf('__');
    const fecha = key.slice(0, idx);
    const turnoFsId = key.slice(idx + 2);
    const turnoId = turnoMap.get(turnoFsId);
    if (!turnoId) continue;
    for (const fsEmpId of empIds) {
      const empleadoId = empMap.get(fsEmpId);
      if (!empleadoId) {
        asistenciaSkipped++;
        continue;
      }
      asistenciaRows.push({ empleado_id: empleadoId, fecha, turno_id: turnoId });
    }
  }
  console.log(`remises_asistencia a insertar: ${asistenciaRows.length} (omitidas por empleado sin match: ${asistenciaSkipped})`);
  if (APPLY && asistenciaRows.length) {
    const { error } = await sb.from('remises_asistencia').upsert(asistenciaRows, {
      onConflict: 'empleado_id,fecha,turno_id',
      ignoreDuplicates: true,
    });
    if (error) throw new Error('No pude insertar remises_asistencia: ' + error.message);
  }

  // ── 6. remises_plan_semana ───────────────────────────────────────────
  const planRows = [];
  let planSkipped = 0;
  for (const [key, val] of Object.entries(org.weekPlan || {})) {
    const idx = key.indexOf('__');
    const fecha = key.slice(0, idx);
    const turnoFsId = key.slice(idx + 2);
    const turnoId = turnoMap.get(turnoFsId);
    if (!turnoId) continue;
    for (const [tipoKey, tipo] of [['morning', 'ida'], ['evening', 'vuelta']]) {
      for (const fsEmpId of val[tipoKey] || []) {
        const empleadoId = empMap.get(fsEmpId);
        if (!empleadoId) {
          planSkipped++;
          continue;
        }
        planRows.push({ empleado_id: empleadoId, fecha, turno_id: turnoId, tipo });
      }
    }
  }
  console.log(`remises_plan_semana a insertar: ${planRows.length} (omitidas: ${planSkipped})`);
  if (APPLY && planRows.length) {
    const { error } = await sb.from('remises_plan_semana').upsert(planRows, {
      onConflict: 'empleado_id,fecha,turno_id,tipo',
      ignoreDuplicates: true,
    });
    if (error) throw new Error('No pude insertar remises_plan_semana: ' + error.message);
  }

  // ── 7. hojas_ruta + asientos (de routes{} y history[], dedupe) ───────
  // Clave de dedupe: fecha|turnoFsId|tipoLiteral|vehicleFsId — se prioriza
  // "routes" (tiene km/min/geometry) sobre "history" (más pobre).
  const hojaEntries = new Map();

  for (const [key, byTipo] of Object.entries(org.routes || {})) {
    const idx = key.indexOf('__');
    const fecha = key.slice(0, idx);
    const turnoFsId = key.slice(idx + 2);
    for (const [tipoKey, tipo] of [['morning', 'ida'], ['evening', 'vuelta']]) {
      for (const entry of byTipo[tipoKey] || []) {
        const vehicleFsId = entry.vehicle?.id;
        if (!vehicleFsId) continue;
        const dedupeKey = `${fecha}|${turnoFsId}|${tipo}|${vehicleFsId}`;
        hojaEntries.set(dedupeKey, {
          fecha,
          turnoFsId,
          tipo,
          vehicleFsId,
          km: entry.km != null ? parseFloat(entry.km) : null,
          minutos: entry.min ?? null,
          geometria: entry.geometry ?? null,
          empIds: (entry.stops || []).filter((s) => !s.isFactory).map((s) => s.id),
        });
      }
    }
  }

  for (const hist of org.history || []) {
    const fecha = hist.date;
    const turnoFsId = hist.shiftId;
    const tipo = hist.type === 'evening' ? 'vuelta' : 'ida';
    for (const group of hist.groups || []) {
      const vehicleFsId = group.vehicleId;
      if (!vehicleFsId) continue;
      const dedupeKey = `${fecha}|${turnoFsId}|${tipo}|${vehicleFsId}`;
      if (hojaEntries.has(dedupeKey)) continue; // ya vino de routes{}, más completo
      hojaEntries.set(dedupeKey, {
        fecha,
        turnoFsId,
        tipo,
        vehicleFsId,
        km: null,
        minutos: null,
        geometria: null,
        empIds: group.empIds || [],
      });
    }
  }

  const hojaList = [...hojaEntries.values()].filter(
    (h) => turnoMap.has(h.turnoFsId) && vehiculoMap.has(h.vehicleFsId)
  );
  const hojaSkippedNoRef = hojaEntries.size - hojaList.length;
  console.log(`hojas_ruta a insertar: ${hojaList.length} (de routes+history, dedupe aplicado; omitidas por turno/vehículo sin match: ${hojaSkippedNoRef})`);

  let asientosTotal = 0;
  let asientosSkipped = 0;
  if (APPLY && hojaList.length) {
    const size = 500;
    for (let i = 0; i < hojaList.length; i += size) {
      const chunk = hojaList.slice(i, i + size);
      const rows = chunk.map((h) => ({
        fecha: h.fecha,
        turno_id: turnoMap.get(h.turnoFsId),
        tipo: h.tipo,
        vehiculo_id: vehiculoMap.get(h.vehicleFsId),
        km: h.km,
        minutos: h.minutos,
        geometria: h.geometria,
      }));
      const { data, error } = await sb.from('hojas_ruta').insert(rows).select('id');
      if (error) throw new Error('No pude insertar hojas_ruta: ' + error.message);

      const asientoRows = [];
      chunk.forEach((h, j) => {
        const hojaRutaId = data[j].id;
        h.empIds.forEach((fsEmpId, orden) => {
          const empleadoId = empMap.get(fsEmpId);
          if (!empleadoId) {
            asientosSkipped++;
            return;
          }
          asientoRows.push({ hoja_ruta_id: hojaRutaId, empleado_id: empleadoId, orden });
        });
      });
      if (asientoRows.length) {
        const { error: e2 } = await sb.from('asientos').upsert(asientoRows, {
          onConflict: 'hoja_ruta_id,empleado_id',
          ignoreDuplicates: true,
        });
        if (e2) throw new Error('No pude insertar asientos: ' + e2.message);
        asientosTotal += asientoRows.length;
      }
    }
  } else {
    hojaList.forEach((h) => {
      asientosTotal += h.empIds.filter((id) => empMap.has(id)).length;
      asientosSkipped += h.empIds.filter((id) => !empMap.has(id)).length;
    });
  }
  console.log(`asientos a insertar: ${asientosTotal} (omitidos por empleado sin match: ${asientosSkipped})`);
  console.log('---------------------------------------------------------------');

  // ── 8. remises_plantillas + remises_plantillas_grupos ────────────────
  let plantillasCount = 0;
  let gruposCount = 0;
  let gruposSkipped = 0;
  for (const preset of org.routePresets || []) {
    const turnoId = turnoMap.get(preset.shiftId);
    if (!turnoId) continue;
    const tipo = preset.type === 'evening' ? 'vuelta' : 'ida';
    plantillasCount++;
    let plantillaId = `<dry-run>`;
    if (APPLY) {
      const { data, error } = await sb
        .from('remises_plantillas')
        .insert({ nombre: preset.name, tipo, turno_id: turnoId })
        .select('id')
        .single();
      if (error) throw new Error('No pude insertar remises_plantillas: ' + error.message);
      plantillaId = data.id;
    }
    const grupoRows = [];
    for (const group of preset.groups || []) {
      const vehiculoId = vehiculoMap.get(group.vehicleId);
      if (!vehiculoId) continue;
      for (const fsEmpId of group.empIds || []) {
        const empleadoId = empMap.get(fsEmpId);
        if (!empleadoId) {
          gruposSkipped++;
          continue;
        }
        grupoRows.push({ plantilla_id: plantillaId, vehiculo_id: vehiculoId, empleado_id: empleadoId });
      }
    }
    gruposCount += grupoRows.length;
    if (APPLY && grupoRows.length) {
      const { error } = await sb.from('remises_plantillas_grupos').upsert(grupoRows, {
        onConflict: 'plantilla_id,vehiculo_id,empleado_id',
        ignoreDuplicates: true,
      });
      if (error) throw new Error('No pude insertar remises_plantillas_grupos: ' + error.message);
    }
  }
  console.log(`remises_plantillas a insertar: ${plantillasCount}`);
  console.log(`remises_plantillas_grupos a insertar: ${gruposCount} (omitidos por empleado sin match: ${gruposSkipped})`);
  console.log('---------------------------------------------------------------');

  // ── 9. remises_config (singleton) ────────────────────────────────────
  console.log(
    `remises_config: fabrica_nombre="${org.factory.name}", direccion="${org.factory.address}", ` +
      `lat=${org.factory.lat}, lng=${org.factory.lng}, velocidad=${org.speed}, ciudad="${org.city}"`
  );
  if (APPLY) {
    const { error } = await sb
      .from('remises_config')
      .update({
        fabrica_nombre: org.factory.name,
        fabrica_direccion: org.factory.address || null,
        fabrica_lat: org.factory.lat,
        fabrica_lng: org.factory.lng,
        velocidad_kmh: org.speed,
        ciudad_referencia: org.city || null,
      })
      .eq('id', 1);
    if (error) throw new Error('No pude actualizar remises_config: ' + error.message);
  }

  console.log('---------------------------------------------------------------');
  console.log(APPLY ? 'LISTO — datos escritos en Supabase.' : 'Fin del dry-run. Corré con --apply para escribir de verdad.');
}

main().catch((err) => {
  console.error('ERROR:', err.message || err);
  process.exit(1);
});
