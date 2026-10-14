/*
 * ¿Cuánto cuesta RLS hoy?
 *
 *   node scripts/medir-rls.mjs
 *
 * Corre la misma consulta dos veces sobre cada tabla grande: con la sesión de
 * un usuario real (RLS aplicada) y con la service role (RLS salteada). La
 * diferencia entre las dos es lo que paga cada pantalla del sistema.
 *
 * POR QUÉ EXISTE
 *
 * El 14/10/2026 se midió que pedir 50 filas costaba como leer la tabla entera:
 * `cantera_pesadas` tardaba 6,5 segundos contra 231 ms sin RLS, y
 * `calculos_diarios` directamente daba timeout. La causa es que Postgres evalúa
 * el `USING` de una policy una vez **por fila**, y cada tabla tiene dos policies
 * que cubren SELECT. El arreglo —envolver la llamada en `(select ...)` para que
 * se evalúe una sola vez— está en la migración `20261014090512`.
 *
 * Este script es cómo se comprueba que sirvió: correrlo antes y después. Lo que
 * tiene que pasar es que la columna "con RLS" se acerque a la de "sin RLS".
 *
 * QUÉ NECESITA
 *
 * `.env.local` con `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
 * `SUPABASE_SERVICE_ROLE_KEY` y el usuario de prueba `ASISTENTE_TEST_EMAIL` /
 * `ASISTENTE_TEST_PASSWORD` — los mismos que ya usa `lib/asistente/consulta.test.ts`.
 *
 * **Sólo lee.** No escribe una fila ni toca una policy.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const linea of readFileSync(".env.local", "utf8").split("\n")) {
  const m = linea.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { NEXT_PUBLIC_SUPABASE_URL: URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
        SUPABASE_SERVICE_ROLE_KEY: SERVICE,
        ASISTENTE_TEST_EMAIL: EMAIL, ASISTENTE_TEST_PASSWORD: PASS } = process.env;

const faltan = Object.entries({ URL, ANON, SERVICE, EMAIL, PASS })
  .filter(([, v]) => !v).map(([k]) => k);
if (faltan.length) {
  console.error(`Falta en .env.local: ${faltan.join(", ")}`);
  process.exit(1);
}

/** Las tablas que más filas tienen, que son las que más pagan. */
const TABLAS = [
  "cantera_pesadas",
  "fichadas",
  "calculos_diarios",
  "inventario_movimientos",
  "taller_vial_estados_diarios",
  "despacho_ordenes_carga",
  "calidad_envases_movimientos",
  "inventario_articulos",
  // El control: su policy de SELECT es `true`, así que no paga nada y su número
  // no tiene que cambiar. Si cambia, lo que se midió fue otra cosa.
  "compras_requerimientos",
];

const VECES = 3;

/** La mediana de tres corridas: una sola medición en red no dice nada. */
async function medir(cliente, tabla) {
  const tiempos = [];
  for (let i = 0; i < VECES; i++) {
    const arranque = Date.now();
    const { error } = await cliente.from(tabla).select("id").range(0, 49);
    if (error) return error.message.includes("timeout") ? "timeout" : `error`;
    tiempos.push(Date.now() - arranque);
  }
  tiempos.sort((a, b) => a - b);
  return tiempos[Math.floor(VECES / 2)];
}

const sesion = createClient(URL, ANON);
const { error } = await sesion.auth.signInWithPassword({ email: EMAIL, password: PASS });
if (error) {
  console.error(`No se pudo entrar con el usuario de prueba: ${error.message}`);
  process.exit(1);
}
const servicio = createClient(URL, SERVICE);

console.log(`50 filas de cada tabla, mediana de ${VECES} corridas, en milisegundos.\n`);
console.log("tabla                            con RLS   sin RLS   factor");

for (const tabla of TABLAS) {
  const conRls = await medir(sesion, tabla);
  const sinRls = await medir(servicio, tabla);
  const factor =
    typeof conRls === "number" && typeof sinRls === "number" && sinRls > 0
      ? `x${(conRls / sinRls).toFixed(1)}`
      : "";
  console.log(
    tabla.padEnd(30) + String(conRls).padStart(9) + String(sinRls).padStart(10) + factor.padStart(9)
  );
}

console.log(
  "\nEl factor tiene que ser cercano a 1. Un x8 o un x28 quiere decir que la\n" +
  "policy se está evaluando por fila: ver la migración 20261014090512."
);
