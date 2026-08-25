/**
 * Comparativas de proveedores de las órdenes de servicio.
 *
 * La planilla "COMPARATIVA DE PROVEEDORES MANTENIMIENTO" tiene una pestaña por
 * sector y, dentro de cada una, una fila por cotización. Varias filas con el
 * mismo N° de OS son las ofertas que se compararon para ese servicio; la
 * columna ELECCIÓN marca cuál se tomó.
 *
 * Verificado contra la planilla: las quince columnas son fijas (A..O) y el
 * encabezado es igual en las doce pestañas, así que se lee por posición.
 *
 * Es una comparativa distinta de la de Compras: aquélla compara presupuestos de
 * materiales por requerimiento, ésta compara servicios por OS. Comparten la
 * idea, no las tablas.
 */

import {
  texto, fechaDeSheets, codigoDeEquipo, normalizar, monto, porcentaje, siNo,
} from "@/lib/mantenimiento/planilla";

/**
 * Las pestañas de la planilla, verificadas contra ella.
 *
 * El orden es el de la planilla. "Otros" es donde cae lo que no tiene sector
 * propio, y por eso tiene que existir siempre.
 */
export const COMPARATIVA_PESTANAS = [
  "Planta Filler 2", "Planta Filler 1", "Compresores", "Molienda de cal",
  "Calcinación", "Planta 0-2 mm", "Planta de trituracion 1",
  "Planta de trituracion 2", "Planta de Trituracion 3", "Hidratacion",
  "Edificios", "Otros",
] as const;

/** Columna de cada dato, contando desde A = 0. */
const COL = {
  osNumber: 0,
  fecha: 1,
  area: 2,
  sector: 3,
  equipo: 4,
  descripcion: 5,
  proveedor: 6,
  precioUnitario: 7,
  iva: 8,
  precioTotal: 9,
  vigenciaHasta: 10,
  plazos: 11,
  condicionesPago: 12,
  otrasEspecificaciones: 13,
  eleccion: 14,
} as const;

const PESTANA_POR_NOMBRE = new Map(
  COMPARATIVA_PESTANAS.map((p) => [normalizar(p), p as string])
);

/**
 * En qué pestaña va la comparativa de un sector.
 *
 * Las OS escriben el sector a mano —"Calcinacion" sin acento, "planta filler 2"
 * en minúscula—, así que se compara normalizado. Lo que no tiene pestaña propia
 * va a "Otros", como en la planilla.
 */
export function pestanaDeSector(sector: string | null | undefined): string {
  return PESTANA_POR_NOMBRE.get(normalizar(sector)) ?? "Otros";
}

export interface CotizacionLeida {
  os_number: number;
  fecha: string | null;
  area: string | null;
  sector: string;
  equipo_raw: string | null;
  equipo_code: string | null;
  descripcion: string | null;
  proveedor: string;
  precio_unitario: string | null;
  iva: number | null;
  precio_total: string | null;
  vigencia_hasta: string | null;
  plazos: string | null;
  condiciones_pago: string | null;
  otras_especificaciones: string | null;
  eleccion: boolean;
  sheets_tab: string;
  sheets_row: number;
}

/**
 * Una fila de la planilla como cotización. `null` si no lo es.
 *
 * Hace falta el N° de OS y el proveedor: la plantilla trae cientos de filas
 * vacías con el total en cero, y sin proveedor no hay a quién comprarle.
 */
export function filaDeComparativa(
  fila: unknown[], numeroFila: number, pestana: string
): CotizacionLeida | null {
  const osNumber = Number(fila[COL.osNumber]);
  const proveedor = texto(fila[COL.proveedor]);
  if (!osNumber || isNaN(osNumber) || !proveedor) return null;

  const equipoRaw = texto(fila[COL.equipo]);
  const precio = (v: unknown): string | null => {
    const n = monto(v);
    return n === null ? texto(v) : String(n);
  };

  return {
    os_number: osNumber,
    fecha: fechaDeSheets(fila[COL.fecha]),
    area: texto(fila[COL.area]),
    sector: texto(fila[COL.sector]) ?? pestana,
    equipo_raw: equipoRaw,
    equipo_code: codigoDeEquipo(equipoRaw),
    descripcion: texto(fila[COL.descripcion]),
    proveedor,
    precio_unitario: precio(fila[COL.precioUnitario]),
    iva: porcentaje(fila[COL.iva]),
    precio_total: precio(fila[COL.precioTotal]),
    vigencia_hasta: fechaDeSheets(fila[COL.vigenciaHasta]),
    plazos: texto(fila[COL.plazos]),
    condiciones_pago: texto(fila[COL.condicionesPago]),
    otras_especificaciones: texto(fila[COL.otrasEspecificaciones]),
    eleccion: siNo(fila[COL.eleccion]),
    sheets_tab: pestana,
    sheets_row: numeroFila,
  };
}

/** Las cotizaciones agrupadas por el N° de OS que comparan. */
export function porOrdenDeServicio<T extends { os_number: number }>(
  cotizaciones: T[]
): Record<number, T[]> {
  const m: Record<number, T[]> = {};
  for (const c of cotizaciones) (m[c.os_number] ??= []).push(c);
  return m;
}

interface Comparable {
  precio_total?: string | null;
  eleccion?: boolean | null;
}

/**
 * Qué dice una comparativa de un vistazo.
 *
 * Que la elegida no sea la más barata puede estar perfectamente bien —plazo,
 * garantía, quién puede venir mañana—, pero tiene que verse: es lo primero que
 * alguien va a preguntar mirando la comparativa.
 */
export function resumenDeCotizaciones<T extends Comparable>(cotizaciones: T[]) {
  const elegida = cotizaciones.find((c) => c.eleccion) ?? null;

  // Sin precio legible no compite: "a convenir" no es más barato que nada.
  const conPrecio = cotizaciones
    .map((c) => ({ c, precio: monto(c.precio_total) }))
    .filter((x): x is { c: T; precio: number } => x.precio !== null);

  const masBarata = conPrecio.length
    ? conPrecio.reduce((a, b) => (b.precio < a.precio ? b : a))
    : null;

  const precioElegida = elegida ? monto(elegida.precio_total) : null;
  const diferencia =
    precioElegida !== null && masBarata
      ? Math.round((precioElegida - masBarata.precio) * 100) / 100
      : null;

  return {
    cantidad: cotizaciones.length,
    elegida,
    masBarata: masBarata?.c ?? null,
    precioMasBajo: masBarata?.precio ?? null,
    diferencia,
    seEligioLaMasBarata: diferencia === null ? null : diferencia <= 0,
  };
}

/** La columna ELECCIÓN, que es la única que la app cambia sola. */
export const COLUMNA_ELECCION = COL.eleccion;

/** Cuántas columnas tiene la planilla: A..O. */
export const COLUMNAS_COMPARATIVA = 15;

interface ParaEscribir {
  os_number: number;
  fecha?: string | null;
  area?: string | null;
  sector?: string | null;
  equipo_raw?: string | null;
  descripcion?: string | null;
  proveedor: string;
  precio_unitario?: string | null;
  iva?: number | null;
  precio_total?: string | null;
  vigencia_hasta?: string | null;
  plazos?: string | null;
  condiciones_pago?: string | null;
  otras_especificaciones?: string | null;
  eleccion?: boolean | null;
}

/** Una fecha ISO como la escribe la planilla. */
const fechaAR = (iso: string | null | undefined): string =>
  iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("es-AR") : "";

/**
 * Una cotización como las quince celdas de la planilla.
 *
 * El orden es el de las columnas y no puede cambiar: la planilla se lee por
 * posición.
 */
export function filaParaComparativa(c: ParaEscribir): (string | number)[] {
  const fila = new Array(COLUMNAS_COMPARATIVA).fill("");

  fila[COL.osNumber] = c.os_number;
  fila[COL.fecha] = fechaAR(c.fecha);
  fila[COL.area] = c.area ?? "";
  fila[COL.sector] = c.sector ?? "";
  fila[COL.equipo] = c.equipo_raw ?? "";
  fila[COL.descripcion] = c.descripcion ?? "";
  fila[COL.proveedor] = c.proveedor;
  fila[COL.precioUnitario] = c.precio_unitario ?? "";
  fila[COL.iva] = c.iva ?? "";
  fila[COL.precioTotal] = c.precio_total ?? "";
  fila[COL.vigenciaHasta] = fechaAR(c.vigencia_hasta);
  fila[COL.plazos] = c.plazos ?? "";
  fila[COL.condicionesPago] = c.condiciones_pago ?? "";
  fila[COL.otrasEspecificaciones] = c.otras_especificaciones ?? "";
  fila[COL.eleccion] = c.eleccion ? "TRUE" : "FALSE";

  return fila;
}

/**
 * Si esa fila de la planilla sigue siendo la de esta cotización.
 *
 * El número de fila que guardamos se corre en cuanto alguien inserta una fila
 * en el medio de la planilla, y escribir a ciegas pisaría la cotización de otro
 * proveedor. En Compras eso ya pasó: 238 filas quedaron marcadas mal.
 */
export function coincideLaFila(
  fila: unknown[], cotizacion: { os_number: number; proveedor: string }
): boolean {
  return (
    Number(fila[COL.osNumber]) === cotizacion.os_number &&
    normalizar(fila[COL.proveedor]) === normalizar(cotizacion.proveedor)
  );
}
