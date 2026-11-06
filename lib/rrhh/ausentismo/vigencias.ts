import { esFechaIso } from "@/lib/core/fechas";

/**
 * Las reglas del catálogo `rrhh_horas_a_realizar` que la base no impone.
 *
 * La migración 20261029112043 sólo exige `horas_por_empleado > 0` y que el
 * rango no esté invertido; que dos vigencias del mismo sector no se pisen no
 * está ahí (un `exclude using gist` pide `btree_gist`, y para una veintena de
 * filas que edita una persona se eligió validar en la ruta, donde se puede
 * decir en castellano qué choca). Una migración aplicada no se edita, así que
 * estas reglas viven acá, y **quien escriba a la tabla por otro camino se las
 * salta**.
 *
 * El porqué de la vigencia está en la migración: un mes ya reportado se calcula
 * con las horas que regían en ese mes. Dos filas vigentes a la vez para el mismo
 * sector harían que `horasVigentes` de `reportes.ts` elija "la que empezó más
 * tarde" sin que nadie lo haya decidido: el divisor del titular dependería de
 * un desempate silencioso.
 */

export interface Vigencia {
  desde: string;
  hasta: string | null;
}

/** El tope de `horas_por_empleado`: las horas de un mes de 31 días. */
export const MAXIMO_DE_HORAS = 744;

/** Si dos vigencias comparten algún día. Los extremos son inclusivos; `null` es sin fin. */
export function seSuperponen(a: Vigencia, b: Vigencia): boolean {
  const aTerminaAntes = a.hasta !== null && a.hasta < b.desde;
  const bTerminaAntes = b.hasta !== null && b.hasta < a.desde;
  return !aTerminaAntes && !bTerminaAntes;
}

/** La primera de `otras` que se pisa con `nueva`, o `undefined`. */
export function primeraQueSeSuperpone<T extends Vigencia>(
  otras: readonly T[],
  nueva: Vigencia,
): T | undefined {
  return otras.find((o) => seSuperponen(o, nueva));
}

/**
 * Las horas como número, o `null` si no son un número positivo y razonable.
 *
 * Acepta un número y un texto numérico con punto ("7.5"); no acepta coma ni
 * vacío: `Number("")` es 0 y `Number("7,5")` es NaN, y los dos son el mismo
 * error de quien carga, que se dice en vez de adivinarse.
 */
export function horasValidas(valor: unknown): number | null {
  const n =
    typeof valor === "number"
      ? valor
      : typeof valor === "string" && valor.trim() !== ""
        ? Number(valor)
        : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > MAXIMO_DE_HORAS) return null;
  return n;
}

/**
 * Los problemas de una vigencia ya armada, en castellano, **todos juntos**.
 * Vacío si está bien. Mira `desde` y `hasta` como llegaron, así que sirve para
 * lo que viene del cuerpo y para la fila que resulta de un cambio.
 */
export function problemasDeLaVigencia(v: {
  horas: unknown;
  desde: unknown;
  hasta: unknown;
}): string[] {
  const problemas: string[] = [];

  if (horasValidas(v.horas) === null) {
    problemas.push(
      `Las horas por empleado tienen que ser un número mayor que 0 y no más de ${MAXIMO_DE_HORAS}, que son las horas de un mes de 31 días.`,
    );
  }
  const desdeOk = esFechaIso(v.desde);
  if (!desdeOk) problemas.push("La fecha desde falta o no es válida: tiene que ser AAAA-MM-DD.");
  const hastaOk = v.hasta === null || esFechaIso(v.hasta);
  if (!hastaOk) problemas.push("La fecha hasta no es válida: tiene que ser AAAA-MM-DD, o quedar vacía si sigue vigente.");
  if (desdeOk && hastaOk && v.hasta !== null && (v.hasta as string) < (v.desde as string)) {
    problemas.push("La fecha hasta no puede ser anterior a la fecha desde.");
  }
  return problemas;
}
