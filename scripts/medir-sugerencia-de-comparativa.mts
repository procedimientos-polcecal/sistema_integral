// Cuánto acierta el sugeridor de comparativas, contra los enlaces reales. SÓLO LEE.
//
// POR QUÉ EXISTE
//
// Porque una sugerencia que se equivoca seguido es peor que no sugerir nada:
// enlazar la planilla equivocada importa a este pedido los presupuestos de
// otro, y no se nota hasta que alguien mira la comparativa y no reconoce
// ninguna fila. Antes de mostrarla hay que saber cuánto acierta, y eso no es
// una opinión: hay 1.717 pedidos ya enlazados a mano, que son 1.717 respuestas
// correctas.
//
// CÓMO MIDE, Y POR QUÉ ASÍ
//
// Simula **hacia adelante**: recorre los enlaces en orden de número de RI y
// adivina cada uno usando sólo los que lo precedieron, como le va a pasar en
// producción. Medir con todo el historial delante —incluido el futuro— da un
// número mucho mejor y completamente falso, porque el pedido que se está
// adivinando ya está adentro de lo que se usa para adivinarlo.
//
// La carpeta de Drive se reemplaza por los archivos que el historial conoce.
// Es una aproximación y hay que saber en qué dirección falla: la carpeta real
// tiene más archivos, así que hay más candidatos equivocados y el número de
// acá es **optimista** para la señal del nombre.
//
// Uso:
//   npx tsx scripts/medir-sugerencia-de-comparativa.mts
//
// Necesita las claves de Supabase en `.env.local`. No escribe nada.
import { readFileSync, existsSync } from "node:fs";

const env = new URL("../.env.local", import.meta.url);
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { createAdminClient } = await import("../lib/supabase/admin.ts");
const { sugerirComparativa } = await import("../lib/compras/sugerirComparativa.ts");
type EnlacePasado = Parameters<typeof sugerirComparativa>[2][number];

const db = createAdminClient();
const titulo = (t: string) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 64 - t.length))}`);

type Ri = {
  nro_ri: number | null;
  descripcion: string | null;
  clave_articulo: string | null;
  comparativa_drive_id: string | null;
  comparativa_nombre: string | null;
};

const filas: Ri[] = [];
for (let desde = 0; ; desde += 1000) {
  const { data, error } = await db
    .from("compras_requerimientos")
    .select("nro_ri, descripcion, clave_articulo, comparativa_drive_id, comparativa_nombre")
    .range(desde, desde + 999);
  if (error) {
    console.error("No se pudo leer:", error.message);
    process.exit(1);
  }
  filas.push(...(data as Ri[]));
  if (data.length < 1000) break;
}

const enlaces = filas
  .filter((r) => r.comparativa_drive_id && r.comparativa_nombre && r.nro_ri !== null)
  .sort((a, b) => (a.nro_ri ?? 0) - (b.nro_ri ?? 0));

titulo("de qué se aprende");
console.log(`  ${enlaces.length} pedidos con su comparativa ya elegida a mano`);
console.log(`  ${new Set(enlaces.map((r) => r.comparativa_drive_id)).size} planillas distintas`);

/** Hasta dónde se deja que el historial se llene antes de empezar a medir. */
const ARRANQUE = 50;

const pasados: EnlacePasado[] = [];
const carpeta = new Map<string, string>();

let total = 0;
let top1 = 0;
let top3 = 0;
let sinSugerencia = 0;
let conFuerte = 0;
let fuerteAcierta = 0;
let estrenos = 0;
let estrenosTop1 = 0;

for (const [i, r] of enlaces.entries()) {
  const esEstreno = !carpeta.has(r.comparativa_drive_id!);

  if (i >= ARRANQUE) {
    // La carpeta incluye al archivo correcto aunque nunca se haya usado: en
    // producción está en Drive desde antes de que alguien lo elija, y dejarlo
    // afuera haría imposible por construcción justo el 12,1% de los casos que
    // el historial no puede contestar.
    const comoCarpeta = [...carpeta.entries()].map(([id, nombre]) => ({ id, nombre }));
    if (esEstreno) comoCarpeta.push({ id: r.comparativa_drive_id!, nombre: r.comparativa_nombre! });

    const sugerencias = sugerirComparativa(
      { descripcion: r.descripcion, claveArticulo: r.clave_articulo },
      comoCarpeta,
      pasados
    );

    total++;
    if (sugerencias.length === 0) sinSugerencia++;
    if (sugerencias[0]?.driveId === r.comparativa_drive_id) top1++;
    if (sugerencias.some((s) => s.driveId === r.comparativa_drive_id)) top3++;

    if (sugerencias[0]?.fuerte) {
      conFuerte++;
      if (sugerencias[0].driveId === r.comparativa_drive_id) fuerteAcierta++;
    }

    if (esEstreno) {
      estrenos++;
      if (sugerencias[0]?.driveId === r.comparativa_drive_id) estrenosTop1++;
    }
  }

  carpeta.set(r.comparativa_drive_id!, r.comparativa_nombre!);
  pasados.push({
    driveId: r.comparativa_drive_id!,
    nombre: r.comparativa_nombre,
    claveArticulo: r.clave_articulo,
    descripcion: r.descripcion,
  });
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");

titulo("cuánto acierta, adivinando cada pedido con sólo lo anterior");
console.log(`  sobre ${total} pedidos`);
console.log(`  la primera sugerencia es la correcta: ${pct(top1, total)}`);
console.log(`  está entre las tres:                  ${pct(top3, total)}`);
console.log(`  no sugiere nada:                      ${pct(sinSugerencia, total)}`);

titulo("la señal fuerte, que es la que la pantalla destaca");
console.log(`  contesta en ${conFuerte} de ${total} (${pct(conFuerte, total)})`);
console.log(`  y cuando contesta acierta: ${pct(fuerteAcierta, conFuerte)}`);

titulo("el techo: cuando la planilla se estrena");
console.log(`  ${estrenos} de ${total} pedidos estrenan una planilla (${pct(estrenos, total)})`);
console.log(`  ahí no hay historial y sólo puede el nombre: acierta ${pct(estrenosTop1, estrenos)}`);
