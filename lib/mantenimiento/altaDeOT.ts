/**
 * Lo que una orden de trabajo tiene que decir para poder existir.
 *
 * Hasta el 19/10/2026 lo único obligatorio era la descripción, y el resto
 * llegaba vacío a la planilla. Son justo los campos de los que vive todo lo que
 * vino después: una OT **sin equipo** no se puede contar contra ninguna máquina
 * —ni para el MTBF ni para su ficha—, una **sin fecha de ejecución** no se puede
 * dar por atrasada nunca, y una **sin sector** no suma a las horas de nadie.
 *
 * El costo de haberlos tenido opcionales se ve en los números: de las órdenes
 * importadas, 368 no tienen equipo enlazado.
 */

import { loQueFaltaParaCerrar, type DatosDelCierre } from "@/lib/mantenimiento/cierreDeOT";

export interface DatosDelAltaDeOT extends DatosDelCierre {
  sector_id: string | null | undefined;
  equipment_id: string | null | undefined;
  descripcion: string | null | undefined;
  especialidad: string | null | undefined;
  tipo: string | null | undefined;
  /** Cuándo se compromete a hacerse. Sin ella la OT no se atrasa nunca. */
  fecha_ejecucion: string | null | undefined;
}

/**
 * Los obligatorios, con el nombre que tienen en pantalla y en el orden en que
 * aparecen. El orden importa: una lista que nombra los campos salteados en el
 * orden del formulario se recorre de arriba abajo una sola vez.
 */
const IMPRESCINDIBLES: readonly [keyof DatosDelAltaDeOT, string][] = [
  ["sector_id", "el sector"],
  ["equipment_id", "el equipo"],
  ["descripcion", "la descripción"],
  ["especialidad", "la especialidad"],
  ["tipo", "el tipo de trabajo"],
  ["quien", "quién lo realiza"],
  ["fecha_ejecucion", "la fecha de ejecución"],
];

/**
 * Qué le falta a una orden nueva, todo junto.
 *
 * **Junto y no de a uno**, que es la vara de `validar()` del núcleo: contestar
 * un formulario siete veces para que te digan siete cosas es lo que hace que la
 * gente lo complete de cualquier manera.
 *
 * Arrastra lo que exige el cierre —las horas y quién la hizo, cuando viene con
 * fecha de cierre— para que salga **una sola lista y un solo mensaje**. Que un
 * campo sea obligatorio siempre o sólo al cerrar es una distinción del código,
 * no de quien está completando.
 */
export function loQueFaltaParaCrear(datos: DatosDelAltaDeOT): string[] {
  const falta = IMPRESCINDIBLES
    .filter(([campo]) => String(datos[campo] ?? "").trim() === "")
    .map(([, nombre]) => nombre);

  return [...falta, ...loQueFaltaParaCerrar(datos)];
}
