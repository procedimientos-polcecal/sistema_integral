import { serialDelDia } from "@/lib/core/fechaDeSheets";
import type { CarbonReal, TipoDeMovimiento, TipoDeCarbon } from "./types";

/**
 * Las diez celdas de una fila de `Entradas  Salidas` —con los dos espacios—.
 *
 * Función pura: no habla con Google. La escritura vive en `espejo.ts`.
 *
 * **SE ESCRIBEN LAS DIEZ, FÓRMULAS INCLUIDAS.** Es una excepción deliberada a
 * "pisar una fórmula la convierte en dato muerto", con tres razones medidas:
 *
 *   1. La fórmula de `RESIDUAL` está cableada al código `00010` (Membranex), así
 *      que un segundo proveedor residual lo contaría como vegetal.
 *   2. No puede representar un ajuste en más: suma sólo por `ENTRADAS` y sólo
 *      con un código de proveedor. Por eso el 02/05/2026 alguien tuvo que pisar
 *      la celda del saldo a mano.
 *   3. Acá manda el sistema. Dejar la fórmula viva sería sostener dos saldos que
 *      discrepan.
 *
 * **Nada va como texto.** La escritura usa `USER_ENTERED`: un `"19,58"` lo
 * interpreta la planilla según su locale. La fecha va como serial y las
 * toneladas como número.
 */

export const PESTANA = "Entradas  Salidas";

/**
 * La columna que dice hasta dónde llegan los datos.
 *
 * **La `B` no sirve**: tiene un `VLOOKUP` precargado cientos de filas más abajo
 * de lo cargado, así que la "última fila con algo" daría una fila muy posterior
 * y la escritura dejaría un hueco enorme. La `A` está vacía en esas filas.
 */
export const COLUMNA_QUE_MANDA = "A";

export const CODIGOS_DE_CONSUMO: Record<CarbonReal, string> = {
  vegetal: "00015",
  residual: "00016",
};

/**
 * Los dos códigos que hay que dar de alta en `Listado articulos GRAL`.
 *
 * No existen todavía: hoy el ajuste se carga como consumo y la explicación va
 * en la columna del conteo físico. Están en "lo que falta de una persona".
 */
export const CODIGOS_DE_AJUSTE: Record<CarbonReal, string> = {
  vegetal: "00019",
  residual: "00020",
};

export type CeldaDePlanilla = string | number;

export interface MovimientoParaLaPlanilla {
  tipo: TipoDeMovimiento;
  carbon: TipoDeCarbon;
  /** Con signo, como está guardado. */
  toneladas: number;
  fecha: string;
}

export interface ContextoDeLaFila {
  /** Sólo en una entrada. */
  carbonillero?: { nombre_planilla: string; codigo_planilla: string };
  saldoTotal: number;
  saldoVegetal: number;
  saldoResidual: number;
  /** Si ese mismo día se contó el stock. */
  conteo?: { contadas: number; desvio: number };
}

function codigoYDescripcion(
  m: MovimientoParaLaPlanilla,
  ctx: ContextoDeLaFila
): [string, string] {
  if (m.tipo === "entrada") {
    if (!ctx.carbonillero) {
      throw new Error("Una entrada necesita su carbonillero para escribirse en la planilla.");
    }
    return [ctx.carbonillero.codigo_planilla, ctx.carbonillero.nombre_planilla];
  }
  // Los `sin_separar` son historia importada y no se escriben: la planilla ya
  // los tiene. Si llegara uno acá es un error de quien llama.
  if (m.carbon === "sin_separar") {
    throw new Error("Un movimiento sin_separar no se escribe en la planilla: ya está.");
  }
  return m.tipo === "consumo"
    ? [CODIGOS_DE_CONSUMO[m.carbon], `CONSUMO ${m.carbon.toUpperCase()}`]
    : [CODIGOS_DE_AJUSTE[m.carbon], `AJUSTE ${m.carbon.toUpperCase()}`];
}

export function filaDeLaPlanilla(
  m: MovimientoParaLaPlanilla,
  ctx: ContextoDeLaFila
): CeldaDePlanilla[] {
  const [codigo, descripcion] = codigoYDescripcion(m, ctx);

  // El signo decide la columna, no el tipo: un ajuste en más suma como una
  // entrada y uno en menos resta como un consumo.
  const entradas = m.toneladas > 0 ? m.toneladas : "";
  const salidas = m.toneladas < 0 ? -m.toneladas : "";

  const serial = serialDelDia(m.fecha);
  if (serial === null) throw new Error(`La fecha ${m.fecha} no se puede escribir en la planilla.`);

  return [
    codigo,
    descripcion,
    entradas,
    salidas,
    ctx.saldoTotal,
    ctx.saldoVegetal,
    ctx.saldoResidual,
    serial,
    ctx.conteo ? ctx.conteo.contadas : "",
    ctx.conteo ? ctx.conteo.desvio : "",
  ];
}
