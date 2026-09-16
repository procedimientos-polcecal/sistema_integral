// Los veinte meses de la planilla de stock de carbonilla, al libro del SdG.
//
// CORRE UNA SOLA VEZ, Y ANTES QUE LA SINCRONIZACIÓN. El cron nunca mira antes
// de `CALIDAD_DESDE`, que es el día en que corre esto: primero la importación
// trae de la planilla **todo hasta ayer** —incluidos los camiones que Odoo
// todavía no tiene— y de ahí en más se ocupa el cron. Adelantar el corte para
// que la sincronización "haga algo" antes deja a esos camiones fuera de los dos
// lados.
//
// Uso:
//   npx tsx scripts/importar-stock-carbonilla.mts --secar   ← primero, siempre
//   npx tsx scripts/importar-stock-carbonilla.mts
//
// Spec: docs/superpowers/specs/2026-09-16-calidad-stock-de-carbonilla-design.md
import { readFileSync } from "node:fs";
import { leerValores } from "../lib/core/sheets.ts";
import { fechaDeSheets } from "../lib/core/fechaDeSheets.ts";
import { createAdminClient } from "../lib/supabase/admin.ts";
import { buscarLeer } from "../lib/odoo/client.ts";
import { CORTE_DE_LOS_TIPOS, saldosDelLibro } from "../lib/calidad/movimientos.ts";
import {
  movimientoDesdeElRenglon,
  type CatalogoDeLaPlanilla,
  type ConteoImportado,
  type MovimientoImportado,
} from "../lib/calidad/importar.ts";
import { traerCarbonilleros } from "../lib/calidad/consultas.ts";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const SECAR = process.argv.includes("--secar");
const LIBRO =
  process.env.GOOGLE_SHEETS_STOCK_CARBONILLA_ID ?? "1m9DwAcPZ5OpEv5edk97ZtmeHNcOG2d4riVDk_XM4EKI";
const PESTANA = "Entradas  Salidas";

const sb = createAdminClient();

/* ── 1. El catálogo: código de planilla → carbonillero del SdG ───────────── */

const carbonilleros = await traerCarbonilleros(sb);
if (carbonilleros.length === 0) {
  console.error("No hay carbonilleros declarados. Cargalos antes de importar.");
  process.exit(1);
}

const catalogo: CatalogoDeLaPlanilla = new Map(
  carbonilleros.map((c) => [c.codigo_planilla, { id: c.id, carbon: c.carbon }])
);

/*
 * Códigos viejos de la planilla que son el mismo carbonillero que otro.
 *
 * `00014 RODRIGUES` y `00011 EL TIGRE SERGIO RODRIGUEZ` son la misma persona:
 * las dos filas del 00014 aparean exacto contra el partner 999 de Odoo
 * (02/10/2025 9,72 ↔ P01507 9,76 y 27/01/2026 16,96 ↔ P01888 16,96). El 00011
 * tiene 10 de los 12 renglones y es el que se usa desde junio, así que quedó
 * ése declarado. Sin este alias, esos dos camiones no entran.
 *
 * Va acá y no en el catálogo de la base a propósito: es una deuda de la
 * planilla vieja y muere con la importación.
 */
const ALIAS: Record<string, string> = { "00014": "00011" };
for (const [viejo, bueno] of Object.entries(ALIAS)) {
  const c = catalogo.get(bueno);
  if (c) catalogo.set(viejo, c);
  else console.log(`  OJO: el alias ${viejo} -> ${bueno} no sirve: ${bueno} no está declarado.`);
}

console.log(`Catálogo: ${catalogo.size} códigos (incluye ${Object.keys(ALIAS).length} alias).\n`);

/* ── 2. Leer la planilla ─────────────────────────────────────────────────── */

const filas = await leerValores(LIBRO, PESTANA, { sinFormato: true });
console.log(`Planilla: ${filas.length} filas leídas de "${PESTANA}".`);

const movimientos: MovimientoImportado[] = [];
const conteos: ConteoImportado[] = [];
const sinImportar: string[] = [];
let vacias = 0;

// La fila 1 es el encabezado; `sheets_fila` cuenta desde 1, como la ve una persona.
filas.slice(1).forEach((celdas, i) => {
  const r = movimientoDesdeElRenglon(celdas, i + 2, catalogo);
  if (r.clase === "vacia") {
    vacias++;
    return;
  }
  if (r.clase === "sin_importar") {
    sinImportar.push(r.motivo);
    return;
  }
  movimientos.push(r.movimiento);
  if (r.conteo) conteos.push(r.conteo);
});

const entradas = movimientos.filter((m) => m.tipo === "entrada");
const consumos = movimientos.filter((m) => m.tipo === "consumo");
const ajustes = movimientos.filter((m) => m.tipo === "ajuste");
const sinSeparar = movimientos.filter((m) => m.carbon === "sin_separar");

console.log(
  `  ${movimientos.length} movimientos: ${entradas.length} entradas, ${consumos.length} consumos, ${ajustes.length} ajustes`
);
console.log(`  ${sinSeparar.length} anteriores al ${CORTE_DE_LOS_TIPOS} (sin_separar)`);
console.log(`  ${conteos.length} conteos físicos`);
console.log(`  ${vacias} filas vacías`);
console.log(`  ${sinImportar.length} sin importar`);
for (const m of sinImportar) console.log(`      ${m}`);

/* ── 3. Los ajustes explicados en texto, que hay que mirar de a uno ──────── */
//
// El número que dice el texto puede no ser el de la columna. Pasó: el 02/05/2026
// la fila dice `SALIDAS 55` y el texto dice 232,5 t, porque ese ajuste no tenía
// dónde entrar y alguien pisó la celda del saldo a mano. No se parsea el número
// del texto —eso es adivinar—: se muestra y lo decide una persona.

if (ajustes.length) {
  console.log("\nAjustes que vienen de un texto en la columna del conteo:");
  for (const a of ajustes) {
    console.log(`  fila ${a.sheets_fila}  ${a.fecha}  ${a.toneladas} t  "${a.motivo}"`);
  }
  console.log(
    "  Si el número del texto no coincide con el de la columna, ese ajuste entra por la columna."
  );
}

/* ── 4. El saldo inicial, de la fila que lo trae ─────────────────────────── */
//
// NO VA CABLEADO: sale de la primera fila que tiene las dos columnas con
// número, y se imprime para poder verificarlo antes de escribir nada.

const iPrimera = filas.findIndex((f) => typeof f[5] === "number" && typeof f[6] === "number");
if (iPrimera < 0) {
  console.error("\nNo se encontró la primera fila con saldo por tipo. No importo.");
  process.exit(1);
}
const primeraConTipos = filas[iPrimera];
const saldoInicial = {
  vegetal: Number(primeraConTipos[5]),
  residual: Number(primeraConTipos[6]),
};
const fechaDelSaldoInicial = fechaDeSheets(primeraConTipos[7]);
console.log(
  `\nSaldo inicial: fila ${iPrimera + 1}, ${fechaDelSaldoInicial} -> vegetal ${saldoInicial.vegetal} t, residual ${saldoInicial.residual} t`
);

// Esa fila y las anteriores tienen que haber quedado del lado viejo: el saldo
// inicial ya las contó, y contarlas otra vez mete el mismo camión dos veces.
if (!fechaDelSaldoInicial || fechaDelSaldoInicial >= CORTE_DE_LOS_TIPOS) {
  console.error(
    `  La fila del saldo inicial (${fechaDelSaldoInicial}) NO quedó antes del corte ${CORTE_DE_LOS_TIPOS}.\n` +
      "  Con eso el saldo sale duplicado. Ajustá CORTE_DE_LOS_TIPOS y su CHECK antes de seguir."
  );
  process.exit(1);
}

const ajustesIniciales: MovimientoImportado[] = (["vegetal", "residual"] as const)
  .filter((c) => saldoInicial[c] !== 0)
  .map((c) => ({
    fecha: fechaDelSaldoInicial,
    tipo: "ajuste" as const,
    carbon: c,
    toneladas: saldoInicial[c],
    motivo: `Saldo inicial según la planilla al ${fechaDelSaldoInicial} (fila ${iPrimera + 1})`,
    carbonillero_id: null,
    origen: "importacion" as const,
    sheets_fila: iPrimera + 1,
  }));

/* ── 5. El saldo que va a quedar, contra el que muestra la planilla ──────── */

const todos = [...movimientos, ...ajustesIniciales];
const saldos = saldosDelLibro(todos);
const ultimaConSaldo = [...filas].reverse().find((f) => typeof f[4] === "number");
console.log(
  `\nSaldo recalculado: vegetal ${saldos.vegetal}, residual ${saldos.residual}, total ${saldos.total}`
);
if (ultimaConSaldo) {
  const dePlanilla = Number(ultimaConSaldo[4]);
  const dif = saldos.total - dePlanilla;
  console.log(
    `Saldo que muestra la planilla: ${dePlanilla.toFixed(3)}  ->  diferencia ${dif.toFixed(3)} t`
  );
  if (Math.abs(dif) > 1) {
    console.log(
      "  UNA DIFERENCIA GRANDE NO ES NORMAL. Mirá los ajustes de arriba: la planilla\n" +
        "  tiene al menos una celda de saldo pisada a mano (02/05/2026, +232,5 t), y ese\n" +
        "  número no está en ninguna columna. Decidilo antes de escribir."
    );
  }
}

/* ── 6. La conciliación contra Odoo: verificación, sin enlazar nada ──────── */

const porCarbonillero = new Map(carbonilleros.map((c) => [c.id, c]));
const lineas = await buscarLeer<{
  order_id: [number, string];
  partner_id: [number, string];
  product_qty: number;
}>(
  "purchase.order.line",
  [
    ["order_id.state", "=", "purchase"],
    ["order_id.date_order", ">=", "2025-08-01"],
  ],
  ["order_id", "partner_id", "product_qty"],
  { limite: 3000 }
);
const ordenes = await buscarLeer<{ id: number; date_order: string }>(
  "purchase.order",
  [["id", "in", [...new Set(lineas.map((l) => l.order_id[0]))]]],
  ["id", "date_order"],
  { limite: 3000 }
);
const fechaDeOrden = new Map(ordenes.map((o) => [o.id, String(o.date_order).slice(0, 10)]));
const deOdoo = lineas.map((l) => ({
  fecha: fechaDeOrden.get(l.order_id[0]) ?? "",
  partner: l.partner_id[0],
  ton: l.product_qty,
  usada: false,
}));

let iguales = 0;
let distintos = 0;
let sinOrden = 0;
for (const e of entradas) {
  const c = e.carbonillero_id ? porCarbonillero.get(e.carbonillero_id) : undefined;
  if (!c) {
    sinOrden++;
    continue;
  }
  const cand = deOdoo
    .filter(
      (o) =>
        !o.usada &&
        o.partner === c.odoo_partner_id &&
        Math.abs(Date.parse(o.fecha) - Date.parse(e.fecha)) <= 2 * 86400000
    )
    .sort((a, b) => Math.abs(a.ton - e.toneladas) - Math.abs(b.ton - e.toneladas));
  if (!cand.length) {
    sinOrden++;
    continue;
  }
  cand[0].usada = true;
  if (Math.abs(cand[0].ton - e.toneladas) < 0.005) iguales++;
  else distintos++;
}
console.log(
  `\nConciliación contra Odoo (verificación, no enlaza nada):\n` +
    `  ${iguales} coinciden exacto · ${distintos} difieren · ${sinOrden} sin orden  (de ${entradas.length} entradas)`
);
console.log(
  "  Medido el 15/09/2026: 515 / 60 / 37. Si tu corrida da muy distinto, mirá por qué antes de seguir."
);

/* ── 7. Escribir ─────────────────────────────────────────────────────────── */

if (SECAR) {
  console.log("\n--secar: no se escribió nada.");
  process.exit(0);
}

const { count: yaHay } = await sb
  .from("calidad_movimientos")
  .select("*", { count: "exact", head: true });
if (yaHay && yaHay > 0) {
  console.error(`\nEl libro ya tiene ${yaHay} movimientos. Esto corre una sola vez: no importo.`);
  process.exit(1);
}

const LOTE = 500;
for (let i = 0; i < todos.length; i += LOTE) {
  const { error } = await sb.from("calidad_movimientos").insert(todos.slice(i, i + LOTE));
  if (error) {
    console.error("ERROR escribiendo movimientos:", error.message);
    process.exit(1);
  }
  console.log(`  escritos ${Math.min(i + LOTE, todos.length)}/${todos.length}`);
}
if (conteos.length) {
  const { error } = await sb.from("calidad_conteos").insert(conteos);
  if (error) console.error("ERROR escribiendo conteos:", error.message);
  else console.log(`  ${conteos.length} conteos escritos`);
}

console.log(
  `\nListo. Ahora poné CALIDAD_DESDE=${new Date().toISOString().slice(0, 10)} en Vercel y en .env.local:\n` +
    "el cron no tiene que volver a mirar nada de lo que acaba de entrar."
);
