/**
 * Dice si el libro de carbonilla del SdG y su planilla dicen lo mismo, hoy.
 *
 * Es el hermano de `simular-bajada-envases.mts` para el otro frente de Calidad,
 * y **no escribe una sola celda**: usa la misma función pura que la corrida de
 * verdad —`filasPorLeer`— así que lo que informa es exactamente lo que la
 * lectura haría.
 *
 * POR QUÉ EXISTE
 *
 * Es la condición acordada para volver a cortar: *el sector sigue cargando en
 * la planilla hasta que los números empaten y eso se sostenga en el tiempo*.
 * Hasta ahora esa medición no existía en ningún lado — se hacía a mano, y por
 * eso las dos veces que el libro se desempató se supo porque alguien preguntó:
 * 8 t el 21/10/2026 y 59 t el 23/10. Una condición que nadie puede medir no es
 * una condición.
 *
 * QUÉ MIRA, Y QUÉ NO
 *
 * Mira **los saldos por tipo**, vegetal y residual, que son los que significan
 * algo. **No mira el `TOTAL` de la planilla**, que está 0,450 t arriba de la
 * suma de sus propias dos columnas desde la fila 386 (15/12/2025), cuando el
 * saldo por tipo se escribió a mano en números redondos. Eso está decidido y
 * explicado en docs/CALIDAD.md: mandan las cantidades por tipo.
 *
 * Y mira qué haría la lectura: cuántas filas traería, cuántas releería —desde
 * el 23/10 una fila cambiada se aplica sola— y cuántas no puede resolver.
 *
 *   npx tsx --env-file=.env.local scripts/empatan-carbonilla-y-la-planilla.mts
 *
 * Sale 0 cuando empatan y la bandeja está vacía; 1 cuando no.
 */
import { createClient } from "@supabase/supabase-js";
import { leerValores } from "@/lib/core/sheets";
import { traerMovimientos } from "@/lib/calidad/consultas";
import { saldosDelLibro } from "@/lib/calidad/movimientos";
import { filasPorLeer, PESTANA, type FilaOcupada } from "@/lib/calidad/desdeLaPlanilla";

const ID = process.env.GOOGLE_SHEETS_STOCK_CARBONILLA_ID;
if (!ID) {
  console.error("Falta GOOGLE_SHEETS_STOCK_CARBONILLA_ID en .env.local");
  process.exit(1);
}
const URL_SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL;
const LLAVE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_SUPA || !LLAVE) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const sb = createClient(URL_SUPA, LLAVE, { auth: { persistSession: false } });

const [movimientos, filas] = await Promise.all([
  traerMovimientos(sb),
  leerValores(ID, PESTANA, { sinFormato: true }),
]);

const num = (x: unknown) => (typeof x === "number" ? x : null);

/* ── Los saldos, que es lo que se mira ─────────────────────── */

const sdg = saldosDelLibro(movimientos);

/** La última fila de la planilla que lleva los tres saldos escritos. */
let planilla: { vegetal: number; residual: number; fila: number } | null = null;
for (let i = filas.length - 1; i >= 0; i--) {
  const f = filas[i];
  if (num(f[4]) !== null && num(f[5]) !== null && num(f[6]) !== null) {
    planilla = { vegetal: num(f[5]) as number, residual: num(f[6]) as number, fila: i + 1 };
    break;
  }
}

if (!planilla) {
  console.error("La planilla no tiene ninguna fila con los saldos escritos. No se puede comparar.");
  process.exit(1);
}

/** Tres decimales, que es `numeric(12,3)` en la base. */
const igual = (a: number, b: number) => Math.abs(a - b) < 0.0005;

const empatanLosSaldos =
  igual(sdg.vegetal, planilla.vegetal) && igual(sdg.residual, planilla.residual);

console.log("SALDOS POR TIPO");
console.log("                     VEGETAL      RESIDUAL");
console.log(`  el SdG        ${sdg.vegetal.toFixed(3).padStart(12)}  ${sdg.residual.toFixed(3).padStart(12)}`);
console.log(
  `  la planilla   ${planilla.vegetal.toFixed(3).padStart(12)}  ${planilla.residual.toFixed(3).padStart(12)}   (fila ${planilla.fila})`
);
console.log(
  `  diferencia    ${(sdg.vegetal - planilla.vegetal).toFixed(3).padStart(12)}  ${(sdg.residual - planilla.residual).toFixed(3).padStart(12)}`
);

/* ── Qué haría la lectura, sin hacerlo ─────────────────────── */

const ocupadas = new Map<string, FilaOcupada>();
for (const m of movimientos) {
  if (m.sheets_fila === null) continue;
  const t = Number(m.toneladas);
  ocupadas.set(m.id, {
    fila: m.sheets_fila,
    entradas: t > 0 ? t : null,
    salidas: t < 0 ? -t : null,
  });
}

const r = filasPorLeer(ocupadas, filas);

console.log(`\nQUÉ HARÍA LA LECTURA (sin escribir nada)`);
console.log(`  filas en la planilla        ${filas.length}`);
console.log(`  movimientos en el SdG       ${movimientos.length}  (${ocupadas.size} con fila)`);
console.log(`  traería                     ${r.nuevas.length}`);
console.log(`  releería (cambiaron allá)   ${r.relecturas.length}`);
console.log(`  actualizaría de lugar       ${r.reubicadas.length}`);

/*
 * Lo que la lectura NO puede resolver sola. Es lo mismo que termina en la
 * bandeja y en el aviso del resumen diario, y es lo único que necesita a una
 * persona.
 */
const sinResolver = [
  ...r.vaciadas.map((f) => `fila ${f.fila}: ${f.motivo}`),
  ...r.ambiguas.map((f) => `fila ${f.fila}: ${f.motivo}`),
  ...r.duplicadas.map((f) => `fila ${f.fila}: ${f.motivo}`),
  ...r.huerfanas.map((f) => `fila ${f.fila}: ${f.motivo}`),
];

console.log(`\nLO QUE NECESITA UNA PERSONA: ${sinResolver.length === 0 ? "nada" : sinResolver.length}`);
for (const l of sinResolver.slice(0, 20)) console.log(`  ${l}`);
if (sinResolver.length > 20) console.log(`  … y ${sinResolver.length - 20} más`);

if (r.desaparecidas.length) {
  console.log(`\nMOVIMIENTOS CUYA FILA YA NO ESTÁ EN LA PLANILLA: ${r.desaparecidas.length}`);
  console.log("  (alguien borró esas filas allá; el SdG los sigue teniendo)");
}

/* ── El veredicto ───────────────────────────────────────────── */

// Las relecturas pendientes NO cuentan como desempate: la próxima corrida las
// aplica sola. Lo que cuenta es que los saldos coincidan y que no quede nada
// esperando a una persona.
const empatan = empatanLosSaldos && sinResolver.length === 0;

console.log(
  `\n${empatan ? "EMPATAN" : "NO EMPATAN"} — ` +
    (empatan
      ? "el SdG y la planilla dicen lo mismo por tipo, y no hay nada trabado."
      : !empatanLosSaldos
        ? "los saldos por tipo no coinciden. Si la lectura tiene relecturas pendientes, correrla y volver a medir."
        : "los saldos coinciden pero hay filas que el sistema no puede resolver.")
);
process.exit(empatan ? 0 : 1);
