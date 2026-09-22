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
  /** Quién lo pidió, de la lista del pañol. */
  solicitanteId: string | null | undefined;
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

  if (m.tipo !== "ajuste" && !String(m.solicitanteId ?? "").trim()) {
    faltan.push("Falta quién lo pidió.");
  }

  return faltan;
}

/**
 * En cuánto queda el stock. `null` es "todavía no se puede decir".
 *
 * Un ajuste no suma ni resta: **fija** el número, que es lo que lo distingue de
 * una entrada o una salida.
 *
 * Vive acá por lo mismo que `loQueFalta`: la cuenta la tienen que hacer los dos
 * lados. El formulario la muestra en vivo mientras se escribe la cantidad, y la
 * ruta la necesita para poder decir en qué quedó — con la diferencia de que la
 * ruta ya tiene el número de verdad, el que devolvió el RPC después de bloquear
 * la fila, y no el que el navegador tenía cargado.
 */
export function stockQueQueda(
  tipo: TipoMovimiento,
  stockActual: number,
  cantidad: number | string | null | undefined
): number | null {
  const crudo = String(cantidad ?? "").trim();
  if (crudo === "") return null;
  const c = Number(crudo);
  if (!Number.isFinite(c)) return null;

  if (tipo === "entrada") return stockActual + c;
  if (tipo === "salida") return stockActual - c;
  return c;
}

/**
 * El aviso de que el stock quedó (o quedaría) bajo cero. `null` si no hay nada
 * que decir.
 *
 * **No bloquea, avisa.** Es la misma decisión que Producción tomó con la
 * producción negativa y Calidad con el saldo de carbonilla: un stock bajo cero
 * es un error de carga —una entrada que nunca se registró, un conteo viejo— y
 * recortarlo a cero escondería justo lo que hay que corregir. Además la
 * planilla manda: su stock es una fórmula sobre el kardex, así que rechazar la
 * salida en la app no impediría que el material igual haya salido del pañol.
 * Lo que sí hace falta es que se vea.
 *
 * Hasta el 22/09/2026 esto existía **sólo en el formulario**, calculado ahí
 * mismo con el stock que el navegador tenía cargado. O sea: la comprobación no
 * estaba del lado del servidor, y nada obliga a pasar por el formulario — una
 * pestaña vieja, o un POST a mano, dejaban el stock en negativo sin que nadie
 * se enterara. Es exactamente la asimetría que `loQueFalta` existe para evitar.
 */
export function avisoDeStockNegativo(stockResultante: number | null): string | null {
  if (stockResultante === null || stockResultante >= 0) return null;
  return `El stock queda en ${stockResultante}. Un stock negativo es un error de carga: falta registrar una entrada, o el conteo está viejo.`;
}

/**
 * Qué destino queda: el que se eligió a mano, y si no, el de quien retira.
 *
 * No se pregunta dos veces. Cada persona de la lista del pañol ya tiene el
 * suyo, así que el formulario lo completa solo y lo muestra; elegir uno en el
 * desplegable lo pisa, porque a veces el material lo retira el mecánico para
 * una máquina de Filler 2 y eso sólo lo sabe quien está parado ahí.
 *
 * Lo elegido gana **incluso cuando quien retira tiene destino**, que es todo el
 * punto de poder elegirlo. Y `""` no es una elección: es el desplegable en su
 * opción de arriba, que dice "según quién lo pidió".
 */
export function sectorDelMovimiento(
  destinoElegido: string | null | undefined,
  destinoDeQuienRetira: string | null | undefined
): string | null {
  const elegido = String(destinoElegido ?? "").trim();
  if (elegido) return elegido;

  const heredado = String(destinoDeQuienRetira ?? "").trim();
  return heredado || null;
}
