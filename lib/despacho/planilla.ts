import type { Clasificacion, OrdenDeCarga } from "./types";
import { textoDeClasificacion } from "./clasificacion";

/**
 * La planilla `Órdenes de Carga`: cómo se lee y cómo se escribe.
 *
 * **Acá manda el sistema.** Es un espejo de una sola vía, igual que Producción
 * y al revés que Compras e Inventario: la planilla queda como el lugar donde
 * miran los que no entran al sistema.
 *
 * TODAVÍA NO SE PUDO LEER EL LIBRO. No está compartido con la cuenta de
 * servicio y las credenciales de Google sólo existen en el deploy, así que dos
 * cosas de acá son **supuestos declarados** y no relevamiento:
 *
 *   1. La columna `Material` se escribe como los tres campos separados por un
 *      espacio ("Filler A granel"). Es lo que el papel pide tildado y lo que
 *      alguien transcribiría; si el libro usa otra convención, se cambia
 *      `textoDeClasificacion` y estos tests.
 *   2. `Tiempo de Carga` y `Tiempo en Predio` son fórmulas, así que no se
 *      escriben. Si resultaran datos escritos a mano, hay que agregarlos al
 *      rango — y en ese caso conviene igual dejarlos como fórmula, por el mismo
 *      motivo por el que Inventario lee la columna de stock en vez de
 *      recalcularla.
 */

/** Los once encabezados, en el orden real del libro. */
export const COLUMNAS = [
  "Fecha Orden",
  "Nro de Orden",
  "Cliente",
  "Material",
  "Hora comienzo de Carga",
  "Hora Salida de carga",
  "Hora Ingreso al predio",
  "Hora Salida del Predio",
  "Observaciones",
  "Tiempo de Carga",
  "Tiempo en Predio",
] as const;

/**
 * Se escribe A:I. J y K se dejan intactas porque son fórmulas.
 *
 * Y ojo con el orden: **las columnas de carga vienen antes que las de predio**,
 * al revés de como ocurren los hechos. Escribir los cuatro horarios "en orden"
 * pondría la entrada al predio en la columna del inicio de carga y daría vuelta
 * los dos tiempos sin que nada falle.
 */
export const RANGO_QUE_SE_ESCRIBE = { primera: "A", ultima: "I" } as const;

/** Hora de Argentina = UTC−3, sin horario de verano. Igual que `lib/core/fechas.ts`. */
const OFFSET_ARGENTINA_MS = 3 * 60 * 60 * 1000;

/** "10:20" en hora de Argentina. Vacío si el horario no está marcado. */
export function horaComoSeEscribe(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  return new Date(t - OFFSET_ARGENTINA_MS).toISOString().slice(11, 16);
}

/** "8/9/2026": d/m, como la planilla. Nunca m/d — eso dio vuelta 885 fechas en Compras. */
export function fechaComoSeEscribe(fecha: string): string {
  const m = fecha.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${Number(m[3])}/${Number(m[2])}/${m[1]}`;
}

/**
 * La fila que va a la planilla: nueve celdas, A a I.
 *
 * Sin clasificación cae al nombre crudo del producto en vez de dejar la celda
 * vacía: la planilla la sigue leyendo gente, y "FILLER A GRANEL" les dice algo,
 * el vacío no. En el sistema esa orden se ve como "sin clasificar".
 */
export function filaDeLaPlanilla(orden: OrdenDeCarga, clasificacion: Clasificacion | null): string[] {
  const material = clasificacion
    ? textoDeClasificacion(clasificacion)
    : (orden.producto_raw ?? "");

  return [
    fechaComoSeEscribe(orden.fecha),
    orden.numero,
    orden.cliente_raw ?? "",
    material,
    horaComoSeEscribe(orden.inicio_carga),
    horaComoSeEscribe(orden.fin_carga),
    horaComoSeEscribe(orden.entrada_predio),
    horaComoSeEscribe(orden.salida_predio),
    orden.notas ?? "",
  ];
}

/**
 * Una hora de la planilla, convertida en instante, para importar el histórico.
 *
 * Las columnas de hora **no traen fecha**: hay que pegarles la de la orden. Y de
 * ahí sale la trampa que resuelve `anterior`: un camión que entra 23:40 y sale
 * 00:30 daría, con la misma fecha para los dos, un tiempo en predio de menos
 * catorce horas. La regla es que **si un horario es menor que el que lo
 * precede, es del día siguiente**.
 *
 * Acepta texto ("7:35", "07:35:00") y el serial de Sheets, que para una celda
 * de hora es una fracción del día (0.5 = mediodía) y para una de fecha y hora
 * son días más fracción.
 */
export function parsearHoraDePlanilla(
  valor: unknown,
  fecha: string,
  anterior?: string | null
): string | null {
  const minutos = minutosDelDia(valor);
  if (minutos === null) return null;

  const base = new Date(`${fecha}T00:00:00.000Z`).getTime();
  if (isNaN(base)) return null;

  let instante = base + OFFSET_ARGENTINA_MS + minutos * 60000;

  if (anterior) {
    const previo = new Date(anterior).getTime();
    // Estrictamente menor: dos horarios iguales son un camión que entró y salió
    // en el mismo minuto, no uno que se quedó veinticuatro horas.
    if (!isNaN(previo) && instante < previo) instante += 24 * 60 * 60 * 1000;
  }

  return new Date(instante).toISOString();
}

/** Minutos desde la medianoche, o null si la celda no es una hora. */
function minutosDelDia(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;

  if (typeof valor === "number" && !isNaN(valor)) {
    const fraccion = valor - Math.floor(valor);
    return Math.round(fraccion * 24 * 60);
  }

  const s = String(valor).trim();
  if (s === "") return null;

  const hm = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hm) {
    const h = Number(hm[1]);
    const m = Number(hm[2]);
    if (h > 23 || m > 59) return null;
    return h * 60 + m;
  }

  // Un número que llegó como texto ("0,5" o "0.5") sigue siendo un serial.
  const n = Number(s.replace(",", "."));
  if (!isNaN(n)) {
    const fraccion = n - Math.floor(n);
    return Math.round(fraccion * 24 * 60);
  }

  return null;
}
