/**
 * Dice qué cambiaría la bajada del kardex de Envases, sin tocar nada.
 *
 * Es el hermano de `simular-rls.mjs`: compara lo que el SdG escribiría contra
 * lo que la planilla tiene hoy, celda por celda, y **no escribe una sola
 * celda**. Lee la planilla de producción, que es lectura y está permitido.
 *
 * POR QUÉ EXISTE
 *
 * Es la condición para cortar. Encender la bajada significa que el SdG pasa a
 * mandar, y lo que el SdG no tenga **desaparece de la planilla**. El 19/10/2026
 * el ensayo contra una copia mostró que el SdG venía cinco días atrasado: la
 * bajada habría borrado 18 movimientos y cambiado el stock de 10 de 25
 * artículos.
 *
 * Así que antes de bajar un módulo hay que probar que los dos lados dicen lo
 * mismo. **La condición para cortar es que no quede ninguna diferencia real** —
 * las cosméticas conocidas no cuentan y están explicadas abajo.
 *
 *   npx tsx --env-file=.env.local scripts/simular-bajada-envases.mts
 */
import { createClient } from "@supabase/supabase-js";
import { leerValores } from "@/lib/core/sheets";
import { fechaDeSheets, serialDelDia } from "@/lib/core/fechaDeSheets";
import { traerTodo } from "@/lib/core/paginado";
import {
  BLOQUES,
  PRIMERA_FILA,
  bloquesDeLaBajada,
  ordenarParaLaBajada,
  ultimaFilaConDatos,
  type MovimientoParaBajar,
} from "@/lib/calidad/envases/bajada";

const ID = process.env.GOOGLE_SHEETS_ENVASES_ID;
const TAB = process.env.GOOGLE_SHEETS_ENVASES_TAB_MOV || "Entradas  Salidas";
if (!ID) {
  console.error("Falta GOOGLE_SHEETS_ENVASES_ID en .env.local");
  process.exit(1);
}

const LETRA = "ABCDEFGHIJK".split("");

/**
 * Deja un valor en una forma comparable entre los dos lados.
 *
 * Hace falta porque los dos lados **dicen lo mismo de maneras distintas**, y
 * sin esto cada fila daría tres diferencias falsas:
 *
 * - La planilla devuelve las fechas como **serial** (lectura sin formato) y la
 *   bajada las escribe en **ISO** — a propósito: un serial escrito borra el
 *   formato de la celda. Se comparan como serial.
 * - La bajada fuerza el código a texto con una comilla (`'00014`), que es lo
 *   que impide que `00014` quede en 14. La comilla no llega a la celda.
 * - Los números llegan como número de un lado y como string del otro.
 */
function normalizar(v: unknown, columna: number): string {
  let s = String(v ?? "").trim();
  if (s.startsWith("'")) s = s.slice(1);
  if (s === "") return "";

  if (columna === 7) {
    // La fecha: si es ISO, a serial; si ya es un número, tal cual.
    const serial = /^\d{4}-\d{2}-\d{2}$/.test(s) ? serialDelDia(s) : null;
    return String(serial ?? Number(s) ?? s);
  }
  const n = Number(s);
  return Number.isFinite(n) && s !== "" ? String(n) : s;
}

/**
 * Las diferencias que son conocidas y no importan.
 *
 * `crudoDeLaPlanilla` llega sin normalizar porque una de las clases sólo se
 * reconoce mirando el valor original.
 */
function esCosmetica(
  enLaPlanilla: string,
  elSdGEscribe: string,
  columna: number,
  crudoDeLaPlanilla: unknown
): string | null {
  // El cero escrito contra la celda vacía. `espejo.ts` lo deja vacío a
  // propósito: vacío es "acá no pasó nada" y un cero es "se contó y dio cero".
  // La fórmula del stock suma igual las dos.
  if (enLaPlanilla === "0" && elSdGEscribe === "") return "cero escrito que el SdG deja vacío";

  /*
   * Una fecha que en la planilla quedó como TEXTO.
   *
   * Pasa cuando alguien la tipeó en vez de que la celda la tome como fecha: al
   * 19/10/2026 hay **una** así en 1.524 filas, la H28 (`"9/9/2025"`), con
   * seriales arriba y abajo. El SdG la importó bien, así que los dos lados
   * dicen lo mismo y la bajada la dejaría como fecha de verdad — la arregla,
   * no la rompe.
   *
   * **Sólo cuenta como cosmética si significan lo mismo.** Se compara con
   * `fechaDeSheets()`, que es el parser d/m del repo, y no de a ojo: un
   * `3/4/2025` es ambiguo y si la planilla y el SdG no coinciden ahí, eso es
   * una divergencia de verdad y tiene que aparecer como tal. Leer d/m al revés
   * ya dio vuelta 885 fechas en Compras.
   */
  if (columna === 7 && enLaPlanilla === "NaN") {
    const dice = fechaDeSheets(crudoDeLaPlanilla);
    const escribe = fechaDeSheets(Number(elSdGEscribe));
    if (dice && escribe && dice === escribe) {
      return "fecha que la planilla tiene como texto y el SdG dejaría como fecha";
    }
  }
  return null;
}

// ── Los dos lados ────────────────────────────────────────────────────────
const planilla = await leerValores(ID, TAB, { sinFormato: true });
const hastaLaPlanilla = ultimaFilaConDatos(planilla.map((f) => [f[0] ?? ""]));

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
const filas = await traerTodo<Record<string, unknown>>((d, h) =>
  admin
    .from("calidad_envases_movimientos")
    .select("codigo, fecha, entrada, salida, rotura, despacho, observacion, proveedor_raw, sheets_fila, created_at")
    .order("id", { ascending: true })
    .range(d, h)
);
const movimientos: MovimientoParaBajar[] = filas.map((m) => ({
  codigo: String(m.codigo ?? ""),
  entrada: Number(m.entrada ?? 0),
  salida: Number(m.salida ?? 0),
  rotura: Number(m.rotura ?? 0),
  despacho: Number(m.despacho ?? 0),
  fecha: (m.fecha as string) ?? null,
  observacion: (m.observacion as string) ?? null,
  proveedor: (m.proveedor_raw as string) ?? null,
  sheets_fila: (m.sheets_fila as number) ?? null,
  created_at: String(m.created_at ?? ""),
}));

const orden = ordenarParaLaBajada(movimientos);
const bloques = bloquesDeLaBajada(orden, TAB);
const ultimaQueEscribe = PRIMERA_FILA + orden.length - 1;

console.log(`Planilla:  ${hastaLaPlanilla} filas con datos (hasta la fila ${hastaLaPlanilla})`);
console.log(`El SdG:    ${orden.length} movimientos (escribiría hasta la fila ${ultimaQueEscribe})\n`);

// ── El diff ──────────────────────────────────────────────────────────────
const reales: string[] = [];
const cosmeticas = new Map<string, number>();

for (const bloque of bloques) {
  bloque.filas.forEach((fila, i) => {
    const nFila = PRIMERA_FILA + i;
    fila.forEach((valor, j) => {
      const col = bloque.desde + j;
      const enLaPlanilla = normalizar(planilla[nFila - 1]?.[col], col);
      const elSdGEscribe = normalizar(valor, col);
      if (enLaPlanilla === elSdGEscribe) return;

      const motivo = esCosmetica(enLaPlanilla, elSdGEscribe, col, planilla[nFila - 1]?.[col]);
      if (motivo) {
        cosmeticas.set(motivo, (cosmeticas.get(motivo) ?? 0) + 1);
        return;
      }
      if (reales.length < 30) {
        reales.push(`  fila ${nFila} col ${LETRA[col]}: planilla="${enLaPlanilla}"  SdG="${elSdGEscribe}"`);
      } else if (reales.length === 30) reales.push("  …");
    });
  });
}

// Filas que la planilla tiene y el SdG no: las que la bajada BORRARÍA.
const seBorrarian: string[] = [];
for (let f = ultimaQueEscribe + 1; f <= hastaLaPlanilla; f++) {
  const fila = planilla[f - 1] ?? [];
  seBorrarian.push(
    `  fila ${f}: cod=${fila[0] ?? ""} C=${fila[2] ?? ""} D=${fila[3] ?? ""} E=${fila[4] ?? ""} F=${fila[5] ?? ""} H=${fila[7] ?? ""}`
  );
}

console.log("DIFERENCIAS COSMÉTICAS (no impiden cortar):");
if (cosmeticas.size === 0) console.log("  ninguna");
for (const [motivo, n] of cosmeticas) console.log(`  ${String(n).padStart(5)} × ${motivo}`);

console.log(`\nDIFERENCIAS REALES: ${reales.length === 0 ? "ninguna" : reales.length}`);
for (const d of reales) console.log(d);

console.log(`\nFILAS QUE LA BAJADA BORRARÍA: ${seBorrarian.length}`);
for (const d of seBorrarian.slice(0, 20)) console.log(d);

const listo = reales.length === 0 && seBorrarian.length === 0;
console.log(
  `\n${listo ? "LISTO PARA CORTAR" : "NO CORTAR TODAVÍA"} — ` +
    (listo
      ? "el SdG y la planilla dicen lo mismo."
      : "hay que sincronizar o explicar las diferencias antes de encender la bajada.")
);
process.exit(listo ? 0 : 1);
