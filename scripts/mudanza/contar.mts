/**
 * Contar un proyecto entero y dejarlo en un JSON.
 *
 * Se corre dos veces: contra el proyecto viejo antes del dump —la línea de
 * base— y contra el nuevo después del restore. `verificar.mts` compara los dos
 * archivos y dice si se puede seguir.
 *
 *   npx tsx --env-file=.env.local scripts/mudanza/contar.mts antes.json
 *
 *   SUPABASE_URL=https://xxx.supabase.co SUPABASE_KEY=eyJ... \
 *     npx tsx scripts/mudanza/contar.mts despues.json
 *
 * Toma `SUPABASE_URL` y `SUPABASE_KEY` si están —que es como se apunta al
 * proyecto nuevo— y si no, las del `.env.local`, que son las del viejo.
 */
import { writeFileSync } from "node:fs";
import { contarTodo, contarUsuariosAuth, listarBuckets, listarObjetos } from "./supabase";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const salida = process.argv[2];

if (!url || !serviceKey) {
  console.error(
    "Faltan SUPABASE_URL y SUPABASE_KEY. Para el proyecto de hoy alcanza con\n" +
      "  npx tsx --env-file=.env.local scripts/mudanza/contar.mts <archivo.json>",
  );
  process.exit(1);
}
if (!salida) {
  console.error("Falta el archivo de salida: contar.mts <archivo.json>");
  process.exit(1);
}

const proyecto = { url, serviceKey };

console.log(`Contando ${url}\n`);

const tablas = await contarTodo(proyecto);
const sinPoderContar = tablas.filter((t) => t.filas === null);
const filas = tablas.reduce((total, t) => total + (t.filas ?? 0), 0);

const usuarios = await contarUsuariosAuth(proyecto);

const buckets = [];
for (const b of await listarBuckets(proyecto)) {
  const objetos = await listarObjetos(proyecto, b.id);
  buckets.push({
    id: b.id,
    public: b.public,
    file_size_limit: b.file_size_limit,
    allowed_mime_types: b.allowed_mime_types,
    objetos: objetos.length,
    bytes: objetos.reduce((total, o) => total + o.bytes, 0),
  });
}

writeFileSync(
  salida,
  JSON.stringify({ url, fecha: new Date().toISOString(), tablas, usuarios, buckets }, null, 2),
);

console.log(`  ${tablas.length} tablas, ${filas.toLocaleString("es-AR")} filas`);
console.log(`  ${usuarios} usuarios en auth`);
for (const b of buckets) {
  console.log(`  bucket ${b.id}: ${b.objetos} objetos, ${(b.bytes / 1024 / 1024).toFixed(1)} MB`);
}

// Un cero acá no es un dato tranquilizador: es que la Auth Admin API no
// contestó lo que se esperaba. Sin ese número la mudanza no se puede verificar,
// así que conviene que grite ahora y no en la ventana.
if (usuarios === 0) {
  console.log("\n  OJO: cero usuarios en auth. Eso no puede ser: revisá la service role key.");
}
if (sinPoderContar.length) {
  console.log(
    `\n  OJO: ${sinPoderContar.length} tabla(s) sin poder contar: ` +
      sinPoderContar.map((t) => t.tabla).join(", "),
  );
}

console.log(`\nEscrito en ${salida}`);
