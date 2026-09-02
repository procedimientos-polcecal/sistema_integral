#!/usr/bin/env node
/**
 * Crea una migración con marca de tiempo.
 *
 *   npm run migracion "inventario sheets fila unica"
 *
 * Existe porque catorce dígitos escritos a mano se erran, y uno de menos rompe
 * el orden en que se corren. Y porque el contador viejo —001, 002…— chocaba
 * cuando dos sesiones tomaban el mismo próximo número libre: pasó tres veces el
 * mismo día. Ver `supabase/migrations/README.md`.
 *
 * La marca es hora local y no UTC: quien la lee quiere saber cuándo la
 * escribió, no en qué meridiano.
 */

import fs from "node:fs";
import path from "node:path";

const CARPETA = path.join("supabase", "migrations");

const descripcion = process.argv.slice(2).join(" ").trim();
if (!descripcion) {
  console.error('Falta la descripción.\n\n  npm run migracion "compras costo en dolares"\n');
  process.exit(1);
}

/** Un nombre de archivo a partir de lo que se tipeó. */
function slug(texto) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // sin acentos: el ñ y el á rompen en Windows
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const ahora = new Date();
const dos = (n) => String(n).padStart(2, "0");
const marca =
  `${ahora.getFullYear()}${dos(ahora.getMonth() + 1)}${dos(ahora.getDate())}` +
  `${dos(ahora.getHours())}${dos(ahora.getMinutes())}${dos(ahora.getSeconds())}`;

const nombre = `${marca}_${slug(descripcion)}.sql`;
const destino = path.join(CARPETA, nombre);

if (!fs.existsSync(CARPETA)) {
  console.error(`No existe ${CARPETA}. ¿Estás en la raíz del repo?`);
  process.exit(1);
}
if (fs.existsSync(destino)) {
  console.error(`Ya existe ${destino}. Esperá un segundo y probá de nuevo.`);
  process.exit(1);
}

const titulo = descripcion.charAt(0).toUpperCase() + descripcion.slice(1);

// El encabezado pide el "por qué" porque es lo que no se deduce del SQL, y es
// lo que hace que estas migraciones sirvan de memoria seis meses después.
fs.writeFileSync(
  destino,
  `-- ============================================================
-- SdG — ${titulo}
--
-- (Por qué hace falta esto: qué problema resuelve, qué se probó antes, y qué
-- decisión queda tomada. El SQL dice el qué; esto tiene que decir el por qué.)
-- ============================================================


`,
  "utf8"
);

console.log(destino);
console.log("\nAntes de escribirla, mirá las cuatro trampas de");
console.log("supabase/migrations/README.md — dos de ellas ya pasaron dos veces.");
