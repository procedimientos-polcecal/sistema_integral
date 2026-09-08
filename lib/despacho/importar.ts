import { fechaDeSheets } from "@/lib/core/fechaDeSheets";
import { parsearHoraDePlanilla } from "./planilla";

/**
 * Leer el histórico de la planilla `Órdenes de Carga`, una vez.
 *
 * Las filas viejas entran **sin enlace a Odoo**: enganchar dos años de órdenes a
 * remitos por nombre de cliente es exactamente lo que no se hace en este repo.
 * Cliente y producto quedan como texto, y `odoo_picking_id` en null.
 *
 * El parseo va acá y no en la ruta porque es donde están las dos trampas, y las
 * dos fallan sin ruido:
 *
 * 1. **Las columnas se buscan por nombre normalizado**, no por posición ni por
 *    igualdad exacta. Los encabezados reales tienen espacios de más
 *    ("Material ", "Hora Salida de carga ") y una columna insertada a mano
 *    corre todas las posiciones.
 * 2. **Las horas no traen fecha y hay que encadenarlas en el orden en que
 *    ocurren**, que no es el orden de las columnas: la planilla pone las dos de
 *    carga antes que las dos de predio.
 */

export interface IndicesDeColumnas {
  fecha: number;
  numero: number;
  cliente: number;
  material: number;
  inicioCarga: number;
  finCarga: number;
  entradaPredio: number;
  salidaPredio: number;
  observaciones: number;
}

/** Sin acentos, sin espacios de más, en minúscula: así se comparan encabezados. */
function normalizar(valor: unknown): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Qué encabezado corresponde a cada campo, ya normalizado. */
const ENCABEZADOS: Record<keyof IndicesDeColumnas, string> = {
  fecha: "fecha orden",
  numero: "nro de orden",
  cliente: "cliente",
  material: "material",
  inicioCarga: "hora comienzo de carga",
  finCarga: "hora salida de carga",
  entradaPredio: "hora ingreso al predio",
  salidaPredio: "hora salida del predio",
  observaciones: "observaciones",
};

/**
 * En qué columna está cada campo, o null si esa fila no es la de encabezados.
 *
 * Devolver null en vez de índices a medias es a propósito: con una columna
 * imprescindible faltando, importar "lo que se pueda" cargaría miles de filas
 * sin número de orden —la clave— y habría que borrarlas a mano.
 */
export function indicesDeColumnas(fila: unknown[]): IndicesDeColumnas | null {
  const normalizados = fila.map(normalizar);
  const indices: Partial<IndicesDeColumnas> = {};

  for (const [campo, encabezado] of Object.entries(ENCABEZADOS)) {
    const i = normalizados.indexOf(encabezado);
    if (i < 0) return null;
    indices[campo as keyof IndicesDeColumnas] = i;
  }

  return indices as IndicesDeColumnas;
}

export interface OrdenImportada {
  numero: string;
  fecha: string;
  cliente_raw: string | null;
  producto_raw: string | null;
  entrada_predio: string | null;
  inicio_carga: string | null;
  fin_carga: string | null;
  salida_predio: string | null;
  notas: string | null;
}

/**
 * Una fila de la planilla, o null si no es una orden.
 *
 * Se saltea sin número o sin fecha: el número es la clave y la fecha es lo que
 * le da sentido a las cuatro horas, que vienen sin día.
 */
export function ordenDeFilaDePlanilla(
  fila: unknown[],
  idx: IndicesDeColumnas
): OrdenImportada | null {
  const numero = String(fila[idx.numero] ?? "").trim();
  if (!numero) return null;

  const fecha = fechaDeSheets(fila[idx.fecha]);
  if (!fecha) return null;

  /*
   * Los horarios se encadenan en el orden en que ocurren, no en el de las
   * columnas: cada uno usa el anterior para decidir si es del día siguiente. La
   * planilla pone las dos horas de carga antes que las dos de predio, así que
   * encadenarlas en el orden en que están daría vuelta el turno de noche.
   */
  const entrada = parsearHoraDePlanilla(fila[idx.entradaPredio], fecha);
  const inicio = parsearHoraDePlanilla(fila[idx.inicioCarga], fecha, entrada);
  const fin = parsearHoraDePlanilla(fila[idx.finCarga], fecha, inicio ?? entrada);
  const salida = parsearHoraDePlanilla(fila[idx.salidaPredio], fecha, fin ?? inicio ?? entrada);

  return {
    numero,
    fecha,
    cliente_raw: textoONull(fila[idx.cliente]),
    producto_raw: textoONull(fila[idx.material]),
    entrada_predio: entrada,
    inicio_carga: inicio,
    fin_carga: fin,
    salida_predio: salida,
    notas: textoONull(fila[idx.observaciones]),
  };
}

/**
 * Todas las órdenes de la planilla, más las filas que no se pudieron leer.
 *
 * Busca la fila de encabezados en las primeras diez: en estas planillas el
 * título suele estar arriba y los encabezados no siempre están en la 1.
 */
export function ordenesDeLaPlanilla(valores: unknown[][]): {
  /** Cada orden con **el número de fila del libro** (base 1, como lo ve Google). */
  ordenes: (OrdenImportada & { fila: number })[];
  filaDeEncabezados: number | null;
  salteadas: number;
} {
  let idx: IndicesDeColumnas | null = null;
  let filaDeEncabezados: number | null = null;

  for (let i = 0; i < Math.min(valores.length, 10); i++) {
    const candidato = indicesDeColumnas(valores[i] ?? []);
    if (candidato) {
      idx = candidato;
      filaDeEncabezados = i;
      break;
    }
  }

  if (!idx || filaDeEncabezados === null) {
    return { ordenes: [], filaDeEncabezados: null, salteadas: 0 };
  }

  const ordenes: (OrdenImportada & { fila: number })[] = [];
  let salteadas = 0;

  for (let i = filaDeEncabezados + 1; i < valores.length; i++) {
    const orden = ordenDeFilaDePlanilla(valores[i] ?? [], idx);
    /*
     * La fila se guarda en `sheets_fila` y no es un lujo: sin ella, corregir
     * una orden importada agregaría una fila nueva al final en vez de
     * reescribir la que ya está, y el libro terminaría con la misma orden dos
     * veces diciendo cosas distintas.
     *
     * `i + 1` porque Google cuenta las filas desde uno y el arreglo desde cero.
     */
    if (orden) ordenes.push({ ...orden, fila: i + 1 });
    // Una fila vacía al final de la hoja no es un problema: sólo se cuentan las
    // que tienen algo escrito y no se pudieron leer.
    else if ((valores[i] ?? []).some((c) => String(c ?? "").trim() !== "")) salteadas++;
  }

  return { ordenes, filaDeEncabezados, salteadas };
}

function textoONull(valor: unknown): string | null {
  const s = String(valor ?? "").trim();
  return s === "" ? null : s;
}
