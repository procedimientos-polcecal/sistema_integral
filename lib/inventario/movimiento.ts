/**
 * Qué hace falta para que un movimiento se pueda registrar, y de dónde sale el
 * sector.
 *
 * Vive acá y no en el formulario porque lo tienen que aplicar los dos lados. El
 * formulario, para no dejar apretar Registrar; y la ruta, porque nada obliga a
 * pasar por el formulario. Si la regla existiera sólo en la pantalla, un POST
 * a mano dejaría una fila incompleta en la planilla y ahí no hay quien la
 * arregle: la lee gente que no entra al sistema.
 */

export type TipoMovimiento = "entrada" | "salida" | "ajuste";

export interface MovimientoEnCurso {
  /** El id del artículo, que es lo mismo que decir el código. */
  articuloId: string | null | undefined;
  tipo: TipoMovimiento;
  /** Como lo escribió la persona: "" es "no puso nada", que no es cero. */
  cantidad: number | string | null | undefined;
  /** Quién lo pidió, del padrón. */
  empleadoId: string | null | undefined;
}

/**
 * Qué le falta. Lista vacía es que está listo.
 *
 * **Quién lo pidió es obligatorio en una entrada y en una salida.** No es
 * burocracia: es la columna F del kardex, y de las 3.794 filas que la planilla
 * ya tiene, 3.793 la traen llena. Dejarla vacía desde la app sería empeorar un
 * documento que hoy está completo, y es además de donde sale el sector.
 *
 * En un **ajuste** no se pide: un ajuste no lo pide nadie, es alguien contando
 * de nuevo. Ahí el campo queda opcional y anota quién contó.
 */
export function loQueFalta(m: MovimientoEnCurso): string[] {
  const faltan: string[] = [];

  if (!String(m.articuloId ?? "").trim()) faltan.push("Elegí el artículo.");

  const crudo = String(m.cantidad ?? "").trim();
  const n = crudo === "" ? NaN : Number(crudo);

  if (!Number.isFinite(n)) {
    faltan.push(m.tipo === "ajuste" ? "Poné cuánto hay en realidad." : "Poné la cantidad.");
  } else if (m.tipo === "ajuste") {
    if (n < 0) faltan.push("El ajuste no puede ser negativo.");
  } else if (n <= 0) {
    faltan.push("La cantidad tiene que ser mayor a cero.");
  }

  if (m.tipo !== "ajuste" && !String(m.empleadoId ?? "").trim()) {
    faltan.push("Falta quién lo pidió.");
  }

  return faltan;
}

/**
 * Qué sector queda: el que se eligió a mano, y si no, el del empleado.
 *
 * El sector no se pregunta dos veces. Quien retira ya está asignado a uno en el
 * padrón, así que el formulario lo completa solo y lo muestra; elegir uno en el
 * desplegable lo pisa, porque a veces el material lo retira alguien de
 * Mantenimiento para una máquina de Filler 2 y eso sólo lo sabe quien está ahí.
 *
 * Lo elegido gana **incluso cuando el empleado tiene sector**, que es todo el
 * punto de poder elegirlo. Y `""` no es una elección: es el desplegable en su
 * opción de arriba, que dice "según quién lo pidió".
 */
export function sectorDelMovimiento(
  sectorElegido: string | null | undefined,
  sectorDelEmpleado: string | null | undefined
): string | null {
  const elegido = String(sectorElegido ?? "").trim();
  if (elegido) return elegido;

  const heredado = String(sectorDelEmpleado ?? "").trim();
  return heredado || null;
}
