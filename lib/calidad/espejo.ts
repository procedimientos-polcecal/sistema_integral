import type { SupabaseClient } from "@supabase/supabase-js";
import { agregarFila, escribirCeldas } from "@/lib/core/sheets";
import { hayCredencialesGoogle } from "@/lib/core/google";
import {
  COLUMNA_QUE_MANDA,
  PESTANA,
  filaDeLaPlanilla,
  type CeldaDePlanilla,
  type ContextoDeLaFila,
  type MovimientoParaLaPlanilla,
} from "./planilla";
import { saldoCorrido } from "./movimientos";
import { traerCarbonilleros, traerMovimientos } from "./consultas";

/**
 * Escribir en la planilla de stock el movimiento que se acaba de cargar.
 *
 * Acá manda el sistema, como en Producción y en las órdenes de carga: la
 * planilla queda como el lugar donde miran los que no entran al SdG, y su
 * llenado a mano desaparece. Hoy son 1.043 renglones transcritos de algo que ya
 * estaba en otras dos partes.
 *
 * **No lanza: devuelve qué pasó.** Quien lo llama anota el pendiente con lo que
 * dijo Google **sin traducir** y se lo dice a quien guardó. Un fallo de
 * escritura no es un `console.warn`: eso costó una tarde entera en Compras.
 *
 * El libro tiene una sola pestaña de datos, así que no hay pestaña que crear.
 * La columna que manda es la `A` (`CODIGO`) y **no la `B`**: la `B` tiene un
 * `VLOOKUP` precargado cientos de filas más abajo de lo cargado, así que por ahí
 * la "última fila con algo" sale muy pasada y la escritura dejaría un hueco.
 */

const PLANILLA = () => process.env.GOOGLE_SHEETS_STOCK_CARBONILLA_ID ?? "";

export interface ResultadoEspejo {
  ok: boolean;
  /** En qué fila quedó, para poder reescribirla al corregir. */
  fila?: number;
  /** Qué dijo Google, sin traducir. */
  error?: string;
}

/** Si el espejo puede intentar escribir. Sin esto el movimiento queda pendiente, no falla. */
export function hayEspejoDeStock(): boolean {
  return hayCredencialesGoogle() && Boolean(PLANILLA());
}

/**
 * Agrega la fila si es nueva, o reescribe la que ya tiene.
 *
 * **Se escriben las diez columnas en los dos caminos, fórmulas incluidas.** La
 * excepción a "no pises una fórmula" está justificada en `planilla.ts`: la de
 * `RESIDUAL` está cableada a un solo proveedor y ninguna sabe representar un
 * ajuste en más. Sostener la fórmula viva sería sostener dos saldos que
 * discrepan.
 */
export async function escribirMovimiento(
  movimiento: MovimientoParaLaPlanilla,
  contexto: ContextoDeLaFila,
  filaExistente: number | null
): Promise<ResultadoEspejo> {
  if (!hayEspejoDeStock()) {
    return {
      ok: false,
      error:
        "Falta GOOGLE_SHEETS_STOCK_CARBONILLA_ID o las credenciales de Google, así que no se escribió en la planilla.",
    };
  }

  // Armar la fila puede fallar por datos —una entrada sin carbonillero, una
  // fecha imposible— y eso no es un error de Google: se informa igual, pero se
  // distingue por el texto.
  let celdas: CeldaDePlanilla[];
  try {
    celdas = filaDeLaPlanilla(movimiento, contexto);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  try {
    if (filaExistente === null) {
      const fila = await agregarFila(PLANILLA(), PESTANA, celdas, COLUMNA_QUE_MANDA);
      return { ok: true, fila };
    }

    await escribirCeldas(
      PLANILLA(),
      celdas.map((valor, columna) => ({ pestana: PESTANA, columna, fila: filaExistente, valor }))
    );
    return { ok: true, fila: filaExistente };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Escribir en la planilla un movimiento **que ya está guardado**, con el saldo
 * que le corresponde en su lugar del libro.
 *
 * Se llama después de guardar y nunca antes: el saldo de una fila es el que
 * queda después de ella, así que el movimiento tiene que existir para poder
 * calcularlo.
 *
 * **Nunca lanza.** Deja anotado el pendiente con lo que dijo Google sin
 * traducir y devuelve el aviso para que la ruta se lo diga a quien guardó. Un
 * fallo de escritura no puede deshacer un dato que ya se cargó bien.
 */
export async function exportarMovimiento(
  supabase: SupabaseClient,
  movimientoId: string
): Promise<{ aviso: string | null }> {
  const [movimientos, carbonilleros] = await Promise.all([
    traerMovimientos(supabase),
    traerCarbonilleros(supabase),
  ]);

  const filas = saldoCorrido(movimientos);
  const fila = filas.find((f) => f.movimiento.id === movimientoId);
  if (!fila) return { aviso: "No se encontró el movimiento para exportarlo." };

  const m = fila.movimiento;

  // Los `sin_separar` son historia importada: la planilla ya los tiene, con su
  // fila original en `sheets_fila`. No se reescriben.
  if (m.carbon === "sin_separar") return { aviso: null };

  const carbonillero = m.carbonillero_id
    ? carbonilleros.find((c) => c.id === m.carbonillero_id)
    : undefined;

  const r = await escribirMovimiento(
    { tipo: m.tipo, carbon: m.carbon, toneladas: m.toneladas, fecha: m.fecha },
    {
      carbonillero,
      saldoTotal: fila.saldoTotal,
      saldoVegetal: fila.saldoVegetal,
      saldoResidual: fila.saldoResidual,
    },
    m.sheets_fila
  );

  if (r.ok) {
    await supabase
      .from("calidad_movimientos")
      .update({ sheets_fila: r.fila, sheets_pendiente: null, sheets_pendiente_en: null })
      .eq("id", movimientoId);
    return { aviso: null };
  }

  await supabase
    .from("calidad_movimientos")
    .update({ sheets_pendiente: r.error, sheets_pendiente_en: new Date().toISOString() })
    .eq("id", movimientoId);

  return { aviso: `El movimiento se guardó, pero no se pudo escribir en la planilla: ${r.error}` };
}

/**
 * Marcar como pendientes las filas cuyo saldo cambió por corregir un movimiento
 * anterior.
 *
 * Corregir una tonelada de marzo mueve el saldo de todo lo que vino después, y
 * la planilla lleva ese saldo en tres columnas. Reescribir cientos de filas
 * contra Google por una corrección no es una opción; **decir cuáles quedaron
 * mal, sí**.
 *
 * Es un solo `UPDATE` con un `.gte()`, no una llamada por fila. Y no pisa un
 * pendiente que ya exista: si esa fila venía fallando por otra cosa, ese texto
 * es el que sirve.
 */
export async function marcarPosterioresDesactualizados(
  supabase: SupabaseClient,
  desdeFecha: string
): Promise<void> {
  await supabase
    .from("calidad_movimientos")
    .update({
      sheets_pendiente:
        "El saldo de esta fila cambió porque se corrigió un movimiento anterior. Reintentá para reescribirla.",
      sheets_pendiente_en: new Date().toISOString(),
    })
    .gte("fecha", desdeFecha)
    .is("sheets_pendiente", null)
    .not("sheets_fila", "is", null);
}
