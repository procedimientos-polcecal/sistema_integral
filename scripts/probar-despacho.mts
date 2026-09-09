// Diagnóstico del módulo Despacho, de punta a punta y SIN escribir nada.
//
// Sirve antes de un deploy o cuando algo no aparece en la pantalla de la
// balanza: dice si la variable está, si la pestaña del mes existe, en qué fila
// caería la próxima orden, qué remitos devuelve Odoo y qué fila exacta le
// mandaría a la planilla una orden armada con un remito real.
//
// Uso: npx tsx scripts/probar-despacho.mts
//
// Recorre el mismo camino que la pantalla de la balanza: la variable, la
// pestaña del mes, los remitos de Odoo del día, y qué fila exacta le mandaría a
// la planilla una orden armada con un remito real.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { listarPestanas, leerValores } from "../lib/core/sheets.ts";
import { hayEspejoDeDespacho } from "../lib/despacho/espejo.ts";
import { pestanaDelMes, filaDeLaPlanilla, COLUMNAS } from "../lib/despacho/planilla.ts";
import { remitosParaElAlta } from "../lib/despacho/odoo.ts";
import { clasificacionDe } from "../lib/despacho/clasificacion.ts";
import { traerMapeoDeProductos, remitosYaUsados } from "../lib/despacho/consultas.ts";
import { hoyEnArgentina } from "../lib/core/fechas.ts";
import type { OrdenDeCarga } from "../lib/despacho/types.ts";

const RAIZ = "C:/Users/Usuario/Desktop/SdG PP/";
for (const line of readFileSync(RAIZ + ".env.local", "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const hoy = hoyEnArgentina();
console.log(`Hoy en Argentina: ${hoy}\n`);

// ── 1. La variable ───────────────────────────────────────────
const id = process.env.GOOGLE_SHEETS_DESPACHO_ID;
console.log(`1. GOOGLE_SHEETS_DESPACHO_ID = ${id ?? "(no está)"}`);
console.log(`   hayEspejoDeDespacho() = ${hayEspejoDeDespacho()}`);
if (!hayEspejoDeDespacho()) { console.log("   → el espejo no escribiría; el resto no tiene sentido"); process.exit(1); }

// ── 2. La pestaña del mes ────────────────────────────────────
const pestanas = await listarPestanas(id!);
const pestanaHoy = pestanaDelMes(hoy);
console.log(`\n2. Pestaña de hoy: "${pestanaHoy}" — ${pestanas.includes(pestanaHoy!) ? "existe" : "NO existe, el espejo la crearía"}`);
console.log(`   Pestañas del libro: ${pestanas.join(", ")}`);

// Dónde caería la fila nueva, mirando la columna B como hace agregarFila.
const colB = await leerValores(id!, `${pestanaHoy}!B:B`);
let ultima = 0;
for (let i = colB.length - 1; i >= 0; i--) if (String(colB[i]?.[0] ?? "").trim()) { ultima = i + 2; break; }
console.log(`   La próxima orden iría a la fila ${ultima} de "${pestanaHoy}"`);

// ── 3. Los remitos de Odoo del día ───────────────────────────
console.log(`\n3. Remitos de salida de Odoo, ventana de 7 dias hasta ${hoy}:`);
const remitos = await remitosParaElAlta(hoy);
const usados = await remitosYaUsados(sb, remitos.map((r) => r.picking_id));
if (remitos.length === 0) console.log("   ninguno (Odoo no devolvió remitos programados para hoy)");
for (const r of remitos.slice(0, 8)) {
  console.log(
    `   ${r.nombre.padEnd(18)} ${r.estado.padEnd(10)} ${String(r.cliente).slice(0, 28).padEnd(30)}` +
      ` ${String(r.producto).slice(0, 28).padEnd(30)} ${r.cantidad ?? "-"} ${r.unidad ?? ""}` +
      (usados.has(r.picking_id) ? "  [ya tiene orden]" : "")
  );
}
if (remitos.length > 8) console.log(`   … y ${remitos.length - 8} más`);

// ── 4. Qué fila mandaría a la planilla ───────────────────────
const mapeo = await traerMapeoDeProductos(sb);
console.log(`\n4. Mapeo de productos cargado: ${mapeo.length} productos clasificados`);

const r = remitos.find((x) => !usados.has(x.picking_id)) ?? remitos[0];
if (!r) { console.log("   sin remitos no se puede armar el ejemplo"); process.exit(0); }

const ahora = new Date();
const hace = (min: number) => new Date(ahora.getTime() - min * 60000).toISOString();
const orden: OrdenDeCarga = {
  id: "de-mentira", numero: "99999", fecha: hoy, empresa_id: null,
  odoo_picking_id: r.picking_id, odoo_picking_name: r.nombre, odoo_sale_name: r.pedido,
  odoo_product_id: r.odoo_product_id, cliente_raw: r.cliente, producto_raw: r.producto,
  cantidad: r.cantidad, unidad: r.unidad,
  entrada_predio: hace(95), inicio_carga: hace(75), fin_carga: hace(20), salida_predio: hace(5),
  notas: null, supervisor_raw: null, supervisor_id: null,
  sheets_fila: null, sheets_pendiente: null, sheets_pendiente_en: null,
};

const clasif = clasificacionDe(orden.odoo_product_id, mapeo);
const fila = filaDeLaPlanilla(orden, clasif);
console.log(`   Ejemplo con el remito ${r.nombre} (clasificación: ${clasif ? JSON.stringify(clasif) : "sin clasificar"}):`);
for (let i = 0; i < fila.length; i++) {
  console.log(`     ${String.fromCharCode(65 + i)}  ${COLUMNAS[i].padEnd(24)} ${JSON.stringify(fila[i])}`);
}
console.log("\n   (nada de esto se escribió: es lo que el espejo mandaría)");
