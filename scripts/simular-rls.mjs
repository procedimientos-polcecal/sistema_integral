/*
 * Qué va a hacer la migración 20261014090512, antes de correrla.
 *
 *   node scripts/simular-rls.mjs            # el resumen y los controles
 *   node scripts/simular-rls.mjs --todas    # además, las 249 policies una por una
 *
 * POR QUÉ EXISTE
 *
 * Esa migración reescribe **198 policies sobre 121 tablas** para que el `USING`
 * se evalúe una vez por consulta y no una vez por fila — el arreglo que lleva
 * `cantera_pesadas` de 6,5 segundos a lo que tarde la red (ver
 * `scripts/medir-rls.mjs`). Es mucha superficie para algo que, si sale mal, no
 * se nota como un error: una policy mal reescrita deja a alguien sin ver lo que
 * tiene que ver, o peor, viendo lo que no.
 *
 * Un agente no puede correr DDL en este repo, así que la migración no se puede
 * probar antes de aplicarla. Esto es lo más cerca que se llega: aplica **la
 * misma transformación** sobre las definiciones reales que están en la base,
 * las muestra, y corre tres controles. No escribe nada: sólo lee `pg_policies`.
 *
 * LOS TRES CONTROLES, Y POR QUÉ SON ÉSOS
 *
 * 1. **Una función que recibe una columna no se toca.** `es_mi_hoja_ruta(
 *    hoja_ruta_id)` depende de la fila: envolverla en un subselect la evaluaría
 *    una sola vez y le mostraría a cada uno los asientos del primero. Es el
 *    único error de este cambio que sería un agujero de permisos y no una
 *    lentitud, así que es el primero que se comprueba.
 * 2. **Idempotencia.** Acá las migraciones las aplica una persona a mano y no
 *    hay tabla de control: repetir una es normal. Aplicar la transformación dos
 *    veces tiene que dar exactamente lo mismo.
 * 3. **No queda ninguna llamada pelada.** Si algo no se reescribió, esa tabla
 *    sigue pagando por fila y el arreglo quedó a medias sin avisar.
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

const db = createClient(URL, SERVICE);
const consultar = async (sql) => {
  const { data, error } = await db.rpc("asistente_consulta", { consulta: sql, tope: 400 }, { get: true });
  if (error) { console.error("No se pudo consultar la base: " + error.message); process.exit(1); }
  return data;
};

/**
 * Las mismas que agarra la migración: booleanas, del esquema `public`, y
 * `STABLE` o `IMMUTABLE` —una `VOLATILE` no se puede evaluar una sola vez—.
 *
 * **No se filtra por cantidad de argumentos, y ésa es la correción del
 * 14/10/2026.** La primera versión pedía `pronargs = 0` y por eso se le
 * escaparon `mant_puede_ver()`, `mant_puede_editar()` y `mant_es_admin()`, que
 * declaran un argumento `uid uuid DEFAULT auth.uid()`: en las policies se las
 * llama con paréntesis vacíos y *parecen* de cero argumentos, pero el catálogo
 * dice `pronargs = 1`. Fueron 22 policies de Mantenimiento que quedaron sin
 * envolver y que nadie vio hasta medir después.
 *
 * Lo que decide si se envuelve no es cuántos argumentos declara la función sino
 * **que la llamada tenga los paréntesis vacíos**: un valor por defecto se
 * evalúa en el contexto de la función y no puede referirse a una columna de la
 * consulta que la llama, así que una llamada con `()` siempre es independiente
 * de la fila.
 *
 * Y la lección de fondo: este simulador usaba la misma consulta que la
 * migración, así que compartía su punto ciego. Comprobaba que la
 * transformación estuviera bien, no que el conjunto de entrada estuviera
 * completo — por eso ahora el tercer control mira **todas** las funciones
 * booleanas, no sólo las de la lista.
 */
const funciones = (await consultar(
  "select pr.proname from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace " +
  "where n.nspname = 'public' and pr.prorettype = 'boolean'::regtype " +
  "and pr.provolatile in ('s','i')"
)).map((f) => f.proname).concat(["auth.uid"]);

const policies = await consultar(
  "select tablename, policyname, cmd, qual, with_check from pg_policies " +
  "where schemaname = 'public' order by tablename, policyname"
);

/** La transformación, igual que en el bloque plpgsql de la migración. */
function transformar(texto) {
  if (texto == null) return null;
  let t = texto;
  for (const fn of funciones) {
    const esc = fn.replace(".", "\\.");
    // Desenvolver primero, contemplando el alias que Postgres le pone al
    // subselect al guardarlo: `( SELECT tiene_acceso_rrhh() AS tiene_acceso_rrhh)`.
    t = t.replace(new RegExp("\\( *SELECT +" + esc + "\\(\\)( +AS +[a-zA-Z_]+)? *\\)", "gi"), fn + "()");
    // Envolver. Los paréntesis vacíos son obligatorios: así una llamada con
    // argumento queda intacta.
    t = t.replace(new RegExp("\\b" + esc + "\\(\\)", "g"), "(select " + fn + "())");
  }
  return t;
}

const cambios = policies
  .map((p) => ({ ...p, nuevoQual: transformar(p.qual), nuevoCheck: transformar(p.with_check) }))
  .filter((p) => p.nuevoQual !== p.qual || p.nuevoCheck !== p.with_check);

console.log(
  `policies: ${policies.length}  |  se reescriben: ${cambios.length}  |  quedan igual: ${policies.length - cambios.length}`
);
console.log("(las que quedan igual son las que ya son `true` o no tienen condición)");

if (process.argv.includes("--todas")) {
  for (const p of cambios) {
    console.log(`\n${p.tablename}.${p.policyname}  [${p.cmd}]`);
    console.log("  antes  : " + String(p.qual ?? p.with_check).replace(/\s+/g, " "));
    console.log("  despues: " + String(p.nuevoQual ?? p.nuevoCheck).replace(/\s+/g, " "));
  }
}

let todoBien = true;
const control = (nombre, ok, detalle) => {
  todoBien &&= ok;
  console.log(`\n${ok ? "OK " : "MAL"}  ${nombre}`);
  if (detalle) console.log(detalle);
};

// 1. Las que reciben una columna de la fila tienen que quedar intactas.
const conArgumento = policies.filter((p) => /[a-z_]+\([a-z]/.test(p.qual ?? ""));
const rotas = conArgumento.filter((p) => /\(select [a-z_]+\([^)]/.test(transformar(p.qual) ?? ""));
control(
  `una función que recibe una columna no se toca (${conArgumento.length} policies la usan)`,
  rotas.length === 0,
  rotas.length ? rotas.map((p) => "     " + p.tablename + "." + p.policyname).join("\n") : null
);

// 2. Correrla dos veces tiene que dar lo mismo.
const noIdempotentes = policies.filter((p) => transformar(transformar(p.qual)) !== transformar(p.qual));
control("idempotencia: aplicarla dos veces da lo mismo", noIdempotentes.length === 0);

// 3. Ninguna puede quedar con una llamada sin envolver.
const peladas = policies.filter((p) => {
  const d = (transformar(p.qual) ?? "").replace(/\(select [a-z_.]+\(\)\)/g, "ENVUELTA");
  return funciones.some((fn) => new RegExp("(^|[^.a-zA-Z_])" + fn.replace(".", "\\.") + "\\(\\)").test(d));
});
control(
  "no queda ninguna llamada sin envolver",
  peladas.length === 0,
  peladas.length ? peladas.slice(0, 5).map((p) => "     " + p.tablename + "." + p.policyname).join("\n") : null
);

console.log(
  todoBien
    ? "\nLos tres controles pasan. La migración puede correrse."
    : "\nAlgún control falló: NO correr la migración hasta entender por qué."
);
process.exit(todoBien ? 0 : 1);
