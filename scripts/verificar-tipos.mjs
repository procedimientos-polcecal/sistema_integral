/*
 * `tsc --noEmit`, con el heap que hoy hace falta.
 *
 *   npm run tipos
 *
 * POR QUÉ EXISTE
 *
 * El árbol cruzó el límite de memoria por omisión de Node y el chequeo de
 * tipos empezó a morir con `FATAL ERROR: Ineffective mark-compacts near heap
 * limit`. Lo que lo vuelve caro no es el fallo sino cómo se ve: el stack es de
 * V8, así que parece un bug de TypeScript o un error de tipos, y no es ninguno
 * de los dos. Medido el 17/11/2026: a la mañana `npx tsc --noEmit` todavía
 * pasaba con el heap por omisión y `next build` ya no; cinco horas y 21
 * commits después, `tsc` tampoco. O sea que esto empeora con cada semana de
 * trabajo, y el día que 8192 no alcance va a volver a parecer otra cosa.
 *
 * `npx tsc --noEmit` era el segundo comando de «Cómo se verifica» de
 * CLAUDE.md, así que cualquiera que lo corriera tal cual lo veía morir sin
 * saber por qué. Esto es ese comando, andando.
 *
 * POR QUÉ UN SCRIPT Y NO UN `NODE_OPTIONS` EN package.json
 *
 * Un `NODE_OPTIONS=… tsc` adentro de un script de npm no corre en Windows
 * —cmd no tiene prefijo de variable de entorno— y acá se trabaja desde
 * Windows. `cross-env` lo resolvería a cambio de una dependencia nueva para
 * una línea. Un `.npmrc` con `node-options` sí es multiplataforma, pero se lo
 * come **todo** script de npm, `build` incluido, y ése es el que corre Vercel:
 * ver abajo.
 *
 * POR QUÉ `build` NO ESTÁ ACÁ
 *
 * `npm run build` es el comando que corre Vercel para desplegar, y hoy allá
 * anda. Subirle el techo de heap desde el repo cambiaría el camino de
 * producción para arreglar una molestia local: con el techo más alto V8 tarda
 * más en recolectar, y en un contenedor de 8 GB eso cambia un aborto de V8
 * —que hoy no pasa— por un OOM del contenedor, que mata el deploy entero. No
 * se puede medir cuánto heap tiene hoy ese contenedor desde acá, y un cambio
 * sin medir en el camino de producción es justo lo que este repo no hace.
 *
 * Así que el build local lleva el prefijo a mano y está escrito en CLAUDE.md:
 *
 *   NODE_OPTIONS=--max-old-space-size=8192 npm run build
 *
 * Y en el CI va como `env:` del paso, que no es Vercel.
 *
 * SI UN DÍA 8192 NO ALCANZA
 *
 * Subir el número acá es media solución: el síntoma vuelve a ser el mismo
 * stack de V8 en el build, que este script no cubre. La otra mitad es mirar
 * por qué el árbol crece tanto —`tsc --noEmit --extendedDiagnostics` dice
 * cuántos archivos y cuánta memoria— antes de volver a subirlo.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// `createRequire` y no una ruta relativa: en un worktree de Claude Code
// `node_modules` está vacío y las dependencias se resuelven subiendo al
// checkout principal, así que `./node_modules/typescript/…` no existe ahí.
//
// Y se resuelve `typescript/package.json` y no `typescript/bin/tsc`: el campo
// `exports` de TypeScript 5 no publica el subpath del binario, así que pedirlo
// derecho falla con `ERR_PACKAGE_PATH_NOT_EXPORTED` aunque el archivo esté.
let tsc;
try {
  const paquete = createRequire(import.meta.url).resolve("typescript/package.json");
  tsc = join(dirname(paquete), "bin", "tsc");
} catch {
  console.error("No se encontró TypeScript. ¿Falta `npm install`?");
  process.exit(1);
}

const hijo = spawn(
  process.execPath,
  ["--max-old-space-size=8192", tsc, "--noEmit", ...process.argv.slice(2)],
  { stdio: "inherit" }
);

hijo.on("exit", (codigo, senal) => {
  // Una señal no es un código de salida: sin esto, un proceso muerto por el
  // sistema operativo saldría con 0 y el chequeo pasaría por bueno.
  process.exit(senal ? 1 : (codigo ?? 1));
});
