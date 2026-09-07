import type { PorProducto } from "./types";

/**
 * Despejar la producción de un turno.
 *
 * Ni el papel ni el Excel anotan lo producido: sale de la cuenta
 *
 *     producción = depósito − depósito anterior + despachado + rotura
 *
 * El "depósito anterior" es el del parte anterior en orden cronológico, y **no
 * se guarda en ningún lado**: se lee. Guardarlo es el error del Excel, donde
 * vive en una columna oculta única por producto que el script pisa al guardar y
 * que se desincroniza sin avisar.
 */

export interface EntradaDelTurno {
  deposito: PorProducto;
  /** El depósito del parte anterior. `null` = ese parte no existe todavía. */
  depositoAnterior: PorProducto | null;
  despachado: PorProducto;
  rotura: PorProducto;
}

export type ProduccionDelProducto =
  | { estado: "calculada"; cantidad: number }
  | { estado: "sin_parte_anterior" };

export type ProduccionPorProducto = Record<string, ProduccionDelProducto>;

export function produccionDelTurno(e: EntradaDelTurno): ProduccionPorProducto {
  const ids = new Set([
    ...Object.keys(e.deposito),
    ...Object.keys(e.depositoAnterior ?? {}),
    ...Object.keys(e.despachado),
    ...Object.keys(e.rotura),
  ]);

  const salida: ProduccionPorProducto = {};
  for (const id of ids) {
    // Sin el parte anterior no hay resta posible. Devolver 0 sería inventar un
    // día sin producción, que es indistinguible de un día bien cargado.
    if (e.depositoAnterior === null) {
      salida[id] = { estado: "sin_parte_anterior" };
      continue;
    }
    salida[id] = {
      estado: "calculada",
      // Puede dar negativo, y se devuelve negativo: es un error de carga y la
      // pantalla lo muestra en rojo. Recortarlo a cero lo esconde.
      cantidad:
        (e.deposito[id] ?? 0) -
        (e.depositoAnterior[id] ?? 0) +
        (e.despachado[id] ?? 0) +
        (e.rotura[id] ?? 0),
    };
  }
  return salida;
}

/** El día es la suma de sus turnos. Si a uno le falta el anterior, el día tampoco se puede. */
export function produccionDelDia(
  turnos: readonly ProduccionPorProducto[]
): ProduccionPorProducto {
  const salida: ProduccionPorProducto = {};

  for (const turno of turnos) {
    for (const [id, p] of Object.entries(turno)) {
      const acumulado = salida[id];
      if (p.estado === "sin_parte_anterior" || acumulado?.estado === "sin_parte_anterior") {
        salida[id] = { estado: "sin_parte_anterior" };
        continue;
      }
      salida[id] = {
        estado: "calculada",
        cantidad: (acumulado?.cantidad ?? 0) + p.cantidad,
      };
    }
  }
  return salida;
}

/** Sólo lo calculado, para exportar a la planilla. Lo no calculable no se exporta. */
export function soloLoCalculado(p: ProduccionPorProducto): Record<string, number> {
  const salida: Record<string, number> = {};
  for (const [id, v] of Object.entries(p)) {
    if (v.estado === "calculada") salida[id] = v.cantidad;
  }
  return salida;
}
