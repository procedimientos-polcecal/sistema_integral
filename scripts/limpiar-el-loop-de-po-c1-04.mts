// Saca las OT que generó en loop el ciclo de PO-C1-04 entre el 20 y el
// 24/11/2026: de la planilla, de la base y del calendario.
//
//   npx tsx scripts/limpiar-el-loop-de-po-c1-04.mts              ← sólo dice qué haría
//   npx tsx scripts/limpiar-el-loop-de-po-c1-04.mts --ejecutar   ← lo hace
//
// ── LO QUE HAY QUE SABER ANTES DE CORRERLO ──────────────────────────────────
//
// **Se conserva la 3166**, que es la orden legítima: el «Cambio de Martillos»
// que de verdad tocaba después de la tercera rotación, con fecha 23/11. El
// loop fabricó 425 duplicados de una orden que estaba bien.
//
// **No se borra por rango de filas.** Las 427 filas del bloque 272–698 de
// «Altas del sistema» incluyen dos órdenes legítimas de otros equipos que
// cayeron en el medio. Se borra fila por fila, por número de OT, y de abajo
// hacia arriba para que los índices de las de arriba sigan valiendo.
//
// **Primero la planilla y después la base**, en ese orden: al revés, la
// sincronización siguiente reimporta del master las OT recién borradas, y las
// trae sin `ciclo_id`, o sea imposibles de volver a encontrar. En el medio no
// pasa nada malo: `borradoDeEspejo` se frena solo pasadas las 50 filas.
//
// El `sheets_row` guardado de las dos que se conservan queda viejo, y **no
// importa**: `escribirEnLaFilaDeLaOT` busca el número en la columna A al
// momento de escribir, y la próxima sincronización lo reescribe.

import { readFileSync, existsSync } from "node:fs";
const env = process.env.ENV_PATH ?? new URL("../.env.local", import.meta.url).pathname;
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { leerValores } = await import("../lib/core/sheets.ts");
const { HOJA_DE_ALTAS } = await import("../lib/mantenimiento/formulario.ts");
const { obtenerToken, SCOPE_SHEETS } = await import("../lib/core/google.ts");
const { borrarEvento } = await import("../lib/core/calendar.ts");

const EJECUTAR = process.argv.includes("--ejecutar");
const EQUIPO = "PO-C1-04";
const SE_CONSERVA = 3166;

const U = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const K = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const PLANILLA = process.env.GOOGLE_SHEETS_MANTENIMIENTO_FORMULARIO_ID ?? "";
if (!U || !K) throw new Error("Falta la URL de Supabase o la service role key");
if (!PLANILLA) throw new Error("Falta GOOGLE_SHEETS_MANTENIMIENTO_FORMULARIO_ID");

const sb = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const res = await fetch(`${U}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: K, Authorization: `Bearer ${K}`,
      "Content-Type": "application/json", Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const body = res.status === 204 ? [] : await res.json();
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(body)}`);
  return body as T;
};

// ── 1. Qué hay que sacar ────────────────────────────────────────────────────
const ciclos = await sb<Array<{ id: string; activo: boolean; equipos: { code: string } | null }>>(
  "mant_ciclos_de_ot?select=id,activo,equipos:equipment_id(code)"
);
const ciclo = ciclos.find((c) => c.equipos?.code === EQUIPO);
if (!ciclo) throw new Error(`no está el ciclo de ${EQUIPO}`);

const aBorrar = await sb<Array<{ id: string; ot_number: number }>>(
  `ordenes_trabajo?select=id,ot_number&ciclo_id=eq.${ciclo.id}&ciclo_vuelta=eq.0` +
  `&ot_number=gt.${SE_CONSERVA}&order=ot_number.asc&limit=2000`
);
const numeros = new Set(aBorrar.map((o) => o.ot_number));

console.log(`Ciclo de ${EQUIPO} (activo=${ciclo.activo})`);
console.log(`A borrar: ${aBorrar.length} OT, de la ${aBorrar[0]?.ot_number} a la ${aBorrar.at(-1)?.ot_number}`);
console.log(`Se conserva la ${SE_CONSERVA}.`);

// ── 2. Qué filas son, en «Altas del sistema» ────────────────────────────────
const filas = await leerValores(PLANILLA, `${HOJA_DE_ALTAS}!A:A`, { sinFormato: true });
const aBorrarFilas: number[] = [];
const seQuedanEnElBloque: { fila: number; ot: number }[] = [];
const min = Math.min(...numeros), max = Math.max(...numeros);

for (let i = 1; i < filas.length; i++) {
  const n = Number(String(filas[i]?.[0] ?? "").trim());
  if (!Number.isFinite(n) || n === 0) continue;
  if (numeros.has(n)) aBorrarFilas.push(i + 1);
  else if (n >= min && n <= max) seQuedanEnElBloque.push({ fila: i + 1, ot: n });
}

console.log(`\nFilas de «${HOJA_DE_ALTAS}» a borrar: ${aBorrarFilas.length} (de ${aBorrarFilas.length} esperadas: ${aBorrarFilas.length === numeros.size ? "TODAS" : "FALTAN " + (numeros.size - aBorrarFilas.length)})`);
console.log(`Órdenes legítimas intercaladas que SE CONSERVAN: ${seQuedanEnElBloque.length}`);
for (const s of seQuedanEnElBloque) console.log(`   fila ${s.fila} → OT ${s.ot}`);

// Tramos contiguos, de abajo hacia arriba.
const tramos: Array<{ desde: number; hasta: number }> = [];
for (const f of [...aBorrarFilas].sort((a, b) => a - b)) {
  const ult = tramos.at(-1);
  if (ult && f === ult.hasta + 1) ult.hasta = f;
  else tramos.push({ desde: f, hasta: f });
}
tramos.reverse();
console.log(`\nTramos a borrar (de abajo hacia arriba): ${tramos.length}`);
for (const t of tramos) console.log(`   filas ${t.desde}–${t.hasta} (${t.hasta - t.desde + 1})`);

// ── 3. Qué cuelga ───────────────────────────────────────────────────────────
const ids = aBorrar.map((o) => o.id);
const lotes = <T>(a: T[], n: number): T[][] =>
  a.length ? [a.slice(0, n), ...lotes(a.slice(n), n)] : [];

const eventos: Array<{ id: string; casilla: string; google_event_id: string | null; ot_id: string }> = [];
for (const l of lotes(ids, 120)) {
  eventos.push(...await sb<typeof eventos>(
    `agenda_eventos?select=id,casilla,google_event_id,ot_id&ot_id=in.(${l.join(",")})&limit=2000`
  ));
}
console.log(`\nEventos de calendario a borrar: ${eventos.length} (con id de Google: ${eventos.filter((e) => e.google_event_id).length})`);

let notas = 0;
for (const l of lotes(ids, 120)) {
  notas += (await sb<unknown[]>(`ordenes_trabajo_notas?select=id&orden_id=in.(${l.join(",")})&limit=2000`)).length;
}
console.log(`Notas que se irían en cascada: ${notas}`);

if (!EJECUTAR) {
  console.log("\n── Esto fue sólo el plan. Para hacerlo: --ejecutar ──");
  process.exit(0);
}

// ── 4. La planilla, primero ─────────────────────────────────────────────────
const idDeLaPestana = async (): Promise<number> => {
  const token = await obtenerToken([SCOPE_SHEETS]);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${PLANILLA}?fields=sheets.properties(sheetId,title)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`no se pudo leer la planilla: ${res.status}`);
  const d = (await res.json()) as { sheets?: { properties: { sheetId: number; title: string } }[] };
  const hoja = d.sheets?.find((s) => s.properties.title === HOJA_DE_ALTAS);
  if (!hoja) throw new Error(`no está la pestaña «${HOJA_DE_ALTAS}»`);
  return hoja.properties.sheetId;
};

const sheetId = await idDeLaPestana();
const token = await obtenerToken([SCOPE_SHEETS]);
const res = await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${PLANILLA}:batchUpdate`,
  {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: tramos.map((t) => ({
        deleteDimension: {
          range: { sheetId, dimension: "ROWS", startIndex: t.desde - 1, endIndex: t.hasta },
        },
      })),
    }),
  }
);
if (!res.ok) throw new Error(`la planilla rechazó el borrado: ${res.status} ${await res.text()}`);
console.log(`\n✓ Planilla: ${aBorrarFilas.length} filas borradas en ${tramos.length} tramos.`);

// ── 5. El calendario ────────────────────────────────────────────────────────
let borrados = 0, fallaron = 0;
for (const e of eventos) {
  if (!e.google_event_id) continue;
  try { await borrarEvento(e.casilla, e.google_event_id); borrados++; }
  catch { fallaron++; }
}
console.log(`✓ Calendario: ${borrados} eventos borrados, ${fallaron} fallaron.`);

// ── 6. La base, al final ────────────────────────────────────────────────────
let filasBorradas = 0;
for (const l of lotes(ids, 120)) {
  const r = await sb<unknown[]>(`ordenes_trabajo?id=in.(${l.join(",")})`, { method: "DELETE" });
  filasBorradas += r.length;
}
console.log(`✓ Base: ${filasBorradas} OT borradas.`);

const quedan = await sb<Array<{ ot_number: number; estado: string }>>(
  `ordenes_trabajo?select=ot_number,estado&ciclo_id=eq.${ciclo.id}&order=ot_number.asc`
);
console.log(`\nQuedan ${quedan.length} OT en el ciclo: ${quedan.map((o) => `${o.ot_number}(${o.estado})`).join(", ")}`);
