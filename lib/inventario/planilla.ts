/**
 * Leer la planilla del almacén: `GESTIÓN DE ALMACÉN POLCECAL POLYSAN`.
 *
 * Dos pestañas y dos formas distintas de mirarlas:
 *
 * - `Listado articulos GRAL` — el catálogo. Su columna de stock es una
 *   **fórmula**: inicial + entradas − salidas sobre el kardex. Por eso es el
 *   stock consolidado correcto aunque la mitad de los movimientos se carguen a
 *   mano, y por eso el SdG lo lee en vez de calcularlo.
 * - `Entradas  Salidas` — el kardex. Ojo con el nombre: lleva **doble espacio**.
 *
 * Se lee por encabezado con alias y no por posición. El importador del repo de
 * origen lee el listado por posición; acá no, porque una columna insertada a
 * mano corre todo lo que está a su derecha y nadie se entera. Es además lo que
 * ya hace `lib/mantenimiento/stock.ts` sobre esta misma planilla.
 */

// Estos tres son helpers genéricos de Sheets que viven en Mantenimiento por
// haber llegado primero. Se importan en vez de copiarse: `fechaDeSheets` en
// particular concentra la corrección del día y el mes dados vuelta, y tenerla
// dos veces es cómo se arregla en una sola.
import { texto, normalizar, fechaDeSheets } from "@/lib/mantenimiento/planilla";

/**
 * Un texto de la planilla, donde un guión suelto es "acá no va nada".
 *
 * `texto()` limpia los errores de fórmula pero deja pasar el guión, y en estas
 * planillas el guión es cómo se escribe el vacío. Mantenimiento tiene la misma
 * regla en `ordenes.ts` y en `avisos.ts`, privada en cada uno; acá va la
 * tercera copia en vez de tocar dos parsers en producción por tres líneas.
 * Cuando haya una cuarta, conviene que viva en el núcleo.
 */
const campo = (v: unknown): string | null => {
  const s = texto(v);
  return s === null || s === "-" ? null : s;
};

/** Cómo puede llamarse cada columna. El primero que aparezca gana. */
const ALIAS_LISTADO: Record<string, string[]> = {
  codigo: ["CODIGO", "COD", "N ARTICULO", "ARTICULO", "ITEM", "SKU"],
  descripcion: ["DESCRIPCION", "DETALLE", "NOMBRE", "PRODUCTO"],
  stockInicial: ["STOCK INICIAL", "INICIAL", "STOCK INICIO"],
  ubicacion: ["UBICACION", "DEPOSITO", "ESTANTE", "LUGAR", "POSICION"],
  proveedoresRef: ["PROVEEDOR", "PROVEEDORES", "PROVEEDOR SUGERIDO"],
  marcas: ["MARCA", "MARCAS"],
  stockActual: ["STOCK ACTUAL", "STOCK", "EXISTENCIA", "SALDO", "DISPONIBLE"],
  stockSeguridad: ["STOCK DE SEGURIDAD", "STOCK SEGURIDAD", "STOCK MINIMO", "MINIMO", "SS"],
};

const ALIAS_KARDEX: Record<string, string[]> = {
  ri: ["N RI", "NRI", "RI", "N REQUERIMIENTO", "REQUERIMIENTO"],
  codigo: ["CODIGO", "COD", "N ARTICULO", "ARTICULO", "ITEM", "SKU"],
  descripcion: ["DESCRIPCION", "DETALLE", "NOMBRE", "PRODUCTO"],
  entrada: ["ENTRADA", "ENTRADAS", "ING", "INGRESO"],
  salida: ["SALIDA", "SALIDAS", "EGRESO"],
  solicitante: ["QUIEN", "QUIEN LO PIDIO", "SOLICITANTE", "PIDE", "RETIRA"],
  stock: ["STOCK", "SALDO", "STOCK RESULTANTE"],
  fecha: ["FECHA", "DIA"],
  proveedor: ["PROVEEDOR", "PROVEEDORES"],
  sector: ["SECTOR", "AREA", "DESTINO"],
};

/**
 * Un encabezado, listo para comparar.
 *
 * Sin acentos ni mayúsculas, sin puntos ni grados —los encabezados escriben
 * "N°" de tres maneras— y con los espacios colapsados.
 */
const clave = (v: unknown): string =>
  normalizar(v).toUpperCase().replace(/[.°º]/g, "").replace(/\s+/g, " ").trim();

/** Dónde quedó cada dato. `-1` es que la planilla no lo trae. */
export type Indice = Record<string, number>;

function mapear(encabezado: unknown[], alias: Record<string, string[]>): Indice {
  const claves = encabezado.map(clave);
  const idx: Indice = {};

  for (const [nombre, posibles] of Object.entries(alias)) {
    idx[nombre] = -1;
    for (const a of posibles) {
      const i = claves.indexOf(clave(a));
      if (i >= 0) { idx[nombre] = i; break; }
    }
  }
  return idx;
}

export const mapearListado = (encabezado: unknown[]): Indice =>
  mapear(encabezado, ALIAS_LISTADO);

export const mapearKardex = (encabezado: unknown[]): Indice =>
  mapear(encabezado, ALIAS_KARDEX);

/**
 * Una cantidad de la planilla.
 *
 * Vacío es **null**, no cero: "nadie lo contó" y "no hay" son cosas distintas,
 * y confundirlas manda a comprar algo que puede estar. Un cero escrito sí es
 * cero.
 */
export function cantidad(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  const s = String(valor).trim();
  if (s === "" || s === "-") return null;
  // La planilla escribe en formato argentino cuando alguien tipea a mano.
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export interface ArticuloLeido {
  codigo: string;
  descripcion: string;
  ubicacion: string | null;
  proveedores_ref: string | null;
  marcas: string | null;
  stock_inicial: number;
  stock_actual: number;
  stock_seguridad: number;
  sheets_fila: number;
}

/**
 * Una fila del listado. `null` si no identifica a ningún artículo.
 *
 * Sin código o sin descripción no es un artículo: son las filas de subtotal, las
 * separadoras y las que quedaron a medio escribir.
 */
export function filaDeArticulo(
  fila: unknown[],
  idx: Indice,
  numeroFila: number
): ArticuloLeido | null {
  const celda = (nombre: string): unknown => {
    const i = idx[nombre];
    return i >= 0 ? fila[i] : undefined;
  };

  const codigo = campo(celda("codigo"));
  const descripcion = campo(celda("descripcion"));
  if (!codigo || !descripcion) return null;

  return {
    codigo,
    descripcion,
    ubicacion: campo(celda("ubicacion")),
    proveedores_ref: campo(celda("proveedoresRef")),
    marcas: campo(celda("marcas")),
    // Acá sí se cae a cero: son columnas de la fila de un artículo que existe, y
    // un artículo sin stock cargado tiene cero de stock.
    stock_inicial: cantidad(celda("stockInicial")) ?? 0,
    stock_actual: cantidad(celda("stockActual")) ?? 0,
    stock_seguridad: cantidad(celda("stockSeguridad")) ?? 0,
    sheets_fila: numeroFila,
  };
}

export interface MovimientoLeido {
  ri: number | null;
  codigo: string;
  descripcion: string | null;
  tipo: "entrada" | "salida";
  cantidad: number;
  stock_resultante: number | null;
  solicitante: string | null;
  fecha: string | null;
  proveedor_raw: string | null;
  sector_raw: string | null;
  sheets_fila: number;
}

/**
 * Una fila del kardex. `null` si no es un movimiento.
 *
 * La planilla tiene una columna de entrada y otra de salida, y el tipo sale de
 * cuál está llena. Se descartan tres casos, y los tres aparecen de verdad en la
 * planilla:
 *
 * - **Sin código**: es la columna que dice si la fila tiene datos. Sin ella hay
 *   formato, fórmulas arrastradas y filas en blanco, no movimientos.
 * - **Las dos llenas**: nadie mueve un artículo para los dos lados a la vez. Es
 *   una fila mal cargada y adivinar cuál vale sería inventar.
 * - **Ninguna llena**: una fila empezada y no terminada.
 *
 * `ajuste` no se lee de la planilla: lo genera la app cuando alguien corrige un
 * conteo, y en la planilla eso llega como una entrada o una salida.
 */
export function filaDeMovimiento(
  fila: unknown[],
  idx: Indice,
  numeroFila: number
): MovimientoLeido | null {
  const celda = (nombre: string): unknown => {
    const i = idx[nombre];
    return i >= 0 ? fila[i] : undefined;
  };

  const codigo = campo(celda("codigo"));
  if (!codigo) return null;

  const entrada = cantidad(celda("entrada"));
  const salida = cantidad(celda("salida"));

  const hayEntrada = entrada !== null && entrada > 0;
  const haySalida = salida !== null && salida > 0;
  if (hayEntrada === haySalida) return null;

  const riLeido = cantidad(celda("ri"));

  return {
    ri: riLeido !== null && Number.isInteger(riLeido) && riLeido > 0 ? riLeido : null,
    codigo,
    descripcion: campo(celda("descripcion")),
    tipo: hayEntrada ? "entrada" : "salida",
    cantidad: hayEntrada ? (entrada as number) : (salida as number),
    stock_resultante: cantidad(celda("stock")),
    solicitante: campo(celda("solicitante")),
    fecha: fechaDeSheets(celda("fecha")),
    proveedor_raw: campo(celda("proveedor")),
    sector_raw: campo(celda("sector")),
    sheets_fila: numeroFila,
  };
}
