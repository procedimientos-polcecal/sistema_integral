// Cuántos repuestos de las OT abiertas reconocen un artículo del pañol.
//
// POR QUE
//
// Antes de diseñar «elegir el artículo a mano» hay que saber si el cruce por
// texto falla seguido o poco: si falla poco, lo que falta es sólo que la
// pantalla ofrezca cambiar la descripción en vez de hacerlo callado; si falla
// seguido, el camino es poder elegirlo.
//
// **Sólo lee.** Usa `buscarEnInventario` de verdad, no una copia: medir con una
// reimplementación diría cómo anda la copia.
//
//   npx tsx scripts/medir-cruce-de-repuestos.mts
import { readFileSync } from "node:fs";

for (const linea of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = linea.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { createAdminClient } = await import("../lib/supabase/admin.ts");
const { traerTodo } = await import("../lib/core/paginado.ts");
const { buscarEnInventario } = await import("../lib/mantenimiento/stock.ts");
type Insumo = import("../lib/mantenimiento/stock.ts").Insumo;

const db = createAdminClient();

/** Abierta es cualquiera que no esté realizada: las tres que quedan. */
const ABIERTAS = ["ATRASADO", "EN_PROCESO", "POR_HACER"];
/** Las realizadas también cuentan para medir el cruce: con sólo las abiertas la
 *  muestra son 7 repuestos y cualquier porcentaje es ruido. */
const TODOS = [...ABIERTAS, "REALIZADO"];
const estados = process.argv.includes("--todas") ? TODOS : ABIERTAS;

interface FilaArticulo {
  codigo: string;
  descripcion: string;
  ubicacion: string | null;
  stock_actual: number;
  stock_planilla: number | null;
  stock_seguridad: number;
}

/*
 * Se leen **todos los repuestos** y después se mira de qué orden es cada uno,
 * y no al revés. Partir de las OT fue el primer intento y estuvo mal: son 2.453
 * y un `select` sin paginar devuelve 1.000 sin avisar, así que la medición
 * salía sobre un recorte que no se notaba —el número redondo fue lo único que
 * lo delató—. Al revés no hay tope posible: la tabla entera son 26 filas.
 */
type FilaRepuesto = {
  work_order_id: string;
  nombre: string | null;
  codigo: string | null;
  cantidad: string | null;
};
const repuestos = await traerTodo<FilaRepuesto>((desde, hasta) =>
  db
    .from("ordenes_trabajo_repuestos")
    .select("work_order_id, nombre, codigo, cantidad")
    .range(desde, hasta)
);

const deEsasOrdenes = [...new Set(repuestos.map((r) => r.work_order_id))];
const ordenes: { id: string; ot_number: number | null; estado: string }[] = [];
for (let i = 0; i < deEsasOrdenes.length; i += 200) {
  const { data } = await db
    .from("ordenes_trabajo")
    .select("id, ot_number, estado")
    .in("id", deEsasOrdenes.slice(i, i + 200));
  ordenes.push(...((data ?? []) as typeof ordenes));
}
/*
 * **`abiertas` son las abiertas de verdad, y no `estados`.** Calcularlo con la
 * lista de `--todas` hacia que el informe dijera "de ellas abiertas: 20"
 * contando las 16 realizadas: la etiqueta decia una cosa y la cuenta hacia
 * otra, que es la misma trampa que el `LETRA = "F"` de CLAUDE.md. El numero
 * salio en un diseno antes de que alguien lo mirara dos veces.
 */
const abiertas = ordenes.filter((o) => o.estado !== "REALIZADO");
const porId = new Map(ordenes.map((o) => [o.id, o]));

// El catálogo entero: son ~2.800 filas y PostgREST corta en 1.000 sin avisar.
const filas = await traerTodo<FilaArticulo>((desde, hasta) =>
  db
    .from("inventario_articulos")
    .select("codigo, descripcion, ubicacion, stock_actual, stock_planilla, stock_seguridad")
    .eq("activo", true)
    .range(desde, hasta)
);

const inventario: Insumo[] = filas.map((f) => ({
  codigo: f.codigo,
  descripcion: f.descripcion,
  stock: f.stock_planilla === null ? null : f.stock_actual,
  seguridad: f.stock_seguridad,
  ubicacion: f.ubicacion,
}));

const disponibilidad = buscarEnInventario(repuestos, inventario);

console.log(`Repuestos leidos: todos. OT que los tienen: ${ordenes.length}, de ellas abiertas: ${abiertas.length}`);
console.log(`Artículos activos en el pañol: ${inventario.length}`);
console.log(`Repuestos anotados en esas OT: ${repuestos.length}`);
console.log("");

const noEsta = disponibilidad.filter((d) => d.estado === "no_esta");
const reconocidos = disponibilidad.filter((d) => d.insumo !== null);
const pct = (n: number) => (repuestos.length ? ((n / repuestos.length) * 100).toFixed(1) : "0.0");

console.log(`RECONOCEN un artículo:  ${reconocidos.length} (${pct(reconocidos.length)} %)`);
console.log(`NO lo reconocen:        ${noEsta.length} (${pct(noEsta.length)} %)`);
console.log("");

// Con código escrito el cruce es exacto; sin código depende del nombre, que es
// donde se pierde. Separarlo dice cuál de los dos arreglar.
const conCodigo = disponibilidad.filter((d) => (d.codigo ?? "").trim() !== "");
const sinCodigo = disponibilidad.filter((d) => (d.codigo ?? "").trim() === "");
const fallanConCodigo = conCodigo.filter((d) => d.insumo === null);
const fallanSinCodigo = sinCodigo.filter((d) => d.insumo === null);
console.log(`Con código anotado: ${conCodigo.length}, de los que fallan ${fallanConCodigo.length}`);
console.log(`Sin código:         ${sinCodigo.length}, de los que fallan ${fallanSinCodigo.length}`);
console.log("");

console.log("LOS QUE NO RECONOCE (hasta 25):");
for (const d of noEsta.slice(0, 25)) {
  console.log(`  cod=${JSON.stringify(d.codigo)}  nombre=${JSON.stringify(d.nombre)}`);
}
console.log("");

/*
 * Para la otra mitad del diseño: si dos OT abiertas no piden nunca lo mismo, el
 * reparto por antigüedad no tiene a quién repartirle y es código que no corre.
 */
const porArticulo = new Map<string, Set<string>>();
disponibilidad.forEach((d, i) => {
  const clave = d.insumo?.codigo ?? `texto:${(d.nombre ?? "").trim().toUpperCase()}`;
  if (!clave || clave === "texto:") return;
  (porArticulo.get(clave) ?? porArticulo.set(clave, new Set()).get(clave)!).add(repuestos[i].work_order_id);
});
const compartidos = [...porArticulo.entries()].filter(([, ots]) => ots.size > 1);
console.log(`Artículos que piden DOS O MAS OT (de cualquier estado): ${compartidos.length}`);
for (const [clave, ots] of compartidos.slice(0, 10)) {
  const nombres = [...ots].map((id) => porId.get(id)?.ot_number ?? "?").join(", ");
  console.log(`  ${clave} → OT ${nombres}`);
}
