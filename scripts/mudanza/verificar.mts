/**
 * Comparar dos informes de `contar.mts` y decir si se puede seguir.
 *
 *   npx tsx scripts/mudanza/verificar.mts docs/mudanza-antes.json despues.json
 *
 * **Sale con código 1 si falta algo.** Es a propósito: en la ventana, a las
 * once de la noche, "salió un texto largo" y "salió mal" se confunden. Un
 * código de salida no se confunde, y permite encadenarlo con `&&` para que el
 * paso siguiente no corra solo.
 */
import { readFileSync } from "node:fs";
import { compararConteos, hayAlgoFatal, type Conteo } from "./comparar";

interface Informe {
  url: string;
  fecha: string;
  tablas: Conteo[];
  usuarios: number;
  buckets: { id: string; objetos: number; bytes: number }[];
}

const [rutaAntes, rutaDespues] = process.argv.slice(2);
if (!rutaAntes || !rutaDespues) {
  console.error("Uso: verificar.mts <antes.json> <despues.json>");
  process.exit(1);
}

const antes: Informe = JSON.parse(readFileSync(rutaAntes, "utf8"));
const despues: Informe = JSON.parse(readFileSync(rutaDespues, "utf8"));

const diferencias = compararConteos(antes.tablas, despues.tablas);
let mal = hayAlgoFatal(diferencias);

console.log(`Origen : ${antes.url}  (${antes.fecha})`);
console.log(`Destino: ${despues.url}  (${despues.fecha})`);
console.log();

console.log("TABLAS");
if (!diferencias.length) {
  console.log(`  OK    las ${antes.tablas.length} tablas coinciden`);
} else {
  for (const d of diferencias) {
    console.log(
      `  ${d.fatal ? "MAL  " : "aviso"} ${d.tabla}: ${d.motivo} ` +
        `(origen ${d.origen ?? "?"}, destino ${d.destino ?? "?"})`,
    );
  }
}

console.log();
console.log("USUARIOS");
if (despues.usuarios < antes.usuarios) {
  // El renglón que hay que mirar dos veces: se pueden restaurar las 43.000
  // filas y que no entre nadie.
  console.log(
    `  MAL   había ${antes.usuarios}, hay ${despues.usuarios}. Sin esto no entra nadie al sistema.`,
  );
  mal = true;
} else {
  console.log(`  OK    ${despues.usuarios}`);
}

console.log();
console.log("STORAGE");
for (const b of antes.buckets) {
  const otro = despues.buckets.find((x) => x.id === b.id);
  if (!otro) {
    console.log(`  MAL   ${b.id}: no existe en el destino`);
    mal = true;
  } else if (otro.objetos < b.objetos) {
    console.log(`  MAL   ${b.id}: había ${b.objetos} objetos, hay ${otro.objetos}`);
    mal = true;
  } else {
    console.log(`  OK    ${b.id}: ${otro.objetos} objetos`);
  }
}

console.log();
console.log(mal ? "NO se puede seguir." : "Se puede seguir.");
process.exit(mal ? 1 : 0);
