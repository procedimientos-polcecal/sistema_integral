/**
 * Les guarda a los proveedores del padrón la razón social que figura en Odoo.
 *
 *   npx tsx scripts/razon-social-desde-odoo.mts            # ensayo
 *   npx tsx scripts/razon-social-desde-odoo.mts --aplicar
 *
 * **No toca `nombre`.** Escribe `razon_social`, que es una columna aparte
 * agregada por la migración `20261111110129`. El porqué está ahí y en
 * `lib/odoo/razonSocial.ts`, y se resume en dos cosas medidas: reemplazar el
 * nombre dejaría 57 duplicados en la corrida siguiente de Compras, y la razón
 * social muchas veces no es el nombre con que se lo conoce.
 *
 * Se puede correr cuantas veces haga falta: no propone lo que ya está guardado.
 */

import { readFileSync } from "node:fs";

for (const linea of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const { buscarLeer } = await import("@/lib/odoo/client");
const { razonesSocialesDeOdoo } = await import("@/lib/odoo/razonSocial");

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const CLAVE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CABECERA = { apikey: CLAVE, Authorization: `Bearer ${CLAVE}` };
const aplicar = process.argv.includes("--aplicar");

async function traerTodas<T>(consulta: string): Promise<T[]> {
  const todas: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const r = await fetch(`${URL_BASE}/rest/v1/${consulta}`, {
      headers: { ...CABECERA, Range: `${desde}-${desde + 999}` },
    });
    const lote = await r.json();
    /*
     * PostgREST contesta un objeto con `message` cuando algo falla —una
     * columna que no existe, por ejemplo—, y tratarlo como lista vacía hacía
     * que el script dijera «0 proveedores», que es indistinguible de un padrón
     * vacío. Un error se dice.
     */
    if (!Array.isArray(lote)) {
      throw new Error(
        `La base contestó: ${(lote as { message?: string })?.message ?? JSON.stringify(lote).slice(0, 200)}`
      );
    }
    if (!lote.length) break;
    todas.push(...(lote as T[]));
    if (lote.length < 1000) break;
  }
  return todas;
}

const filas = await traerTodas<{ id: string; nombre: string; cuit: string | null; razon_social: string | null }>(
  "proveedores?select=id,nombre,cuit,razon_social"
);

const partners = await buscarLeer<{ name: string; vat: string | false; active: boolean; parent_id: unknown }>(
  "res.partner",
  [["vat", "!=", false]],
  ["name", "vat", "active", "parent_id"],
  { limite: 8000 }
);

const deOdoo = partners
  .filter((p) => p.active && !p.parent_id)
  .map((p) => ({ nombre: p.name, cuit: p.vat }));

const { razones, conDosNombres } = razonesSocialesDeOdoo(
  filas.map((f) => ({ id: f.id, nombre: f.nombre, cuit: f.cuit, razonSocial: f.razon_social })),
  deOdoo
);

const conCuit = filas.filter((f) => f.cuit).length;
const yaTienen = filas.filter((f) => f.razon_social).length;

console.log(`padrón: ${filas.length} proveedores · ${conCuit} con CUIT · ${yaTienen} ya con razón social`);
console.log(`partners de Odoo con CUIT, activos y sin padre: ${deOdoo.length}`);
console.log(`\npropuestas: ${razones.length}\n`);

for (const r of razones) {
  console.log(`  "${r.nombre}"`);
  console.log(`     -> ${r.razonSocial}`);
}

/*
 * Los ambiguos se imprimen aunque no se toquen: son 31 y dejarlos sin nombrar
 * haría que la cuenta no cierre entre los que tienen CUIT y los que terminan
 * con razón social.
 */
if (conDosNombres.length) {
  console.log(`\nNO se tocan ${conDosNombres.length}: ese CUIT tiene dos nombres en Odoo.`);
  for (const c of conDosNombres) {
    console.log(`  ${c.cuit}  padrón: "${c.nombre}"`);
    for (const n of c.enOdoo) console.log(`     Odoo: ${n}`);
  }
}

if (!aplicar) {
  console.log("\nEnsayo: no se escribió nada. Con --aplicar se guardan.");
  process.exit(0);
}

let guardados = 0;
const fallaron: string[] = [];

for (const r of razones) {
  const res = await fetch(`${URL_BASE}/rest/v1/proveedores?id=eq.${r.proveedorId}`, {
    method: "PATCH",
    headers: { ...CABECERA, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ razon_social: r.razonSocial }),
  });
  if (res.ok) guardados++;
  else fallaron.push(`${r.nombre}: HTTP ${res.status} ${(await res.text()).slice(0, 140)}`);
}

console.log(`\nguardados: ${guardados} de ${razones.length}`);
for (const f of fallaron) console.log(`  FALLÓ ${f}`);
