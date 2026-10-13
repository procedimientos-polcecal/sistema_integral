/**
 * Leer la planilla de stock de envases que lleva calidad:
 * `GESTIÓN DE STOCK BOLSAS Y BOLSONES POLCECAL POLYSAN`.
 *
 * Es la planilla del almacén clonada —mismos nombres de pestaña, mismo stock
 * por fórmula sobre el kardex— con otras columnas: acá la A es el código y no
 * el N° de RI, y el kardex trae ROTURA y DESPACHO, que allá no existen.
 *
 * Se lee **por encabezado con alias y no por posición**, por lo mismo que en
 * Inventario: una columna insertada a mano corre todo lo que está a su derecha
 * y nadie se entera. La única excepción es la columna K, que no tiene
 * encabezado — ver `grupoDeLaFila`.
 */

// Los helpers genéricos de Sheets viven en Mantenimiento por haber llegado
// primero. Se importan y no se copian: `fechaDeSheets` concentra la corrección
// del día y el mes dados vuelta, y tenerla dos veces es cómo se arregla en una
// sola.
import { texto, normalizar, fechaDeSheets } from "@/lib/mantenimiento/planilla";
import { normalizarCuit } from "@/lib/core/cuit";

/** Un texto de la planilla, donde un guión suelto es "acá no va nada". */
const campo = (v: unknown): string | null => {
  const s = texto(v);
  return s === null || s === "-" ? null : s;
};

/** Un encabezado listo para comparar: sin acentos, mayúsculas ni puntuación. */
const clave = (v: unknown): string =>
  normalizar(v).toUpperCase().replace(/[.°º]/g, "").replace(/\s+/g, " ").trim();

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

/**
 * `STOCK INICAL` está así, sin la segunda "I", en la planilla real. Va como
 * alias en vez de corregirse allá: la celda es referencia de fórmulas y
 * renombrarla las rompe.
 */
const ALIAS_LISTADO: Record<string, string[]> = {
  codigo: ["CODIGO", "COD"],
  descripcion: ["DESCRIPCION", "DETALLE", "PRODUCTO"],
  stockInicial: ["STOCK INICAL", "STOCK INICIAL", "INICIAL"],
  ubicacion: ["UBICACION", "DEPOSITO", "LUGAR"],
  proveedoresRef: ["PROVEEDORES (REFERENCIA)", "PROVEEDORES", "PROVEEDOR"],
  stockActual: ["STOCK ACTUAL", "STOCK", "EXISTENCIA", "SALDO"],
  stockSeguridad: ["STOCK DE SEGURIDAD", "STOCK SEGURIDAD", "STOCK MINIMO", "MINIMO"],
};

const ALIAS_KARDEX: Record<string, string[]> = {
  codigo: ["CODIGO", "COD"],
  descripcion: ["DESCRIPCION", "DETALLE", "PRODUCTO"],
  entrada: ["ENTRADAS", "ENTRADA", "INGRESO", "INGRESOS"],
  salida: ["SALIDAS", "SALIDA", "EGRESO", "EGRESOS"],
  rotura: ["ROTURA", "ROTURAS", "ROTO"],
  despacho: ["DESPACHO", "DESPACHOS", "DESPACHADO"],
  stock: ["STOCK", "SALDO"],
  fecha: ["FECHA", "DIA"],
  observacion: ["OBSERVACION", "OBSERVACIONES", "NOTA", "NOTAS"],
  proveedor: ["PROVEEDOR", "PROVEEDORES"],
};

/**
 * Ojo con `nombre` y `contactoNombre`: la pestaña tiene una columna
 * **"Proveedor"** —quién es— y otra **"Nombre"**, que es la persona con la que
 * se habla. En la fila de Torraco el proveedor es "Torraco Pablo Javier" y la
 * persona es "Flexi Rigs". Confundirlas deja el catálogo con nombres de gente.
 */
const ALIAS_PROVEEDOR: Record<string, string[]> = {
  nombre: ["PROVEEDOR", "NOMBRE DEL PROVEEDOR"],
  tipos: ["TIPO DE PROVEEDOR", "TIPO", "TIPOS"],
  contactoNombre: ["NOMBRE", "CONTACTO"],
  contactoTel: ["CONTACTOS", "TELEFONO", "TEL"],
  contactoAlt: ["CONTACTO ALTERNATIVO", "ALTERNATIVO", "MAIL", "EMAIL"],
  direccion: ["DIRECCION", "DOMICILIO"],
  notas: ["NOTAS", "OBSERVACIONES"],
  cuit: ["CUIT", "CUIL"],
};

export const mapearListado = (e: unknown[]): Indice => mapear(e, ALIAS_LISTADO);
export const mapearKardex = (e: unknown[]): Indice => mapear(e, ALIAS_KARDEX);

/**
 * Una cantidad de la planilla.
 *
 * Vacío es **null**, no cero: "nadie lo contó" y "no hay" son cosas distintas.
 * Un cero escrito sí es cero.
 */
export function cantidad(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  const s = String(valor).trim();
  if (s === "" || s === "-") return null;
  // Formato argentino: "12.400" son doce mil cuatrocientos.
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export interface ArticuloLeido {
  codigo: string;
  descripcion: string;
  ubicacion: string | null;
  proveedores_ref: string | null;
  stock_inicial: number;
  stock_actual: number;
  stock_seguridad: number;
  sheets_fila: number;
}

/**
 * Una fila del listado. `null` si no identifica a ningún artículo.
 *
 * Sin código o sin descripción no es un artículo: son las filas separadoras y
 * las que quedaron a medio escribir.
 */
export function filaDeArticulo(
  fila: unknown[], idx: Indice, numeroFila: number
): ArticuloLeido | null {
  const celda = (n: string): unknown => (idx[n] >= 0 ? fila[idx[n]] : undefined);

  const codigo = campo(celda("codigo"));
  const descripcion = campo(celda("descripcion"));
  if (!codigo || !descripcion) return null;

  return {
    codigo,
    descripcion,
    ubicacion: campo(celda("ubicacion")),
    proveedores_ref: campo(celda("proveedoresRef")),
    stock_inicial: cantidad(celda("stockInicial")) ?? 0,
    stock_actual: cantidad(celda("stockActual")) ?? 0,
    stock_seguridad: cantidad(celda("stockSeguridad")) ?? 0,
    sheets_fila: numeroFila,
  };
}

/**
 * La columna K: el grupo de envase.
 *
 * **Es la única que se lee por posición**, porque no tiene encabezado: la fila
 * 1 del kardex trae exactamente diez celdas, de `CODIGO` a `PROVEEDOR`, y la
 * `ARRAYFORMULA` que clasifica el código arranca en `K2`.
 *
 * Como la posición es frágil —una columna insertada la corre—, lo que salga
 * tiene que **parecer un grupo**: texto, no un número ni una fecha. Si no lo
 * parece, `null`, que la sincronización informa. Un grupo inventado pone el
 * artículo en el total que no es y no se nota nunca.
 */
export const COL_GRUPO = 10;

export function grupoDeLaFila(fila: unknown[]): string | null {
  const v = campo(fila[COL_GRUPO]);
  if (!v) return null;
  // Un número o una fecha en esa posición es una columna corrida, no un grupo.
  if (cantidad(v) !== null) return null;
  if (fechaDeSheets(v) !== null) return null;
  return v;
}

export interface MovimientoLeido {
  codigo: string;
  descripcion: string | null;
  entrada: number;
  salida: number;
  rotura: number;
  despacho: number;
  stock_resultante: number | null;
  fecha: string | null;
  observacion: string | null;
  proveedor_raw: string | null;
  grupo_raw: string | null;
  sheets_fila: number;
}

/**
 * Una fila del kardex. `null` si no es un movimiento.
 *
 * A diferencia de Inventario, **entrada y salida juntas no se descartan**: la
 * planilla tiene 4 filas así y son buenas. Y la rotura y el despacho conviven
 * con la salida. Lo único que se descarta es la fila sin código —la A es la que
 * dice si la fila tiene datos— y la que no movió ninguno de los cuatro números,
 * que es una fila empezada y no terminada.
 */
export function filaDeMovimiento(
  fila: unknown[], idx: Indice, numeroFila: number
): MovimientoLeido | null {
  const celda = (n: string): unknown => (idx[n] >= 0 ? fila[idx[n]] : undefined);

  const codigo = campo(celda("codigo"));
  if (!codigo) return null;

  const entrada = cantidad(celda("entrada")) ?? 0;
  const salida = cantidad(celda("salida")) ?? 0;
  const rotura = cantidad(celda("rotura")) ?? 0;
  const despacho = cantidad(celda("despacho")) ?? 0;
  if (entrada + salida + rotura + despacho <= 0) return null;

  return {
    codigo,
    descripcion: campo(celda("descripcion")),
    entrada, salida, rotura, despacho,
    stock_resultante: cantidad(celda("stock")),
    fecha: fechaDeSheets(celda("fecha")),
    observacion: campo(celda("observacion")),
    proveedor_raw: campo(celda("proveedor")),
    grupo_raw: grupoDeLaFila(fila),
    sheets_fila: numeroFila,
  };
}

export interface ProveedorLeido {
  nombre: string;
  tipos: string | null;
  contacto_nombre: string | null;
  contacto_tel: string | null;
  contacto_alt: string | null;
  direccion: string | null;
  notas: string | null;
  cuit: string | null;
  sheets_fila: number;
}

/** Una fila de `PROVEEDORES`. `null` si no tiene nombre. */
export function filaDeProveedor(
  fila: unknown[], encabezado: unknown[], numeroFila: number
): ProveedorLeido | null {
  const idx = mapear(encabezado, ALIAS_PROVEEDOR);
  const celda = (n: string): unknown => (idx[n] >= 0 ? fila[idx[n]] : undefined);

  const nombre = campo(celda("nombre"));
  if (!nombre) return null;

  return {
    nombre,
    tipos: campo(celda("tipos")),
    contacto_nombre: campo(celda("contactoNombre")),
    contacto_tel: campo(celda("contactoTel")),
    contacto_alt: campo(celda("contactoAlt")),
    direccion: campo(celda("direccion")),
    notas: campo(celda("notas")),
    cuit: normalizarCuit(campo(celda("cuit"))),
    sheets_fila: numeroFila,
  };
}

/** Un rango combinado de la API de Sheets. Índices base 0, el final no entra. */
export interface RangoCombinado {
  startRowIndex?: number;
  endRowIndex?: number;
  startColumnIndex?: number;
  endColumnIndex?: number;
}

/** Un bloque de filas que comparten una celda. Base 1, los dos extremos entran. */
export interface Bloque {
  primeraFila: number;
  ultimaFila: number;
}

/**
 * Los bloques combinados que tocan una columna, en filas base 1.
 *
 * La API los da en base 0 con el final afuera; el resto del parser trabaja con
 * el número de fila que se ve en la planilla, así que se traducen una vez acá y
 * no en cada uso.
 */
export function bloquesDeLaColumna(
  combinaciones: RangoCombinado[],
  columna: number
): Bloque[] {
  return combinaciones
    .filter(
      (c) =>
        columna >= (c.startColumnIndex ?? 0) && columna < (c.endColumnIndex ?? Infinity)
    )
    .map((c) => ({
      primeraFila: (c.startRowIndex ?? 0) + 1,
      ultimaFila: c.endRowIndex ?? Infinity,
    }))
    .sort((a, b) => a.primeraFila - b.primeraFila);
}

/** Un artículo con su grupo de seguridad resuelto. */
export type ArticuloConGrupo = ArticuloLeido & { grupo_seguridad: string };

/**
 * A qué grupo de seguridad pertenece cada artículo, y cuál es el mínimo del
 * grupo.
 *
 * En el listado, `STOCK DE SEGURIDAD` está en **celdas combinadas** que abarcan
 * varias filas: el mínimo es del conjunto —cuántos bolsones de 1,20 hay, no de
 * qué proveedor— y se compara contra la suma de todos ellos. Una celda
 * combinada **sólo trae valor en su primera fila**, así que sin esto el mínimo
 * caía en el primer artículo del bloque y los demás quedaban en cero.
 *
 * El grupo se nombra con el **código del primer artículo del bloque**, y el
 * mínimo de ese primero se copia a todos sus miembros: así cada fila sabe contra
 * qué se la mide sin tener que volver a mirar la planilla.
 *
 * **Un artículo sin combinar es un grupo de uno.** Las bolsas no están
 * combinadas y cada una tiene su mínimo; tratarlas como grupo de uno hace que la
 * cuenta sea una sola y no haya caso especial.
 *
 * El grupo NO sale de `grupo` —la columna K del kardex—, aunque hoy casi
 * coincidan: el `00011` no tiene movimientos, así que no tiene K, y sin embargo
 * está adentro del bloque de 2,10. Usar la K lo habría dejado afuera de su
 * propia suma.
 */
export function agruparPorSeguridad(
  articulos: ArticuloLeido[],
  bloques: Bloque[]
): ArticuloConGrupo[] {
  const porFila = new Map(articulos.map((a) => [a.sheets_fila, a]));

  return articulos.map((a) => {
    const bloque = bloques.find(
      (b) => a.sheets_fila >= b.primeraFila && a.sheets_fila <= b.ultimaFila
    );
    // Sin bloque, o con un bloque cuya primera fila no es un artículo —una
    // combinación que empieza en el encabezado, por ejemplo—, se cae a grupo de
    // uno. Inventar un grupo sería peor: mezclaría stocks que nadie quiso sumar.
    const cabeza = bloque ? porFila.get(bloque.primeraFila) : undefined;
    if (!cabeza) return { ...a, grupo_seguridad: a.codigo };

    return {
      ...a,
      grupo_seguridad: cabeza.codigo,
      stock_seguridad: cabeza.stock_seguridad,
    };
  });
}
