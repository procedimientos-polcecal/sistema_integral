import { sumarDias } from "@/lib/core/fechas";
import { TURNOS, parteAnterior, type ClaveDeParte } from "./turnos";
import { totalesDeDespacho, roturaTotal } from "./despachos";
import {
  produccionDelTurno,
  produccionDelDia,
  soloLoCalculado,
  type ProduccionPorRenglon,
} from "./produccion";
import type { Despacho, Turno } from "./types";

/**
 * La matriz del mes, armada en memoria y sin hablar con la base.
 *
 * `armarElMes` (en `consultas.ts`) es la que trae los datos: el rango entero
 * de una sola vez, con `.in()` sobre a lo sumo 62 ids. Esta función es la que
 * decide, con las filas ya bajadas — por eso tiene tests, siguiendo la regla
 * del repo de sacar la lógica de la ruta a `lib/` para poder probarla sin red.
 *
 * Reusa las mismas piezas que `armarElDia` y que la exportación a la
 * planilla — `totalesDeDespacho`, `roturaTotal`, `produccionDelTurno`,
 * `produccionDelDia`, `soloLoCalculado` —: si la pantalla y la planilla
 * alguna vez muestran números distintos para el mismo día, es porque los
 * datos cambiaron en el medio, no porque haya dos cuentas.
 */

export interface FilaParte {
  id: string;
  /** "YYYY-MM-DD" */
  fecha: string;
  turno: Turno;
}

export interface FilaDeposito {
  parte_id: string;
  renglon_papel_id: string;
  cantidad: number;
}

export interface DiaDelMes {
  /** "YYYY-MM-DD" */
  fecha: string;
  /** Los tres estados, igual que en la pantalla del día: no se reduce acá. */
  produccion: ProduccionPorRenglon;
  /**
   * La misma reducción que exporta la planilla (`soloLoCalculado`). Es contra
   * esto, y no contra `produccion`, que se calcula el % de rotura del día: es
   * lo que hace `espejarDia`, y calcular el % contra otra cosa sería un
   * segundo criterio de "sin producción" que puede divergir del primero.
   */
  produccionCalculada: Record<string, number>;
  despacho: Record<string, number>;
  rotura: Record<string, number>;
  /**
   * Cuántos de los dos turnos del día tienen parte cargado (0, 1 o 2).
   *
   * `despacho` y `rotura` son sumas planas: un día sin ningún parte y un día
   * con parte y cero despachos dan exactamente el mismo `{}`/0, y sin esto la
   * pantalla no tiene forma de distinguirlos aunque quisiera. `produccion` no
   * lo necesita para eso — ya tiene sus propios estados —, pero `despacho` y
   * `rotura` no.
   */
  turnosCargados: number;
}

export interface ArmarLosDiasArgs {
  /** "YYYY-MM-DD" */
  primerDia: string;
  /** "YYYY-MM-DD" */
  ultimoDia: string;
  /** Los partes cargados en el rango, tal como vienen de `produccion_partes`. */
  partes: readonly FilaParte[];
  /** Los renglones de depósito de esos mismos partes. */
  filasDeposito: readonly FilaDeposito[];
  /** Los despachos de esos mismos partes. */
  despachos: readonly Despacho[];
  /**
   * El depósito del turno `12_20` del último día del mes anterior — el único
   * dato que el rango del mes no trae por sí solo, porque el turno `4_12` del
   * día 1 se despeja contra él. `null` si ese parte no existe.
   */
  depositoAnteriorAlMes: Record<string, number> | null;
}

/** La clave de un parte, para no repetir la concatenación en cada mapa. */
function claveDe(c: ClaveDeParte): string {
  return `${c.fecha}|${c.turno}`;
}

export function armarLosDias(args: ArmarLosDiasArgs): DiaDelMes[] {
  const { primerDia, ultimoDia, partes, filasDeposito, despachos, depositoAnteriorAlMes } = args;

  const depositoPorParte = new Map<string, Record<string, number>>();
  for (const f of filasDeposito) {
    const d = depositoPorParte.get(f.parte_id) ?? {};
    d[f.renglon_papel_id] = Number(f.cantidad);
    depositoPorParte.set(f.parte_id, d);
  }

  const despachosPorParte = new Map<string, Despacho[]>();
  for (const d of despachos) {
    const arr = despachosPorParte.get(d.parte_id) ?? [];
    arr.push(d);
    despachosPorParte.set(d.parte_id, arr);
  }

  // La constraint `unique (fecha, turno)` garantiza a lo sumo un parte por
  // clave: el mapa nunca pisa un id con otro.
  const parteIdPorClave = new Map<string, string>();
  for (const p of partes) parteIdPorClave.set(claveDe({ fecha: p.fecha, turno: p.turno }), p.id);

  /** El depósito de un parte del mes, o `null` si ese turno no está cargado. */
  function depositoDentroDelMes(clave: ClaveDeParte): Record<string, number> | null {
    const parteId = parteIdPorClave.get(claveDe(clave));
    // `?? {}` y no "no existe": un parte cargado sin renglones de depósito
    // (no debería pasar, pero si pasara) es un depósito vacío, no un turno
    // sin cargar.
    return parteId ? depositoPorParte.get(parteId) ?? {} : null;
  }

  const dias: DiaDelMes[] = [];
  for (let fecha = primerDia; fecha <= ultimoDia; fecha = sumarDias(fecha, 1)) {
    const despacho: Record<string, number> = {};
    const rotura: Record<string, number> = {};
    const porTurno: (ProduccionPorRenglon | null)[] = [];
    let turnosCargados = 0;

    for (const turno of TURNOS) {
      const clave: ClaveDeParte = { fecha, turno };
      const parteId = parteIdPorClave.get(claveDe(clave));
      if (!parteId) {
        porTurno.push(null);
        continue;
      }
      turnosCargados++;

      const totales = totalesDeDespacho(despachosPorParte.get(parteId) ?? []);
      const roturas = roturaTotal(totales);

      for (const [id, v] of Object.entries(totales.despachado)) {
        despacho[id] = (despacho[id] ?? 0) + v;
      }
      for (const [id, v] of Object.entries(roturas)) {
        rotura[id] = (rotura[id] ?? 0) + v;
      }

      const anterior = parteAnterior(clave);
      // Sólo el turno 4_12 del día 1 del mes mira para atrás del rango
      // traído: para cualquier otro turno el anterior ya está en `partes`.
      const depositoAnterior =
        anterior.fecha < primerDia ? depositoAnteriorAlMes : depositoDentroDelMes(anterior);

      porTurno.push(
        produccionDelTurno({
          deposito: depositoPorParte.get(parteId) ?? {},
          depositoAnterior,
          despachado: totales.despachado,
          rotura: roturas,
        })
      );
    }

    const produccion = produccionDelDia(porTurno);
    dias.push({
      fecha,
      produccion,
      produccionCalculada: soloLoCalculado(produccion),
      despacho,
      rotura,
      turnosCargados,
    });
  }

  return dias;
}
