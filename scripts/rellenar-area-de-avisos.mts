// Ponerle área a los avisos que ya existían.
//
// POR QUÉ HACE FALTA
//
// `avisos.area_id` se agregó el 22/10/2026 (migración `20261022101507`), así que
// todos los avisos anteriores la tienen en null. `/mis-avisos` filtra por área:
// sin este relleno abre vacía el primer día para todo el mundo, que es el error
// que ya cometió «Mis pedidos» cuando filtraba por `solicitante_id` y esa columna
// estaba en null en los 1.947 requerimientos.
//
// DE DÓNDE SALE EL ÁREA
//
// De `quien_aviso`, que es texto libre escrito en una planilla de Google
// («MARTIN SANDOVAL», «Martín  Sandoval»). Se cruza contra `usuarios` y de ahí a
// `usuario_areas_compras` con `resolverElArea()`, la misma función que usa la
// sincronización y el alta desde la app: si este script decidiera por su cuenta,
// el mismo aviso caería en áreas distintas según por dónde entró.
//
// Esa función **no adivina**: devuelve null cuando el nombre no existe, cuando
// empata con otro usuario, cuando la persona no tiene área y cuando tiene dos.
// Un área equivocada no se nota nunca —el aviso aparece en la pantalla de otro—;
// un aviso sin área se ve y se arregla a mano. Por eso este script **dice qué
// nombres no resolvió y por qué**: es lo accionable, y no se arreglan igual.
//
// Los usuarios se traen todos, también los dados de baja, igual que
// `cargarLasAreasDeLosAvisos` de la sincronización: son dos caminos que tienen
// que decidir lo mismo.
//
// Sólo se tocan los avisos con `area_id` en null, y el UPDATE lo repite como
// condición (`is null`): si alguien eligió un área entre la lectura y la
// escritura, no se la pisa.
//
// Uso:
//   npx tsx scripts/rellenar-area-de-avisos.mts            ← dice qué haría
//   npx tsx scripts/rellenar-area-de-avisos.mts --aplicar
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { createAdminClient } = await import("../lib/supabase/admin.ts");
const { traerTodo } = await import("../lib/core/paginado.ts");
const { resolverElArea } = await import("../lib/mantenimiento/areaDelAviso.ts");
const { indiceDeCatalogo, elQueNombra, claveDeNombre } = await import("../lib/core/catalogo.ts");

const APLICAR = process.argv.includes("--aplicar");
const TAMANO_LOTE = 200;

const admin = createAdminClient();

/* ── Lo que se lee ──────────────────────────────────────────────────────── */

const usuarios = await traerTodo((desde, hasta) =>
  admin
    .from("usuarios")
    .select("id, nombre, apellido, activo, usuario_areas_compras(area_id)")
    .order("id")
    .range(desde, hasta)
);

const areas = await traerTodo((desde, hasta) =>
  admin.from("compras_areas").select("id, nombre").order("id").range(desde, hasta)
);
const nombreDelArea = new Map(areas.map((a) => [a.id as string, a.nombre as string]));

const sinArea = await traerTodo((desde, hasta) =>
  admin
    .from("avisos")
    .select("oa_number, quien_aviso")
    .is("area_id", null)
    .order("oa_number")
    .range(desde, hasta)
);

const { count: totalAvisos, error: errCuenta } = await admin
  .from("avisos")
  .select("oa_number", { count: "exact", head: true });
if (errCuenta) throw new Error(errCuenta.message);

const conUsuarioYAreas = usuarios.map((u) => ({
  id: u.id as string,
  nombre: (u.nombre as string | null) ?? "",
  apellido: (u.apellido as string | null) ?? "",
  areas: (u.usuario_areas_compras ?? []).map((a) => a.area_id as string),
}));

const areaDe = resolverElArea(conUsuarioYAreas);

/* ── Por qué no se resolvió ─────────────────────────────────────────────────
 *
 * Esto es sólo diagnóstico: la decisión la toma `resolverElArea`. Usa el mismo
 * índice y la misma clave que ella —`indiceDeCatalogo`, `elQueNombra`— para no
 * tener una segunda normalización.
 */
const indice = indiceDeCatalogo(
  conUsuarioYAreas.map((u) => ({ id: u.id, nombre: `${u.nombre} ${u.apellido}` }))
);
const usuarioPorId = new Map(conUsuarioYAreas.map((u) => [u.id, u]));
const activoPorId = new Map(usuarios.map((u) => [u.id as string, u.activo as boolean | null]));

function motivoDeNoResolver(quienAviso: string | null): string {
  if (!claveDeNombre(quienAviso ?? "")) return "quien_aviso vacío";
  const { id, motivo } = elQueNombra(indice, quienAviso ?? "");
  if (!id) {
    return motivo === "ambiguo"
      ? "ambiguo: dos usuarios se escriben igual (se arregla en el catálogo)"
      : "no existe: ningún usuario se llama así (corregir la planilla o dar de alta)";
  }
  const u = usuarioPorId.get(id)!;
  const n = new Set(u.areas).size;
  const baja = activoPorId.get(id) === false ? " [usuario dado de baja]" : "";
  return n === 0
    ? `existe pero sin área cargada${baja} (Administración → Usuarios)`
    : `existe pero tiene ${n} áreas${baja} (no se elige: queda a mano)`;
}

/* ── Qué haría ──────────────────────────────────────────────────────────── */

const porArea = new Map<string, string[]>(); // area_id → oa_number[]
const sinResolver = new Map<string, { nombre: string; motivo: string; avisos: number }>();

for (const a of sinArea) {
  const area = areaDe(a.quien_aviso as string | null);
  if (area) {
    const lista = porArea.get(area) ?? [];
    lista.push(String(a.oa_number));
    porArea.set(area, lista);
    continue;
  }
  const crudo = (a.quien_aviso as string | null) ?? "";
  // Se agrupa por la clave normalizada para que las cuatro grafías de la misma
  // persona cuenten juntas; se muestra la primera que aparece.
  const clave = claveDeNombre(crudo) || "(vacío)";
  const previo = sinResolver.get(clave);
  if (previo) previo.avisos += 1;
  else
    sinResolver.set(clave, {
      nombre: crudo.trim().replace(/\s+/g, " ") || "(vacío)",
      motivo: motivoDeNoResolver(crudo),
      avisos: 1,
    });
}

const aResolver = [...porArea.values()].reduce((n, l) => n + l.length, 0);
const aDejar = sinArea.length - aResolver;

console.log(`Avisos en total: ${totalAvisos}`);
console.log(`Avisos con area_id en null (los únicos que se tocan): ${sinArea.length}`);
console.log(`  quedarían CON área: ${aResolver}`);
console.log(`  quedarían SIN área: ${aDejar}`);

console.log("\nDesglose de los que sí se resuelven:");
for (const [id, lista] of [...porArea.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(lista.length).padStart(4)}  ${nombreDelArea.get(id) ?? `(área ${id} no está en compras_areas)`}`);
}

console.log("\nNombres que NO se resolvieron (avisos · nombre · por qué):");
if (sinResolver.size === 0) console.log("  ninguno");
for (const r of [...sinResolver.values()].sort((a, b) => b.avisos - a.avisos)) {
  console.log(`  ${String(r.avisos).padStart(4)}  ${r.nombre}  —  ${r.motivo}`);
}

/* ── Escribir ───────────────────────────────────────────────────────────── */

if (!APLICAR) {
  console.log("\nEn seco: no se escribió nada. Con --aplicar se actualizan esos avisos.");
  process.exit(0);
}

let actualizados = 0;
for (const [areaId, numeros] of porArea) {
  for (let i = 0; i < numeros.length; i += TAMANO_LOTE) {
    const lote = numeros.slice(i, i + TAMANO_LOTE);
    const { data, error } = await admin
      .from("avisos")
      .update({ area_id: areaId })
      .in("oa_number", lote)
      .is("area_id", null) // no pisar lo que alguien eligió mientras tanto
      .select("oa_number");
    if (error) throw new Error(error.message);
    actualizados += data?.length ?? 0;
  }
}
console.log(`\nActualizados: ${actualizados} de ${aResolver}.`);
if (actualizados !== aResolver) {
  console.log("La diferencia son avisos que recibieron área entre la lectura y la escritura: no se pisaron.");
}
