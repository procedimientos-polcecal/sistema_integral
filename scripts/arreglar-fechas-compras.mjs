/**
 * Endereza las fechas que la sincronización guardó dadas vuelta.
 *
 * El parser de `lib/compras/sheets.ts` suponía que la planilla escribía m/d
 * cuando escribe d/m, así que invertía día y mes en toda fecha cuyo día fuera
 * 12 o menos. El parser ya está corregido; esto arregla lo que quedó guardado.
 *
 * La detección es exacta, no una heurística:
 *
 *   - si el día original era > 12, el parser lo tomaba como día y acertaba,
 *     y el día guardado quedó > 12;
 *   - si era ≤ 12, lo tomaba como mes, y el día guardado pasó a ser el MES
 *     original, que siempre es ≤ 12.
 *
 * Por lo tanto: día guardado ≤ 12 ⟺ la fecha está dada vuelta. Y enderezarla es
 * intercambiar día y mes, que es reversible.
 *
 * Sólo alcanza a lo que escribió el parser viejo: cada UPDATE va condicionado al
 * valor que se leyó, así que si la sincronización ya corrigió una fila entre la
 * lectura y la escritura, esa fila se deja como está en vez de pisarla.
 *
 * Uso:
 *   node scripts/arreglar-fechas-compras.mjs              (dry-run, no escribe)
 *   node scripts/arreglar-fechas-compras.mjs --aplicar
 */

import fs from "node:fs";

const APLICAR = process.argv.includes("--aplicar");

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const BASE = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/rest\/v1\/?$/, "");
const KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!BASE || !KEY) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

/** PostgREST corta en 1000 filas y no avisa. */
async function traerTodo(path) {
  const todo = [];
  for (let desde = 0; ; desde += 1000) {
    const res = await fetch(`${BASE}/rest/v1/${path}`, {
      headers: { ...H, Range: `${desde}-${desde + 999}` },
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    const lote = await res.json();
    todo.push(...lote);
    if (lote.length < 1000) return todo;
  }
}

/** Intercambia día y mes. Devuelve null si la fecha no está dada vuelta. */
function enderezar(valor) {
  if (!valor) return null;
  const m = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);
  if (!m) return null;

  const [, anio, mes, dia, resto] = m;
  // Día > 12: el parser viejo la había leído bien.
  if (Number(dia) > 12) return null;
  // El mes guardado pasa a ser el día, así que tiene que ser un día válido.
  if (Number(mes) < 1 || Number(mes) > 31) return null;

  return `${anio}-${dia}-${mes}${resto}`;
}

const filas = await traerTodo(
  "compras_requerimientos?select=id,nro_ri,fecha,fecha_necesidad&order=nro_ri.asc"
);

const cambios = [];
for (const f of filas) {
  const fecha = enderezar(f.fecha);
  const necesidad = enderezar(f.fecha_necesidad);
  if (fecha || necesidad) {
    cambios.push({ fila: f, fecha, necesidad });
  }
}

console.log(`Requerimientos leídos: ${filas.length}`);
console.log(`Con alguna fecha dada vuelta: ${cambios.length}`);
console.log(`  fecha de alta: ${cambios.filter((c) => c.fecha).length}`);
console.log(`  fecha de necesidad: ${cambios.filter((c) => c.necesidad).length}`);

console.log("\nMuestra (los 12 RI más altos):");
for (const c of cambios.slice(-12)) {
  const partes = [];
  if (c.fecha) partes.push(`alta ${c.fila.fecha.slice(0, 10)} → ${c.fecha.slice(0, 10)}`);
  if (c.necesidad) partes.push(`necesidad ${c.fila.fecha_necesidad} → ${c.necesidad}`);
  console.log(`  RI ${c.fila.nro_ri}: ${partes.join(" · ")}`);
}

if (!APLICAR) {
  console.log("\nDry-run: no se escribió nada. Con --aplicar se corrigen.");
  process.exit(0);
}

// Esto NO es idempotente: corrido dos veces vuelve a dar vuelta lo que arregló,
// porque después de corregir hay fechas legítimas con día ≤ 12. El seguro es
// dejar asentada la corrida y negarse a repetirla.
const previas = await fetch(
  `${BASE}/rest/v1/compras_sincronizaciones?origen=eq.arreglo-fechas&select=id,created_at`,
  { headers: H }
).then((r) => r.json());

if (Array.isArray(previas) && previas.length > 0) {
  console.error(
    `\nYa se corrió el ${previas[0].created_at}. No se repite: una segunda pasada` +
    "\nvolvería a dar vuelta las fechas que esta arregló."
  );
  process.exit(1);
}

let ok = 0;
let salteadas = 0;

for (const c of cambios) {
  const cuerpo = {};
  if (c.fecha) cuerpo.fecha = c.fecha;
  if (c.necesidad) cuerpo.fecha_necesidad = c.necesidad;

  // Condicionado al valor leído: si algo lo cambió mientras tanto, no se pisa.
  const filtros = [`id=eq.${c.fila.id}`];
  if (c.fecha) filtros.push(`fecha=eq.${encodeURIComponent(c.fila.fecha)}`);
  if (c.necesidad) filtros.push(`fecha_necesidad=eq.${c.fila.fecha_necesidad}`);

  const res = await fetch(`${BASE}/rest/v1/compras_requerimientos?${filtros.join("&")}`, {
    method: "PATCH",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify(cuerpo),
  });

  if (!res.ok) {
    console.error(`RI ${c.fila.nro_ri}: ${res.status} ${await res.text()}`);
    continue;
  }
  const escritas = await res.json();
  if (escritas.length === 0) salteadas++;
  else ok++;
}

await fetch(`${BASE}/rest/v1/compras_sincronizaciones`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    direccion: "interna",
    origen: "arreglo-fechas",
    filas_leidas: filas.length,
    filas_actualizadas: ok,
    filas_omitidas: salteadas,
  }),
});

console.log(`\nCorregidos: ${ok}`);
if (salteadas > 0) {
  console.log(`Salteados por haber cambiado mientras corría: ${salteadas}`);
}
console.log("Queda asentado en compras_sincronizaciones: no se puede repetir.");
