/*
 * ¿Qué se lleva puesto borrar una fila de esta tabla?
 *
 *   node scripts/que-cuelga-de.mjs ordenes_trabajo
 *   node scripts/que-cuelga-de.mjs equipos
 *
 * Lista todo lo que apunta a esa tabla por clave foránea y, de cada cosa, qué
 * le pasa cuando la fila de arriba se borra: se borra en cascada, queda con el
 * enlace en null, o **hace fallar el borrado**.
 *
 * POR QUÉ EXISTE
 *
 * Desde el 18/10/2026 las sincronizaciones borran lo que la planilla dejó de
 * tener, así que "qué cuelga de esto" dejó de ser una curiosidad. Y la
 * respuesta no está en el repo: varias tablas de Mantenimiento las creó un
 * delta aplicado a mano, así que sus `on delete` no figuran en ninguna
 * migración de `supabase/migrations/`. Mirar el código y suponer da mal — en
 * este mismo repo se dio por sentado que `avisos.work_order_id` no declaraba
 * `on delete` y estaba en `set null` desde siempre.
 *
 * **Sólo lee.** Usa `asistente_consulta`, la misma función que ya usan
 * `medir-rls.mjs` y `simular-rls.mjs`.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const linea of readFileSync(".env.local", "utf8").split("\n")) {
  const m = linea.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { NEXT_PUBLIC_SUPABASE_URL: URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE } = process.env;
if (!URL || !SERVICE) {
  console.error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const tabla = process.argv[2];
if (!tabla) {
  console.error("Uso: node scripts/que-cuelga-de.mjs <tabla>");
  process.exit(1);
}

const db = createClient(URL, SERVICE);
const consultar = async (sql) => {
  const { data, error } = await db.rpc("asistente_consulta", { consulta: sql, tope: 400 }, { get: true });
  if (error) {
    console.error("No se pudo consultar la base: " + error.message);
    process.exit(1);
  }
  return data;
};

// `confdeltype` es la letra que Postgres guarda por cada clave foránea. Se
// traduce acá y no se muestra cruda: "a" no le dice nada a nadie, y lo que
// importa —que `a` significa que el borrado falla— es justamente lo que esa
// letra esconde.
const filas = await consultar(`
  select
    src.relname as tabla,
    att.attname as columna,
    case con.confdeltype
      when 'a' then 'HACE FALLAR el borrado'
      when 'r' then 'HACE FALLAR el borrado (restrict)'
      when 'c' then 'se borra en cascada'
      when 'n' then 'queda, con el enlace en null'
      when 'd' then 'queda, con el enlace en su valor por defecto'
    end as al_borrar,
    con.conname as restriccion
  from pg_constraint con
  join pg_class src on src.oid = con.conrelid
  join pg_class dst on dst.oid = con.confrelid
  join unnest(con.conkey) as k(attnum) on true
  join pg_attribute att on att.attrelid = src.oid and att.attnum = k.attnum
  where con.contype = 'f' and dst.relname = '${tabla.replace(/'/g, "''")}'
  order by src.relname
`);

if (filas.length === 0) {
  console.log(`Nada apunta a "${tabla}" por clave foránea (o la tabla no existe).`);
  process.exit(0);
}

console.log(`\nAl borrar una fila de "${tabla}":\n`);
for (const f of filas) {
  console.log(`  ${f.tabla}.${f.columna}`);
  console.log(`      ${f.al_borrar}`);
}

// Cuántas filas hay enlazadas hoy: un `hace fallar` sobre una tabla vacía no
// muerde todavía, y ésa es la diferencia entre un problema y un problema que
// ya está pasando.
console.log("\nFilas enlazadas hoy:\n");
for (const f of filas) {
  const [{ cuantas } = {}] = await consultar(
    `select count(*)::int as cuantas from ${f.tabla} where ${f.columna} is not null`
  );
  const aviso = cuantas > 0 && f.al_borrar.startsWith("HACE FALLAR") ? "  ← esto ya muerde" : "";
  console.log(`  ${f.tabla}.${f.columna}: ${cuantas}${aviso}`);
}
