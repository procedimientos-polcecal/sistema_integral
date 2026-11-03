// Las OT cuya celda de ESTADO quedó en blanco, y ponerles la fórmula.
//
// POR QUÉ EXISTE
//
// Hasta el 29/10/2026 el sistema no escribía nada en la `M` cuando la orden
// estaba «por hacer», creyendo que esa columna traía `=IF(J="","",L)`. No la
// trae: de sus 2.299 celdas, 2.291 son literales y sólo cinco sueltas llevan
// esa fórmula. Así que no escribir no dejaba la celda calculándose, la dejaba
// **en blanco** — ocho órdenes sin estado en la planilla, dos de ellas ya
// atrasadas, y creciendo.
//
// El código ya no las produce (ver `celdaDeEstado`), pero las que quedaron no
// se arreglan solas: nadie las vuelve a tocar hasta que alguien registre el
// trabajo. Esto es esa pasada.
//
// QUÉ ESCRIBE, Y POR QUÉ ASÍ
//
// `=IF(Jn="","",Ln)` en la `M` de cada fila en blanco, con `n` su propia fila.
// La misma fórmula que ya tienen M1266, M1269, M1368, M1682 y M1770, puestas a
// mano por alguien. Nombra su propio renglón a propósito: el master se ordena
// por N° de OT, así que una fórmula que apuntara a una fila fija empezaría a
// leer el J de otra orden.
//
// DOS GUARDAS, Y LAS DOS COSTARON CARO ANTES
//
//   - **El rango se arma una sola vez y se informa el mismo que se escribe.**
//     El 21/10/2026 un script tenía una constante `LETRA = "F"` sólo para
//     imprimir mientras escribía en la G por índice: el informe confirmaba lo
//     que no había pasado y seis OT quedaron con el equipo pisado.
//   - **Se comprueba el encabezado de la columna antes de escribir**, y que no
//     haya nada en la celda. Pisar una celda que alguien llenó sería perder un
//     estado de verdad.
//
// Y un freno: si hubiera que tocar más de 50 filas, no escribe. Una planilla
// recalculando devuelve celdas vacías que no son celdas vacías —eso ya se
// llevó por delante 621 OT una vez—, y acá «vacío» es justo el criterio.
// `leerValores` corta solo en ese caso, pero el freno es la segunda red.
//
// Uso:
//   npx tsx scripts/poner-la-formula-del-estado.mts              ← sólo dice
//   npx tsx scripts/poner-la-formula-del-estado.mts --escribir   ← escribe

import { readFileSync, existsSync } from "node:fs";

const env = new URL("../.env.local", import.meta.url);
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { leerValores, escribirCeldas, leerFormulasDeRango } = await import("../lib/core/sheets.ts");
const { letraDeColumna } = await import("../lib/core/columnaDeSheets.ts");
const { celdaDeEstado } = await import("../lib/mantenimiento/ordenes.ts");

const ESCRIBIR = process.argv.includes("--escribir");
const FRENO = 50;

/** A = 0. La M es el ESTADO y la L la fórmula de atrasado/al día. */
const COL_OT = 0;
const COL_L = 11;
const COL_ESTADO = 12;

const planilla = process.env.GOOGLE_SHEETS_OT_ID ?? "";
const pestana = process.env.GOOGLE_SHEETS_OT_TAB ?? "OT";
if (!planilla) throw new Error("Falta GOOGLE_SHEETS_OT_ID");

const filas = await leerValores(planilla, pestana);
const encabezado = filas[0] ?? [];

// El encabezado manda: si la M no es ESTADO, acá no se escribe nada.
const dice = String(encabezado[COL_ESTADO] ?? "").trim().toUpperCase();
if (dice !== "ESTADO") {
  throw new Error(
    `La columna ${letraDeColumna(COL_ESTADO)} no dice ESTADO sino «${dice}». ` +
    `No se escribe: el mapa de columnas cambió y hay que mirarlo.`
  );
}
console.log(`Columna ${letraDeColumna(COL_ESTADO)} = «${dice}» · ${filas.length - 1} filas leídas\n`);

// ── «VACÍA» ES SIN FÓRMULA, NO SIN TEXTO ───────────────────────────────────
//
// Una celda que ya tiene `=IF(Jn="","",Ln)` se ve vacía cuando esa OT no tiene
// fecha de ejecución —es el caso de la 622—, y eso está bien: no hay estado
// que calcular todavía. Mirando sólo el texto, este script la proponía otra
// vez en cada corrida y nunca quedaba conforme. Lo que decide es si hay
// fórmula; así además es idempotente, que es lo que uno quiere de algo que
// escribe en una planilla de producción.
const letraEstado = letraDeColumna(COL_ESTADO);
const tieneFormula = await leerFormulasDeRango(
  planilla, pestana, `${letraEstado}1:${letraEstado}${filas.length}`
);

/** Las celdas a escribir. Se arman UNA vez: es lo que se informa y lo que va. */
const aEscribir = [];
for (let i = 1; i < filas.length; i++) {
  const fila = i + 1;                       // la planilla cuenta desde 1
  const ot = Number(String(filas[i][COL_OT] ?? "").trim());
  if (!ot || isNaN(ot)) continue;
  if (String(filas[i][COL_ESTADO] ?? "").trim() !== "") continue;
  if (tieneFormula[i]?.[0] === true) continue;

  aEscribir.push({
    pestana,
    fila,
    columna: COL_ESTADO,
    valor: celdaDeEstado("POR_HACER", fila),
    ot,
    loQueCalculaLaL: String(filas[i][COL_L] ?? "").trim() || "(vacío)",
  });
}

if (aEscribir.length === 0) {
  console.log("Ninguna OT tiene el ESTADO en blanco. No hay nada que hacer.");
  process.exit(0);
}

for (const c of aEscribir) {
  // El rango se imprime desde los MISMOS campos que se mandan a escribir.
  console.log(
    `  OT ${c.ot}  ${c.pestana}!${letraDeColumna(c.columna)}${c.fila}  ` +
    `← ${c.valor}   (la L dice «${c.loQueCalculaLaL}»)`
  );
}
console.log(`\n${aEscribir.length} celda(s) en blanco.`);

if (aEscribir.length > FRENO) {
  console.log(
    `FRENO: son más de ${FRENO}. Una planilla recalculando devuelve vacías las ` +
    `celdas que no resolvió, y «vacío» es justo el criterio de este script. ` +
    `Mirala antes de forzar nada.`
  );
  process.exit(1);
}

if (!ESCRIBIR) {
  console.log("Simulación: no se escribió nada. Con --escribir va de verdad.");
  process.exit(0);
}

await escribirCeldas(
  planilla,
  aEscribir.map((c) => ({ pestana: c.pestana, fila: c.fila, columna: c.columna, valor: c.valor }))
);
console.log("Escrito. Releyendo para comprobar…\n");

// ── SE COMPRUEBA LA FÓRMULA, NO LO QUE SE VE ────────────────────────────────
//
// La primera versión de esto miraba el valor renderizado y cantaba «SIGUE
// VACÍA» para la OT 622, que es la única sin fecha de ejecución: ahí
// `=IF(J2="","",L2)` devuelve "" **porque corresponde**. O sea que el informe
// daba por fallada la celda que había quedado bien. Un chequeo que no
// distingue «la fórmula no está» de «está y da vacío» no comprueba nada.
const letra = letraEstado;
const primera = Math.min(...aEscribir.map((c) => c.fila));
const ultima = Math.max(...aEscribir.map((c) => c.fila));
const esFormula = await leerFormulasDeRango(planilla, pestana, `${letra}${primera}:${letra}${ultima}`);
const despues = await leerValores(planilla, pestana);

let bien = 0;
for (const c of aEscribir) {
  const tieneFormula = esFormula[c.fila - primera]?.[0] === true;
  const seVe = String(despues[c.fila - 1]?.[c.columna] ?? "").trim() || "(vacío, la OT no tiene fecha)";
  if (tieneFormula) bien++;
  console.log(
    `  OT ${c.ot}  ${letra}${c.fila} ${tieneFormula ? "tiene la fórmula" : "✗ SIN FÓRMULA"} · se ve «${seVe}»`
  );
}
console.log(`\n${bien} de ${aEscribir.length} quedaron con la fórmula puesta.`);
process.exit(bien === aEscribir.length ? 0 : 1);
