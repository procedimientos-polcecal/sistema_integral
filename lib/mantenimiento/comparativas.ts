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
 *
 * **Esta lista se queda vieja sola y no avisa.** `Cantera` y `Despacho` las
 * agregaron a la planilla después de escribir el módulo, y hasta el 16/10/2026
 * el sistema no las conocía: la sincronización no las leía —sus cuatro
 * cotizaciones, las tres de la OS 240 y la de la OS 250, no existían en el
 * espejo— y una cotización cargada desde la app para esos sectores se escribía
 * en "Otros", que es adonde `pestanaDeSector` manda lo que no reconoce. Nada
 * falla: la fila entra, el número vuelve bien, y quien va a buscarla a la
 * pestaña de su sector no la encuentra. Por eso la sincronización ahora
 * compara esta lista contra las pestañas que la planilla tiene de verdad y lo
 * dice en el resultado.
 */
export const COMPARATIVA_PESTANAS = [
  "Planta Filler 2", "Planta Filler 1", "Compresores", "Molienda de cal",
  "Calcinación", "Planta 0-2 mm", "Planta de trituracion 1",
  "Planta de trituracion 2", "Planta de Trituracion 3", "Cantera",
  "Hidratacion", "Edificios", "Otros", "Despacho",
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

/**
 * Qué pestañas tiene la planilla que el sistema no conoce.
 *
 * Es el aviso que faltó cuando aparecieron `Cantera` y `Despacho`: una pestaña
 * nueva no rompe nada —las cotizaciones de ese sector caen en "Otros" y la
 * sincronización ni las mira—, así que sin esto se nota el día que alguien va
 * a buscar una cotización a la pestaña de su sector y no está.
 *
 * Se compara normalizado, por lo mismo que `pestanaDeSector`: la planilla
 * escribe "Calcinación" y el acento no puede decidir si una pestaña es nueva.
 */
export function pestanasQueFaltan(enLaPlanilla: readonly string[]): string[] {
  const conocidas = new Set(COMPARATIVA_PESTANAS.map(normalizar));
  return enLaPlanilla.filter((p) => !conocidas.has(normalizar(p)));
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

/**
 * Si esa fila es —o intenta ser— una cotización.
 *
 * Las pestañas traen **miles de filas de plantilla**: formato, fórmulas y
 * textos fijos que no son la cotización de nadie. Es la misma trampa que la
 * columna COMPARATIVA de las OS, que dice "LINK" en las mil filas de la pestaña
 * vengan o no con una orden. Por eso contar "filas no vacías" no sirve: da
 * 11.725 cuando las cotizaciones cargadas son 159.
 *
 * Lo que identifica a una cotización es tener N° de OS y proveedor —es lo que
 * exige `filaDeComparativa`—. Así que la fila que vale la pena mirar es la que
 * trae **uno de los dos y no el otro**: alguien la empezó a cargar y quedó a
 * medias. Sin ninguno de los dos es relleno, y nombrarla sería ruido.
 */
export function pareceCotizacion(fila: unknown[]): boolean {
  const osNumber = Number(fila[COL.osNumber]);
  if (osNumber && !isNaN(osNumber)) return true;

  // El guión suelto es como se escribe "acá no va nada" en estas planillas.
  // `texto()` no lo descarta —sólo el vacío y los errores de fórmula— así que
  // se descarta acá, igual que hace el helper `campo()` de las OS.
  const proveedor = texto(fila[COL.proveedor]);
  return proveedor !== null && proveedor !== "-";
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

/** La columna PRECIO TOTAL, que en la planilla es una fórmula y no un número. */
export const COLUMNA_PRECIO_TOTAL = COL.precioTotal;

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
 * Si el total de la cotización es el que la planilla calcularía sola.
 *
 * La columna J no es un número: es `=H+(H*I)`, el precio unitario más el IVA,
 * y está así en las catorce pestañas. Cuando el total que viene del formulario
 * es ése, escribirlo sería cambiar una fórmula por su resultado de hoy.
 *
 * El IVA viaja como fracción —0,21, que es como lo guarda la planilla y como
 * lo manda el formulario—, así que la cuenta es `H + H*I` tal cual.
 *
 * Sin total no hay nada que escribir y la fórmula hace el trabajo. Sin precio
 * unitario pasa lo contrario: la fórmula daría cero y el único número que hay
 * es el total cotizado, así que ése va escrito aunque la pise.
 *
 * La comparación tolera un centavo porque el formulario redondea
 * (`Math.round(u * (1 + iva) * 100) / 100`) y la planilla no: pedir igualdad
 * exacta entre dos floats daría "no coincide" en cotizaciones que coinciden.
 */
export function elTotalLoCalculaLaPlanilla(c: {
  precio_unitario?: string | null;
  iva?: number | null;
  precio_total?: string | null;
}): boolean {
  const total = monto(c.precio_total);
  if (total === null) return true;

  const unitario = monto(c.precio_unitario);
  if (unitario === null) return false;

  const calculado = unitario + unitario * (c.iva ?? 0);
  return Math.abs(total - calculado) <= 0.01;
}

/**
 * Una cotización como las quince celdas de la planilla.
 *
 * El orden es el de las columnas y no puede cambiar: la planilla se lee por
 * posición.
 *
 * Un `null` es "esta celda no se toca" —`agregarFila` parte la escritura en
 * tramos y la saltea—, y es lo que salva la fórmula del PRECIO TOTAL. Las
 * demás celdas van en `""` aunque estén vacías: ahí no hay fórmula que
 * cuidar, y dejarlas sin tocar heredaría lo que tuviera la fila de antes.
 */
export function filaParaComparativa(c: ParaEscribir): (string | number | null)[] {
  const fila: (string | number | null)[] = new Array(COLUMNAS_COMPARATIVA).fill("");

  fila[COL.osNumber] = c.os_number;
  fila[COL.fecha] = fechaAR(c.fecha);
  fila[COL.area] = c.area ?? "";
  fila[COL.sector] = c.sector ?? "";
  fila[COL.equipo] = c.equipo_raw ?? "";
  fila[COL.descripcion] = c.descripcion ?? "";
  fila[COL.proveedor] = c.proveedor;
  fila[COL.precioUnitario] = c.precio_unitario ?? "";
  fila[COL.iva] = c.iva ?? "";
  fila[COL.precioTotal] = elTotalLoCalculaLaPlanilla(c) ? null : c.precio_total ?? "";
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
