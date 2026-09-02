/**
 * Escribir en la planilla del almacén el movimiento que se cargó en el SdG.
 *
 * La planilla manda, así que un movimiento que no llega allá **no existe**: la
 * próxima sincronización lee el stock calculado por las fórmulas —que no lo
 * incluyen— y revierte el número que el RPC había bajado. Por eso esto no es
 * decorativo y por eso, cuando falla, queda anotado en vez de perderse en un
 * log.
 *
 * El repo de origen lo hacía con un Web App de Apps Script, porque ese proyecto
 * no podía usar una cuenta de servicio. Acá sí: la del SdG ya lee esta misma
 * planilla. Sólo hace falta que esté compartida como **editor**, igual que las
 * de OT, OS y comparativas.
 */

import { leerValores, escribirCeldas, filaSiguienteSegunLaColumna } from "@/lib/core/sheets";

/**
 * Las columnas del kardex `Entradas  Salidas`, en base 0.
 *
 * **La G no está y no puede estar.** Es el saldo corriente, y es una fórmula:
 * escribirla la rompe y con ella el stock de todo lo que viene abajo. El Apps
 * Script del repo de origen lo dice en su encabezado —"el script NO calcula ni
 * escribe el stock"— y acá vale igual.
 */
export const COL = {
  ri: 0,          // A
  codigo: 1,      // B  ← la que dice si la fila tiene datos
  descripcion: 2, // C
  entrada: 3,     // D
  salida: 4,      // E
  solicitante: 5, // F
  // G = saldo, fórmula. No se toca.
  fecha: 7,       // H
  proveedor: 8,   // I
  sector: 9,      // J
} as const;

export interface MovimientoAEspejar {
  ri: number | null;
  codigo: string;
  descripcion: string | null;
  tipo: "entrada" | "salida" | "ajuste";
  cantidad: number;
  stock_anterior: number | null;
  stock_resultante: number | null;
  solicitante: string | null;
  proveedor: string | null;
  sector: string | null;
  /** ISO. Se escribe como d/m/aaaa, que es como la lee la planilla. */
  fecha: string | null;
}

export interface Celda {
  pestana: string;
  columna: number;
  fila: number;
  valor: string;
}

/** Una fecha ISO como la escribe la planilla: d/m/aaaa, nunca m/d. */
export function fechaParaLaPlanilla(iso: string | null | undefined): string {
  if (!iso) return "";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return a && m && d ? `${Number(d)}/${Number(m)}/${a}` : "";
}

/**
 * Cuánto entra y cuánto sale, según el tipo.
 *
 * La planilla no conoce el `ajuste`: tiene una columna de entrada y otra de
 * salida y nada más. Un ajuste se escribe como la **diferencia** contra el stock
 * que había, para el lado que corresponda. Es lo mismo que hacía el Apps Script,
 * y es lo que mantiene la fórmula del saldo coherente.
 *
 * Un ajuste que no mueve nada no escribe ninguna de las dos.
 */
export function entradaYSalida(m: MovimientoAEspejar): { entrada: string; salida: string } {
  if (m.tipo === "entrada") return { entrada: String(m.cantidad), salida: "" };
  if (m.tipo === "salida") return { entrada: "", salida: String(m.cantidad) };

  const delta = Number(m.stock_resultante ?? 0) - Number(m.stock_anterior ?? 0);
  if (delta > 0) return { entrada: String(delta), salida: "" };
  if (delta < 0) return { entrada: "", salida: String(-delta) };
  return { entrada: "", salida: "" };
}

/**
 * Qué celdas hay que escribir para dejar el movimiento en la planilla.
 *
 * Va aparte de la llamada a Google para poder probarla: es la parte que decide
 * qué se toca y qué no, y tocar la G de más sería romper la planilla entera.
 */
export function celdasDelMovimiento(
  m: MovimientoAEspejar,
  fila: number,
  pestana: string
): Celda[] {
  const { entrada, salida } = entradaYSalida(m);
  const celda = (columna: number, valor: string): Celda => ({ pestana, columna, fila, valor });

  return [
    celda(COL.ri, m.ri === null ? "" : String(m.ri)),
    celda(COL.codigo, m.codigo),
    celda(COL.descripcion, m.descripcion ?? ""),
    celda(COL.entrada, entrada),
    celda(COL.salida, salida),
    celda(COL.solicitante, m.solicitante ?? ""),
    celda(COL.fecha, fechaParaLaPlanilla(m.fecha)),
    celda(COL.proveedor, m.proveedor ?? ""),
    celda(COL.sector, m.sector ?? ""),
  ];
}

const PLANILLA = () => process.env.GOOGLE_SHEETS_INVENTARIO_ID ?? "";
const TAB_KARDEX = () => process.env.GOOGLE_SHEETS_INVENTARIO_TAB_MOV ?? "Entradas  Salidas";

export interface ResultadoEspejo {
  ok: boolean;
  /** En qué fila de la planilla quedó, para poder reconocerlo al releer. */
  fila?: number;
  /** Qué dijo Google, sin traducir. Un diagnóstico que no se distingue de otro no sirve. */
  error?: string;
}

/**
 * Escribe el movimiento al final del kardex.
 *
 * La fila se busca por la **columna B**, el código: la A es el N° de
 * requerimiento y viene vacía en la mayoría de las filas, así que buscar por A
 * dejaría la fila nueva en medio de los datos.
 *
 * No lanza: devuelve qué pasó. Quien lo llama decide, y lo que decide es anotar
 * el pendiente — no tragárselo.
 */
export async function espejarMovimiento(m: MovimientoAEspejar): Promise<ResultadoEspejo> {
  const planilla = PLANILLA();
  if (!planilla) {
    return { ok: false, error: "Falta configurar GOOGLE_SHEETS_INVENTARIO_ID" };
  }

  const pestana = TAB_KARDEX();

  try {
    const columnaB = await leerValores(planilla, `${pestana}!B:B`, { sinFormato: true });
    const fila = filaSiguienteSegunLaColumna(columnaB);

    await escribirCeldas(planilla, celdasDelMovimiento(m, fila, pestana));
    return { ok: true, fila };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
