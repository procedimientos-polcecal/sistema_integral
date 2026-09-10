import type { PorRenglon } from "./types";

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
  /**
   * Precondición que no se puede chequear acá: el depósito tiene que venir
   * completo, con una fila por cada producto activo aunque sea 0. Si un
   * producto está en `depositoAnterior` y falta en `deposito`, el `?? 0` de
   * abajo lo lee como "se contó cero" en lugar de "no se contó", y la
   * producción sale como el negativo del stock anterior. Es defendible —
   * sale en rojo y alguien lo corrige — pero la garantía la tiene que dar
   * quien arma la carga, no esta función.
   */
  deposito: PorRenglon;
  /** El depósito del parte anterior. `null` = ese parte no existe todavía. */
  depositoAnterior: PorRenglon | null;
  despachado: PorRenglon;
  rotura: PorRenglon;
}

export type ProduccionDelRenglon =
  | { estado: "calculada"; cantidad: number }
  | { estado: "sin_parte_anterior" }
  /** Sólo la devuelve `produccionDelDia`: le falta el parte de un turno entero. */
  | { estado: "dia_incompleto" };

export type ProduccionPorRenglon = Record<string, ProduccionDelRenglon>;

export function produccionDelTurno(e: EntradaDelTurno): ProduccionPorRenglon {
  const ids = new Set([
    ...Object.keys(e.deposito),
    ...Object.keys(e.depositoAnterior ?? {}),
    ...Object.keys(e.despachado),
    ...Object.keys(e.rotura),
  ]);

  const salida: ProduccionPorRenglon = {};
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

/**
 * El día es la suma de sus turnos. Si a uno le falta el anterior, el día
 * tampoco se puede — eso ya lo manejaba `sin_parte_anterior`. Pero un turno
 * que no se cargó y un turno cargado sin renglonesDePapel son los dos `{}`, y sin
 * distinguirlos un día al que le falta un turno entero se calculaba con lo
 * poco que había y mentía como si fuera el día completo. Por eso un turno
 * faltante se pasa como `null`, no como `{}`.
 */
export function produccionDelDia(
  turnos: readonly (ProduccionPorRenglon | null)[]
): ProduccionPorRenglon {
  const salida: ProduccionPorRenglon = {};

  if (turnos.some((t) => t === null)) {
    // El día no cierra. Todo producto que aparezca en algún turno sí cargado
    // queda "dia_incompleto" — sin importar si ese turno en particular se
    // pudo calcular o le faltaba a su vez el parte anterior. Se prefiere
    // "dia_incompleto" por sobre "sin_parte_anterior" porque describe la
    // causa real acá: no es que falte un dato para restar, es que falta un
    // turno entero del día.
    for (const turno of turnos) {
      if (turno === null) continue;
      for (const id of Object.keys(turno)) {
        salida[id] = { estado: "dia_incompleto" };
      }
    }
    return salida;
  }

  for (const turno of turnos as readonly ProduccionPorRenglon[]) {
    for (const [id, p] of Object.entries(turno)) {
      const acumulado = salida[id];
      if (p.estado === "sin_parte_anterior" || acumulado?.estado === "sin_parte_anterior") {
        salida[id] = { estado: "sin_parte_anterior" };
        continue;
      }
      // produccionDelTurno nunca devuelve "dia_incompleto"; si llegara,
      // no hay nada que sumar.
      if (p.estado !== "calculada") continue;
      const cantidadAcumulada = acumulado?.estado === "calculada" ? acumulado.cantidad : 0;
      salida[id] = { estado: "calculada", cantidad: cantidadAcumulada + p.cantidad };
    }
  }
  return salida;
}

/** Sólo lo calculado, para exportar a la planilla. Lo no calculable no se exporta. */
export function soloLoCalculado(p: ProduccionPorRenglon): Record<string, number> {
  const salida: Record<string, number> = {};
  for (const [id, v] of Object.entries(p)) {
    if (v.estado === "calculada") salida[id] = v.cantidad;
  }
  return salida;
}
