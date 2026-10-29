import { rangoDelMes } from "@/lib/core/fechas";

/**
 * Cómo se cuenta un día de ausencia en RRHH.
 *
 * LAS DOS REGLAS NO COINCIDEN, Y ES A PROPÓSITO. No es un error que haya que
 * arreglar ni una de las dos funciones que haya que poner de acuerdo con la
 * otra. Los dos reportes que RRHH lleva en la planilla de Google cuentan los
 * días distinto, y se copian tal cual están: se pidió que los números que ya
 * conocen no se muevan. Si alguien las iguala, cambian cifras que ya salieron.
 *
 * - El mensual (`diasEnElMes`) cuenta INCLUSIVE y PRORRATEA entre meses. Una
 *   licencia del 19 de diciembre al 2 de enero son 13 días en diciembre y 2 en
 *   enero.
 * - El anual (`diasDelAnual`) cuenta EXCLUSIVE (`hasta - desde`, sin el más
 *   uno) y le imputa la ausencia ENTERA al mes en que empieza
 *   (`mesDeImputacion`), sin partirla. La misma licencia son 14 días, todos en
 *   diciembre.
 *
 * Por eso una ausencia del 5 al 12 de enero vale 8 en uno y 7 en el otro. Y
 * como 97 de las 147 ausencias de la base son de un solo día, el anual las
 * cuenta en cero, y el mensual en uno.
 *
 * Las fechas son "YYYY-MM-DD" y se comparan como texto, que ordena bien; los
 * meses son "YYYY-MM". La resta de días va por UTC, que no tiene huso ni
 * horario de verano, así que no cambia el número de días.
 */

export interface Ausencia {
  empleado_id: string;
  fecha_desde: string; // "YYYY-MM-DD"
  fecha_hasta: string;
  tipo: string;
}

/** Días entre dos fechas ISO, sin contar el segundo extremo: `hasta - desde`. */
function diasEntre(desde: string, hasta: string): number {
  const ms = (iso: string) => {
    const [anio, mes, dia] = iso.split("-").map(Number);
    return Date.UTC(anio, mes - 1, dia);
  };
  return Math.round((ms(hasta) - ms(desde)) / 86_400_000);
}

/** Regla del reporte mensual: inclusive y prorrateada dentro de `mes` ("YYYY-MM"). */
export function diasEnElMes(a: Ausencia, mes: string): number {
  const { primerDia, ultimoDia } = rangoDelMes(mes);
  // Se recorta el rango contra el primero y el último día del mes.
  const inicio = a.fecha_desde > primerDia ? a.fecha_desde : primerDia;
  const fin = a.fecha_hasta < ultimoDia ? a.fecha_hasta : ultimoDia;
  if (inicio > fin) return 0;
  return diasEntre(inicio, fin) + 1;
}

/** Regla del reporte anual: exclusive, `hasta - desde`, sin el +1. */
export function diasDelAnual(a: Ausencia): number {
  return diasEntre(a.fecha_desde, a.fecha_hasta);
}

/** El mes al que el anual le imputa la ausencia entera: el del `fecha_desde`. */
export function mesDeImputacion(a: Ausencia): string {
  return a.fecha_desde.slice(0, 7);
}
