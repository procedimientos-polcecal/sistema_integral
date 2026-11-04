/**
 * El mes de órdenes de trabajo que ve quien elige la fecha de una OT: qué tiene
 * cada día y cuánta gente del taller hay.
 *
 * Funciones puras, sin base ni red. Las fechas son ISO "YYYY-MM-DD" y se
 * comparan como strings, nunca se parsean a `Date`.
 *
 * **Muestra órdenes y no eventos del calendario**, y no filtra por estado: para
 * decidir dónde poner la próxima importa todo lo que hay ese día, cerrado o no.
 * No hay que confundirla con el apilado de horarios de la Agenda, que cuenta
 * eventos —un conjunto distinto y más chico—.
 */

import { fechaParaElCalendario } from "@/lib/agenda/evento";
import { sumarDias } from "@/lib/core/fechas";
import type { GenteDelDia } from "./genteDelDia";

export interface DiaDelCalendario {
  dia: string;
  ordenes: {
    ot_number: number;
    especialidad: string | null;
    tipo: string | null;
    quien: string | null;
    descripcion: string | null;
    sector_raw: string | null;
    equipo_raw: string | null;
    /** true si ese día es parte de la ventana, no el inicio */
    arrastre: boolean;
  }[];
  gente: GenteDelDia;
}

/** Una fila de `ordenes_trabajo` como la lee la grilla. */
export interface OrdenDelCalendario {
  ot_number: number;
  fecha_ejecucion: string | null;
  fecha_ejecucion_pendiente: string | null;
  fecha_fin: string | null;
  especialidad: string | null;
  tipo: string | null;
  quien: string | null;
  descripcion: string | null;
  sector_raw: string | null;
  equipo_raw: string | null;
}

/**
 * Una OT ocupa todos los días de su ventana: del inicio a `fecha_fin` inclusive.
 *
 * Sin `fecha_fin` es un solo día —vacía quiere decir «dura un día», no que
 * falte el dato—. Una `fecha_fin` anterior al inicio es dato sucio de la
 * planilla y se trata igual, un solo día: inventar un rango al revés es peor
 * que no mostrar la ventana.
 */
export function diasQueOcupa(fechaInicio: string, fechaFin: string | null): string[] {
  if (!fechaFin || fechaFin <= fechaInicio) return [fechaInicio];
  const dias: string[] = [];
  for (let d = fechaInicio; d <= fechaFin; d = sumarDias(d, 1)) dias.push(d);
  return dias;
}

/**
 * Un día por cada fecha de `desde` a `hasta` inclusive, tenga o no órdenes: una
 * grilla con huecos obliga a la pantalla a rellenarlos, y un día vacío es justo
 * lo que quien elige quiere ver.
 *
 * Una orden cuenta en cada día de su ventana. **`arrastre` es «este día no es
 * el inicio»**, y se decide contra el inicio verdadero y no contra el borde del
 * rango: una orden que empezó el 30/10 y termina el 02/11 es continuación el
 * 01/11 aunque el primer día que se pidió sea ése.
 *
 * El inicio es `fechaParaElCalendario`: la pendiente que el SdG fijó y la
 * planilla todavía no devolvió, y si no, la de la planilla. Una orden sin
 * ninguna fecha no aparece. Un día que no está en `gentePorDia` queda como «no
 * sé», nunca como cero.
 */
export function armarElCalendario(
  ordenes: OrdenDelCalendario[],
  desde: string,
  hasta: string,
  gentePorDia: Map<string, GenteDelDia>,
): DiaDelCalendario[] {
  const dias = new Map<string, DiaDelCalendario>();
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) {
    dias.set(d, { dia: d, ordenes: [], gente: gentePorDia.get(d) ?? { sabemos: false } });
  }

  for (const o of ordenes) {
    const inicio = fechaParaElCalendario(o);
    if (!inicio) continue;

    // Se recorta al rango antes de enumerar: una `fecha_fin` de 2099 en una
    // celda mal tipeada no puede costar treinta mil días. El inicio verdadero
    // se conserva aparte para saber qué es arrastre.
    const fin = o.fecha_fin && o.fecha_fin > hasta ? hasta : o.fecha_fin;
    // Una ventana que terminó antes del rango no toca ningún día de él; sin
    // este corte, recortar el inicio a `desde` la dejaría pintada ahí.
    if (inicio < desde && fin && fin < desde) continue;
    const primero = inicio < desde ? desde : inicio;
    for (const dia of diasQueOcupa(primero, fin)) {
      dias.get(dia)?.ordenes.push({
        ot_number: o.ot_number,
        especialidad: o.especialidad,
        tipo: o.tipo,
        quien: o.quien,
        descripcion: o.descripcion,
        sector_raw: o.sector_raw,
        equipo_raw: o.equipo_raw,
        arrastre: dia !== inicio,
      });
    }
  }

  return [...dias.values()];
}
