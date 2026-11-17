// Enlazar a su orden de trabajo los avisos que sólo traían el número como texto.
//
// POR QUÉ HACE FALTA
//
// Un aviso dice que una máquina anda mal y de él sale una orden de trabajo. En
// 182 de los 238 avisos (medido el 17/11/2026) el número de esa orden vive sólo
// como **texto** en `ot_asignada` —lo tipeó una persona en una planilla de
// Google— mientras `avisos.work_order_id`, la columna de verdad, está en null. La
// pantalla dice «OT #2814» a secas y no puede mostrar el estado del trabajo.
//
// La sincronización ya mantiene el enlace en cada corrida
// (`resolverElEnlace.ts`); este script lo rellena **de una vez** para lo que ya
// existía. Los dos deciden con la misma regla, `loQueHayQueReenlazar` de
// `enlaceDelAviso.ts`: acá no hay una segunda. Si este script decidiera por su
// cuenta, el mismo aviso quedaría enlazado distinto según por dónde se corrigió.
//
// QUÉ SE TOCA Y QUÉ NO
//
// - Se enlaza el aviso sin `work_order_id` cuyo `ot_asignada` es un número que
//   existe en `ordenes_trabajo`. Se escribe también `ot_resuelta_en`, el sello
//   que dice «este enlace lo puso la resolución automática».
// - No se toca lo que enlazó una persona con «Ya tiene OT» (`ot_enlazada_en`) ni
//   la OT que el sistema generó desde el aviso: desenlazarla dejaría una orden
//   que nadie reclama. Un texto que no es un número no se interpreta, y un número
//   que el sistema no conoce no se enlaza «al que se le parece».
//
// El informe en seco separa esos casos por motivo, y es lo accionable: un aviso
// sin enlace se ve y se arregla a mano; uno mal enlazado no se nota nunca.
//
// EL VACIADO SE IGNORA A PROPÓSITO
//
// `loQueHayQueReenlazar` también devuelve `aVaciar` (enlaces automáticos que la
// planilla dejó de afirmar). Este script **no lo aplica**: corre una sola vez
// sobre una base donde nadie resolvió nada todavía, así que no hay enlace
// automático que vaciar, y un vaciado acá sólo podría venir de un error de
// lectura. Si aparece uno, se informa y no se escribe.
//
// El UPDATE repite en el `where` las condiciones de la lectura
// (`work_order_id is null` y `ot_enlazada_en is null`): si alguien enlazó entre
// la lectura y la escritura, no se le pisa.
//
// Necesita aplicada la migración que agrega `avisos.ot_resuelta_en`.
//
// Uso:
//   npx tsx scripts/rellenar-el-enlace-de-avisos.mts            ← dice qué haría
//   npx tsx scripts/rellenar-el-enlace-de-avisos.mts --aplicar
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { createAdminClient } = await import("../lib/supabase/admin.ts");
const { traerTodo } = await import("../lib/core/paginado.ts");
const { loQueHayQueReenlazar, numeroDeOtDelTexto } = await import(
  "../lib/mantenimiento/enlaceDelAviso.ts"
);

const APLICAR = process.argv.includes("--aplicar");
const TAMANO_LOTE = 200; // un .in() largo arma una URL que PostgREST rechaza con un 400 mudo

const admin = createAdminClient();

/* ── Lo que se lee ──────────────────────────────────────────────────────── */

const avisos = (await traerTodo((desde, hasta) =>
  admin
    .from("avisos")
    .select("id, oa_number, ot_asignada, work_order_id, ot_enlazada_en, ot_resuelta_en")
    .order("id")
    .range(desde, hasta)
)) as {
  id: string;
  oa_number: number | string | null;
  ot_asignada: string | null;
  work_order_id: string | null;
  ot_enlazada_en: string | null;
  ot_resuelta_en: string | null;
}[];

const ordenes = await traerTodo((desde, hasta) =>
  admin.from("ordenes_trabajo").select("id, ot_number").order("id").range(desde, hasta)
);
const idPorNumero = new Map<number, string>();
for (const ot of ordenes) idPorNumero.set(Number(ot.ot_number), ot.id as string);

/* ── Qué haría ──────────────────────────────────────────────────────────── */

const { aEnlazar, aVaciar } = loQueHayQueReenlazar(avisos, idPorNumero);
const aEnlazarIds = new Set(aEnlazar.flatMap((g) => g.avisoIds));
const totalAEnlazar = aEnlazarIds.size;

// Por qué se deja cada uno sin tocar. Es sólo diagnóstico: la decisión la toma
// `loQueHayQueReenlazar`; esto la espeja para poder explicarla.
const motivos = {
  aMano: 0, // lo enlazó una persona
  nacioDelAviso: 0, // enlazado, sin ningún sello: la OT salió de este aviso
  yaEnlazadoAutomatico: 0, // ya lleva el sello y sigue siendo el que corresponde
  noEsNumero: 0,
  numeroDesconocido: 0,
  sinNada: 0,
};
const desconocidos: string[] = [];
const noNumericos = new Map<string, number>();

for (const a of avisos) {
  if (aEnlazarIds.has(a.id)) continue;
  if (a.ot_enlazada_en) {
    motivos.aMano += 1;
    continue;
  }
  if (a.work_order_id && !a.ot_resuelta_en) {
    motivos.nacioDelAviso += 1;
    continue;
  }
  if (a.work_order_id) {
    motivos.yaEnlazadoAutomatico += 1;
    continue;
  }
  const texto = (a.ot_asignada ?? "").trim();
  if (!texto) {
    motivos.sinNada += 1;
    continue;
  }
  const n = numeroDeOtDelTexto(texto);
  if (n === null) {
    motivos.noEsNumero += 1;
    noNumericos.set(texto, (noNumericos.get(texto) ?? 0) + 1);
  } else {
    motivos.numeroDesconocido += 1;
    desconocidos.push(`${n} (aviso ${a.oa_number})`);
  }
}

const sinTocar = avisos.length - totalAEnlazar;

console.log(`Avisos en total: ${avisos.length}`);
console.log(`Órdenes de trabajo leídas: ${ordenes.length}`);
console.log(`  quedarían CON enlace nuevo: ${totalAEnlazar}`);
console.log(`  se dejan sin tocar: ${sinTocar}`);
console.log(`    ya enlazados a mano ("Ya tiene OT"): ${motivos.aMano}`);
console.log(`    OT nacida del aviso (sin sello): ${motivos.nacioDelAviso}`);
console.log(`    ya enlazados por esta regla y vigentes: ${motivos.yaEnlazadoAutomatico}`);
console.log(`    con un texto que no es un número: ${motivos.noEsNumero}`);
console.log(`    con un número que el sistema no conoce: ${motivos.numeroDesconocido}`);
console.log(`    sin nada en ot_asignada: ${motivos.sinNada}`);

if (noNumericos.size > 0) {
  console.log("\nTextos que no son un número (avisos · texto):");
  for (const [t, n] of [...noNumericos].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${JSON.stringify(t)}`);
  }
}
if (desconocidos.length > 0) {
  console.log("\nNúmeros que no están en ordenes_trabajo (puede que la OT no haya llegado aún):");
  for (const d of desconocidos) console.log(`  ${d}`);
}
if (aVaciar.length > 0) {
  console.log(
    `\nATENCIÓN: la regla pediría vaciar ${aVaciar.length} enlaces. Este script no los vacía ` +
      "(corre una vez, sobre una base sin resolución previa): mirar por qué hay sello puesto."
  );
}

/* ── Escribir ───────────────────────────────────────────────────────────── */

if (!APLICAR) {
  console.log("\nEn seco: no se escribió nada. Con --aplicar se enlazan esos avisos.");
  process.exit(0);
}

const cuando = new Date().toISOString(); // un solo sello para toda la corrida
let actualizados = 0;
for (const { otId, avisoIds } of aEnlazar) {
  for (let i = 0; i < avisoIds.length; i += TAMANO_LOTE) {
    const lote = avisoIds.slice(i, i + TAMANO_LOTE);
    const { data, error } = await admin
      .from("avisos")
      .update({ work_order_id: otId, ot_resuelta_en: cuando })
      .in("id", lote)
      .is("work_order_id", null) // no pisar lo que alguien enlazó mientras tanto
      .is("ot_enlazada_en", null)
      .select("id");
    if (error) throw new Error(error.message);
    actualizados += data?.length ?? 0;
  }
}
console.log(`\nActualizados: ${actualizados} de ${totalAEnlazar}.`);
if (actualizados !== totalAEnlazar) {
  console.log(
    "La diferencia son avisos que recibieron enlace entre la lectura y la escritura: no se pisaron."
  );
}
