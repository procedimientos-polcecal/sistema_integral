import type { Clasificacion } from "@/lib/core/types";
import type { OrdenDeCarga } from "./types";
import { textoParaLaPlanilla } from "./clasificacion";

/**
 * La planilla `Órdenes de Carga`: cómo se lee y cómo se escribe.
 *
 * **Acá manda el sistema.** Es un espejo de una sola vía, igual que Producción
 * y al revés que Compras e Inventario: la planilla queda como el lugar donde
 * miran los que no entran al sistema.
 *
 * EL LIBRO SE LEYÓ EL 09/09/2026, y desmintió los dos supuestos del spec:
 *
 *   1. **No es una hoja: es una pestaña por mes** (`ABRIL 2026` …
 *      `SEPTIEMBRE 2026`), con 1.714 órdenes entre todas. La pestaña se despeja
 *      del mes de la orden con `pestanaDelMes`, no se guarda.
 *   2. **`Tiempo de Carga` y `Tiempo en Predio` sí son fórmulas** —`=F2-E2` y
 *      `=H2-G2`— en abril, mayo, junio y julio; en agosto y septiembre están
 *      vacías porque alguien no las arrastró. Se sigue sin escribirlas: pisar
 *      una fórmula la convierte en dato muerto, y es el mismo motivo por el que
 *      Inventario lee la columna de stock en vez de recalcularla.
 *
 * Y esas fórmulas confirmaron el mapeo de columnas que el spec había deducido
 * del orden de los encabezados: `E` inicio de carga, `F` fin de carga, `G`
 * entrada al predio, `H` salida del predio.
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

/**
 * El corte entre "se anotó al revés" y "cruzó la medianoche".
 *
 * Doce horas no es un número elegido: es donde las dos interpretaciones de un
 * salto hacia atrás empatan (`1440 − salto` contra `salto`), y es también donde
 * cae el valle entre los dos grupos de saltos que tiene el libro.
 */
const MEDIO_DIA_MS = 12 * 60 * 60 * 1000;

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
    ? textoParaLaPlanilla(clasificacion)
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
 * catorce horas.
 *
 * LA REGLA: cuando un horario cae antes del que lo precede, **gana la
 * interpretación que da la duración más corta**. Sumar un día da `1440 − salto`
 * y no sumarlo da `−salto`, así que se suma sólo cuando el salto hacia atrás
 * pasa las 12 horas.
 *
 * No es un umbral elegido a dedo: se midieron los 394 saltos hacia atrás del
 * libro y están partidos en dos grupos, con el valle justo ahí. 234 son de menos
 * de dos horas —una salida anotada unos minutos antes del fin de carga, o sea un
 * error de tipeo— y 106 pasan las 12 horas, que son los cruces de medianoche
 * reales.
 *
 * La primera versión sumaba un día ante cualquier salto, y eso convertía un
 * error de 5 minutos en una permanencia de 23 h 55: **250 de las 1.702 órdenes
 * importadas quedaron con tiempos absurdos**. Un negativo se muestra en rojo y
 * alguien lo corrige; un positivo absurdo se promedia con los demás.
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
    // Sólo cuando el salto hacia atrás pasa las 12 h: ahí sumar un día da una
    // duración más corta que dejarlo negativo. Por debajo de eso es un error de
    // tipeo y tiene que quedar negativo, para que se vea en rojo y se corrija.
    if (!isNaN(previo) && previo - instante > MEDIO_DIA_MS) {
      instante += 2 * MEDIO_DIA_MS;
    }
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

/**
 * Los meses como los escribe el libro: en mayúsculas y sin acento.
 *
 * Se escriben a mano y no con `toLocaleString`: el nombre del mes de
 * `Intl` depende de los datos de locale del runtime —en Vercel puede venir
 * recortado— y acá tiene que coincidir **carácter por carácter** con el nombre
 * de una pestaña, o se escribe en la hoja equivocada.
 */
const MESES = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
] as const;

/**
 * En qué pestaña va una orden: `"SEPTIEMBRE 2026"`.
 *
 * El libro tiene una hoja por mes, así que la pestaña **es** el mes de la orden
 * y no hace falta guardarla — la misma decisión que con el estado y los tiempos.
 * Y por eso la fila sola no identifica una celda: la 45 existe en las seis
 * pestañas, que es lo que arregla la migración 20260909090003.
 */
export function pestanaDelMes(fecha: string): string | null {
  const m = fecha.match(/^(\d{4})-(\d{2})-\d{2}/);
  if (!m) return null;
  const mes = MESES[Number(m[2]) - 1];
  return mes ? `${mes} ${m[1]}` : null;
}
