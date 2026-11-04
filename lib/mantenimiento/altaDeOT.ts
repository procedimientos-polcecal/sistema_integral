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
  /**
   * Cuándo se compromete a **empezar**. Sin ella la OT no se atrasa nunca.
   *
   * Por dentro se sigue llamando `fecha_ejecucion` y en pantalla es «la fecha
   * de inicio» desde el 02/11/2026, cuando la columna J de la planilla pasó de
   * «FECHA DE EJECUCIÓN» a «FECHA DE INICIO». Es la misma fecha con mejor
   * nombre: renombrar la columna arrastraría el MTBF, el contraste, el GUT y
   * la programación del taller sin cambiar nada de lo que hacen.
   */
  fecha_ejecucion: string | null | undefined;
  /**
   * Cuándo se estima que **termina**. Obligatoria desde el 04/11/2026.
   *
   * No es la de cierre: ésa es la real, y ésta la estimación que se carga al
   * crear la orden. **Nació opcional** con el argumento de que quien carga una
   * OT no siempre sabe cuándo termina y un campo obligatorio que no se sabe se
   * llena con cualquier cosa. Se pidió al revés dos días después, y el
   * argumento viejo queda escrito acá porque es el que hay que contestar si
   * alguien propone sacarla: lo que se gana es que toda orden cargada a mano
   * tenga ventana, y lo que se arriesga es una fecha puesta de compromiso.
   *
   * **Obligatoria sólo donde completa una persona**, que es lo que la hace
   * sostenible: los cuatro generadores automáticos —los periódicos, el
   * cuaderno, los partes de contratista y los grupos del cuaderno— arman el
   * registro sin pasar por `loQueFaltaParaCrear`, así que ninguno se cayó al
   * volverla obligatoria. El de los periódicos dice por qué en su propio
   * comentario: «el periódico sabe cuándo arranca, no cuánto dura».
   *
   * **La clave es obligatoria en el tipo aunque el valor pueda faltar**, y eso
   * no es una sutileza: el día que se volvió obligatoria, la ruta del alta
   * seguía armando el objeto sin nombrarla, así que la regla la veía
   * `undefined` y **habría rechazado todas las órdenes del sistema**. Con la
   * clave opcional, `tsc` no decía nada — es la misma forma del bug del
   * 19/10/2026, cuando la regla creció y el botón de los avisos se quedó atrás
   * en silencio. Exigir la clave y permitir el valor vacío deja que el
   * compilador nombre a quien se olvide, y que la regla nombre a quien la
   * mande vacía. Una carga sin señal encolada antes de que el campo existiera
   * vuelve sin ella: llega como `undefined` y recibe un 400 que la nombra.
   */
  fecha_fin: string | null | undefined;
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
  ["fecha_ejecucion", "la fecha de inicio"],
  // Las dos juntas y en este orden: son el par de una ventana estimada, y en
  // los cuatro formularios están una al lado de la otra.
  ["fecha_fin", "la fecha de fin estimada"],
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

/**
 * Lo que una orden nueva dice y se contradice.
 *
 * Va aparte de `loQueFaltaParaCrear` porque es otra clase de problema, y
 * mezclarlas daría un mensaje falso: aquello dice que **falta** un dato, y un
 * «Falta cargar la fecha de fin» cuando la fecha está cargada —sólo que dada
 * vuelta— manda a buscar lo que no es.
 *
 * Nombra **las dos fechas**: decir «la fecha de fin es anterior» obliga a
 * volver al formulario a ver contra qué, y la que está mal puede ser
 * cualquiera de las dos.
 *
 * No mira la de cierre, que es la fecha real: esto compara la ventana
 * estimada contra sí misma. Y si falta la de inicio se calla, porque de eso ya
 * habla `loQueFaltaParaCrear` y dos mensajes por un solo hueco es ruido.
 */
export function loQueSeContradice(datos: DatosDelAltaDeOT): string[] {
  const inicio = String(datos.fecha_ejecucion ?? "").trim();
  const fin = String(datos.fecha_fin ?? "").trim();
  if (!inicio || !fin) return [];

  return fin < inicio
    ? [`la fecha de fin (${fin}) es anterior a la de inicio (${inicio})`]
    : [];
}
