/**
 * Les pone el CUIT a los proveedores del padrón que coinciden por nombre con un
 * único partner de Odoo.
 *
 *   npx tsx scripts/cuit-de-los-proveedores-por-nombre.mts            # ensayo
 *   npx tsx scripts/cuit-de-los-proveedores-por-nombre.mts --aplicar
 *
 * **Es una limpieza de una vez, no un proceso.** El cruce por CUIT que corre en
 * `/api/odoo/proveedores/preview` está saturado —enlaza uno más— y lo que lo
 * frena es que 324 de los 479 proveedores no tienen CUIT. Esto cierra los que se
 * pueden cerrar sin adivinar; los que importan de verdad —109 con actividad que
 * no están en Odoo con ese nombre— se resuelven cuando llega su factura, con el
 * botón del buzón.
 *
 * La decisión de qué se propone vive en `lib/odoo/cuitPorNombre.ts`, que es pura
 * y está testeada. Acá va el viaje, el ensayo y la escritura.
 *
 * **Por defecto no escribe nada.** Imprime los dos nombres uno al lado del otro
 * —el del padrón y el de Odoo— porque es lo único que permite ver si la
 * coincidencia es la que uno cree antes de guardar un CUIT que después engancha
 * facturas solo.
 */

import { readFileSync } from "node:fs";

for (const linea of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const { buscarLeer } = await import("@/lib/odoo/client");
const { proponerCuitPorNombre } = await import("@/lib/odoo/cuitPorNombre");

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const CLAVE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CABECERA = { apikey: CLAVE, Authorization: `Bearer ${CLAVE}` };
const aplicar = process.argv.includes("--aplicar");

/** PostgREST corta en 1000 y no avisa. */
async function traerTodas<T>(consulta: string): Promise<T[]> {
  const todas: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const r = await fetch(`${URL_BASE}/rest/v1/${consulta}`, {
      headers: { ...CABECERA, Range: `${desde}-${desde + 999}` },
    });
    const lote = (await r.json()) as T[];
    if (!Array.isArray(lote) || !lote.length) break;
    todas.push(...lote);
    if (lote.length < 1000) break;
  }
  return todas;
}

const proveedores = await traerTodas<{ id: string; nombre: string; cuit: string | null }>(
  "proveedores?select=id,nombre,cuit"
);

/*
 * La actividad no cambia a quién se le pone el CUIT, pero sí qué tan en serio
 * hay que mirar cada línea: un proveedor que nunca facturó ni pidió nada es un
 * nombre suelto, y uno con actividad va a enganchar facturas apenas tenga CUIT.
 */
const ri = await traerTodas<{ proveedor_id: string }>(
  "compras_requerimientos?select=proveedor_id&proveedor_id=not.is.null"
);
const facturas = await traerTodas<{ proveedor_id: string }>(
  "facturas_proveedor?select=proveedor_id&proveedor_id=not.is.null"
);
const activos = new Set([...ri, ...facturas].map((f) => f.proveedor_id));

/*
 * Todos los partners con CUIT y no sólo los marcados proveedor: medido, mirar
 * los 1.632 en vez de los 634 no agrega ni una coincidencia, pero tampoco
 * cuesta, y el día que alguien dé de alta un proveedor sin marcarlo aparece.
 */
const partners = await buscarLeer<{ name: string; vat: string | false; active: boolean; parent_id: unknown }>(
  "res.partner",
  [["vat", "!=", false]],
  ["name", "vat", "active", "parent_id"],
  { limite: 8000 }
);

const deOdoo = partners
  .filter((p) => p.active && !p.parent_id && p.vat)
  .map((p) => ({ nombre: p.name, cuit: String(p.vat) }));

const sinCuit = proveedores.filter((p) => !p.cuit);
const yaUsados = proveedores.map((p) => p.cuit ?? "").filter(Boolean);
const { cuits: propuestas, repetidos } = proponerCuitPorNombre(sinCuit, deOdoo, yaUsados);

console.log(`padrón: ${proveedores.length} proveedores · ${sinCuit.length} sin CUIT`);
console.log(`partners de Odoo con CUIT, activos y sin padre: ${deOdoo.length}`);
console.log(`\npropuestas: ${propuestas.length}\n`);

for (const p of propuestas) {
  const marca = activos.has(p.proveedorId) ? "CON ACTIVIDAD" : "sin actividad";
  console.log(`  ${marca}  ${p.cuit}`);
  console.log(`     padrón: ${p.nombre}`);
  console.log(`     Odoo:   ${p.nombreEnOdoo}`);
}

const conActividad = propuestas.filter((p) => activos.has(p.proveedorId)).length;
console.log(`\nde las ${propuestas.length}, ${conActividad} son de proveedores con actividad.`);

/*
 * Los que quedan afuera se imprimen aunque no se toquen.
 *
 * Son un problema de datos que esto no crea pero sí destapa —el padrón tiene
 * la misma empresa dos veces—, y callarlos haría que la cuenta no cierre: de
 * 54 coincidencias por nombre quedan 13 propuestas, y sin esta lista los 41
 * que faltan se pierden sin que nadie sepa que existieron. La primera versión
 * de este script los descartaba en silencio.
 */
if (repetidos.length) {
  const filas = repetidos.reduce((a, r) => a + r.proveedores.length, 0);
  console.log(
    `\nNO se tocan ${filas} filas en ${repetidos.length} CUIT: el padrón tiene la misma ` +
      `empresa más de una vez, o el CUIT ya lo usa otro proveedor.`
  );
  console.log("Hay que fusionarlas a mano: escribirles el mismo CUIT deja un duplicado que el cruce rechaza.\n");
  for (const r of repetidos) {
    console.log(`  ${r.cuit}  (${r.nombreEnOdoo})`);
    for (const p of r.proveedores) console.log(`     padrón: ${p.nombre}`);
  }
}

if (!aplicar) {
  console.log("\nEnsayo: no se escribió nada. Con --aplicar se guardan.");
  process.exit(0);
}

let guardados = 0;
const fallaron: string[] = [];

for (const p of propuestas) {
  const r = await fetch(`${URL_BASE}/rest/v1/proveedores?id=eq.${p.proveedorId}`, {
    method: "PATCH",
    headers: { ...CABECERA, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ cuit: p.cuit }),
  });
  if (r.ok) guardados++;
  else fallaron.push(`${p.nombre}: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
}

console.log(`\nguardados: ${guardados} de ${propuestas.length}`);
for (const f of fallaron) console.log(`  FALLÓ ${f}`);
