/*
 * ¿Todos los imports del árbol COMMITEADO resuelven dentro del árbol commiteado?
 *
 *   node scripts/revisar-arbol-commiteado.mjs [ref]     (por defecto, origin/main)
 *
 * Existe por una falla que costó cuatro deploys seguidos el 14/09/2026: un
 * archivo nuevo quedó *staged* y nunca se commiteó, mientras los archivos que lo
 * importaban sí viajaron. En Vercel eso es `Module not found` y el build muere.
 *
 * **Y `npm run build` local no lo atrapa**, que es lo que lo hace peligroso: en
 * el disco el archivo está, así que el build pasa acá y falla allá. Este script
 * mira el árbol de git —lo que Vercel va a construir— y no el disco.
 *
 * Es especialmente fácil de pisar en este repo por dos motivos que se suman:
 *
 * - **Suele haber otra sesión en el mismo árbol**, así que los commits se hacen
 *   con rutas explícitas y los push, a veces, armando el árbol con plumbing. Las
 *   dos cosas copian sólo lo que se nombra: lo que falta, falta en silencio.
 * - **`git push` confirma que la ref se movió, no que el árbol esté completo.**
 *
 * Chequea sólo imports relativos (`./`, `../`) y con alias (`@/`). Los paquetes
 * de `node_modules` no son asunto de esto.
 */

import { execFileSync } from "node:child_process";

const ref = process.argv[2] ?? "origin/main";

const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

let archivos;
try {
  archivos = git(["ls-tree", "-r", "--name-only", ref]).split("\n").filter(Boolean);
} catch {
  console.error(`No existe la referencia "${ref}". ¿Falta un git fetch?`);
  process.exit(2);
}

const existe = new Set(archivos);
const codigo = archivos.filter(
  (f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f) && !f.startsWith(".claude/")
);

/** Las mismas que resuelve el bundler, en el mismo orden. */
const EXTENSIONES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js"];

/**
 * `next-env.d.ts` importa un archivo que **genera el build**, así que no está en
 * el árbol y no tiene por qué estarlo.
 */
const ESPERADOS = new Set(["next-env.d.ts"]);

function resuelve(desde, especificador) {
  let base;

  if (especificador.startsWith("@/")) {
    base = especificador.slice(2);
  } else if (especificador.startsWith(".")) {
    const partes = desde.split("/").slice(0, -1);
    for (const parte of especificador.split("/")) {
      if (parte === ".") continue;
      else if (parte === "..") partes.pop();
      else partes.push(parte);
    }
    base = partes.join("/");
  } else {
    return true;
  }

  return EXTENSIONES.some((e) => existe.has(base + e));
}

const faltantes = [];

for (const archivo of codigo) {
  if (ESPERADOS.has(archivo)) continue;

  const contenido = git(["show", `${ref}:${archivo}`]);
  const especificadores = [
    ...contenido.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g),
  ].map((m) => m[1]);

  for (const especificador of new Set(especificadores)) {
    if (!resuelve(archivo, especificador)) faltantes.push({ archivo, especificador });
  }
}

console.log(`${codigo.length} archivos de código revisados en ${ref}`);

if (faltantes.length === 0) {
  console.log("Todos los imports resuelven dentro del árbol commiteado.");
} else {
  console.log(`\nNO RESUELVEN (${faltantes.length}) — el build de Vercel va a fallar:\n`);
  for (const f of faltantes) console.log(`  ${f.archivo}\n      → ${f.especificador}`);
  console.log(
    "\nLo más probable: el archivo existe en el disco pero quedó sin commitear.\n" +
      "Mirá `git status` y agregalo por nombre."
  );
  process.exit(1);
}
