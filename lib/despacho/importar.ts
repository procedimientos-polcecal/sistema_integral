import { fechaDeSheets } from "@/lib/core/fechaDeSheets";
import { parsearHoraDePlanilla } from "./planilla";

/**
 * Leer el histórico de la planilla `Órdenes de Carga`, una vez.
 *
 * Las filas viejas entran **sin enlace a Odoo**: enganchar dos años de órdenes a
 * remitos por nombre de cliente es exactamente lo que no se hace en este repo.
 * Cliente y producto quedan como texto, y `odoo_picking_id` en null.
 *
 * El parseo va acá y no en la ruta porque es donde están las trampas, y todas
 * fallan sin ruido:
 *
 * 1. **Las columnas se buscan por nombre normalizado y con alternativas**, no
 *    por posición ni por igualdad exacta. Los encabezados reales tienen espacios
 *    de más ("Material ", "Hora Salida  de carga " con dos) y —lo que sorprendió
 *    al leer el libro— **no se llaman igual en todas las pestañas**: la columna
 *    de fecha es `Fecha`, `Fecha Orden` o `Fecha Orden de carga` según el mes.
 *    Con un solo nombre esperado, dos de las seis pestañas no se importaban.
 * 2. **Las horas no traen fecha y hay que encadenarlas en el orden en que
 *    ocurren**, que no es el orden de las columnas: la planilla pone las dos de
 *    carga antes que las dos de predio.
 * 3. **Las pestañas arrastran filas de relleno.** `ABRIL 2026` devuelve 1.000
 *    filas y las últimas están vacías salvo el `0` que dejan las fórmulas de
 *    J/K. Contarlas como "no se pudo leer" ahogaría el aviso de una fila que sí
 *    tenga datos y no se haya podido importar.
 * 4. **Se lee sin formato, y no es un detalle.** Hay celdas de fecha con el dato
 *    adentro y un formato de número que las muestra vacías: leyendo el texto
 *    formateado, esas órdenes se perderían por "no tienen fecha". Con
 *    `sinFormato` llega el serial. Medido contra el libro: así entran las 1.714.
 */

export interface IndicesDeColumnas {
  fecha: number;
  numero: number;
  /** `-1` = esa columna no está en esta pestaña. */
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

/**
 * Cómo se puede llamar cada columna, ya normalizado. La primera que aparezca
 * gana.
 *
 * `fecha` tiene tres nombres porque el libro los tiene: se leyeron los seis
 * encabezados y hay `Fecha`, `Fecha Orden` y `Fecha Orden de carga`.
 */
const ENCABEZADOS: Record<keyof IndicesDeColumnas, string[]> = {
  fecha: ["fecha orden", "fecha orden de carga", "fecha"],
  numero: ["nro de orden", "nro orden"],
  cliente: ["cliente"],
  material: ["material"],
  inicioCarga: ["hora comienzo de carga", "hora inicio de carga"],
  finCarga: ["hora salida de carga", "hora fin de carga"],
  entradaPredio: ["hora ingreso al predio", "hora entrada al predio"],
  salidaPredio: ["hora salida del predio"],
  observaciones: ["observaciones", "notas"],
};

/**
 * Sin estas dos no hay orden que importar: el número es la clave y la fecha es
 * lo que le da sentido a las cuatro horas, que vienen sin día.
 *
 * Las demás pueden faltar y la importación sigue: quedan en `-1` y su valor en
 * null. Es lo contrario de lo que hacía antes —exigir las nueve— y el motivo es
 * concreto: una pestaña a la que le falte `Observaciones` tiene igual sus
 * doscientas órdenes, y devolver null por eso las perdía todas.
 */
const IMPRESCINDIBLES: (keyof IndicesDeColumnas)[] = ["numero", "fecha"];

/**
 * En qué columna está cada campo, o null si esa fila no es la de encabezados.
 *
 * Devolver null en vez de índices a medias es a propósito cuando falta una
 * imprescindible: importar "lo que se pueda" cargaría miles de filas sin número
 * de orden —la clave— y habría que borrarlas a mano.
 */
export function indicesDeColumnas(fila: unknown[]): IndicesDeColumnas | null {
  const normalizados = fila.map(normalizar);
  const indices: Partial<IndicesDeColumnas> = {};

  for (const [campo, alternativas] of Object.entries(ENCABEZADOS)) {
    const clave = campo as keyof IndicesDeColumnas;
    let i = -1;
    for (const nombre of alternativas) {
      i = normalizados.indexOf(nombre);
      if (i >= 0) break;
    }
    if (i < 0 && IMPRESCINDIBLES.includes(clave)) return null;
    indices[clave] = i;
  }

  return indices as IndicesDeColumnas;
}

/** La celda de una columna que puede no existir en esta pestaña. */
function celda(fila: unknown[], i: number): unknown {
  return i >= 0 ? fila[i] : undefined;
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
  const numero = String(celda(fila, idx.numero) ?? "").trim();
  if (!numero) return null;

  const fecha = fechaDeSheets(celda(fila, idx.fecha));
  if (!fecha) return null;

  /*
   * Los horarios se encadenan en el orden en que ocurren, no en el de las
   * columnas: cada uno usa el anterior para decidir si es del día siguiente. La
   * planilla pone las dos horas de carga antes que las dos de predio, así que
   * encadenarlas en el orden en que están daría vuelta el turno de noche.
   */
  const entrada = parsearHoraDePlanilla(celda(fila, idx.entradaPredio), fecha);
  const inicio = parsearHoraDePlanilla(celda(fila, idx.inicioCarga), fecha, entrada);
  const fin = parsearHoraDePlanilla(celda(fila, idx.finCarga), fecha, inicio ?? entrada);
  const salida = parsearHoraDePlanilla(
    celda(fila, idx.salidaPredio),
    fecha,
    fin ?? inicio ?? entrada
  );

  return {
    numero,
    fecha,
    cliente_raw: textoONull(celda(fila, idx.cliente)),
    producto_raw: textoONull(celda(fila, idx.material)),
    entrada_predio: entrada,
    inicio_carga: inicio,
    fin_carga: fin,
    salida_predio: salida,
    notas: textoONull(celda(fila, idx.observaciones)),
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
    /*
     * Sólo cuenta como salteada la que tiene algo **en las columnas que
     * importan**. `ABRIL 2026` devuelve mil filas vacías salvo el `0` que dejan
     * las fórmulas de J/K: mirando la fila entera, esas mil se contarían como
     * "no se pudieron leer" y ahogarían el aviso de una que sí tenga datos.
     */
    else if (tieneAlgoQueImporta(valores[i] ?? [], idx)) salteadas++;
  }

  return { ordenes, filaDeEncabezados, salteadas };
}

function textoONull(valor: unknown): string | null {
  const s = String(valor ?? "").trim();
  return s === "" ? null : s;
}

/** Si la fila tiene algo en las columnas de datos (no en las calculadas). */
function tieneAlgoQueImporta(fila: unknown[], idx: IndicesDeColumnas): boolean {
  return (Object.values(idx) as number[])
    .filter((i) => i >= 0)
    .some((i) => String(fila[i] ?? "").trim() !== "");
}
