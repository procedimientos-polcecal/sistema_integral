/**
 * Los filtros del listado de órdenes de servicio.
 *
 * La pantalla tenía tres —buscador, área, estado y un tilde de "sin
 * proveedor"— y con eso no se contestan las preguntas que se hacen todos los
 * días: «qué hay urgente sin proveedor elegido», «qué le compramos a Candia
 * este año», «qué de Polysan está esperando comparativa», «qué pasó de tal
 * monto». Acá están todas las columnas que tienen dato suficiente para
 * preguntarles algo.
 *
 * ── QUÉ SE FILTRA Y QUÉ NO, MEDIDO ─────────────────────────────────────────
 *
 * Medido el 05/11/2026 sobre las 276 órdenes que hay en la base:
 *
 *   área                 276/276, 8 valores
 *   estado               237/276, 4 valores en uso de los 6 del vocabulario
 *   prioridad            247/276, 4 valores
 *   empresa              259/276, 3 valores
 *   sector               276/276, 17 escritos · 237 enlazados
 *   equipo               254/276, 83 escritos · 237 enlazados
 *   proveedor elegido    192/276, 83 distintos
 *   costo                190/276, de 0 a 41.500.000
 *   fecha                276/276 · requerimiento 235 · realización 40
 *   orden de compra       60/276
 *   imagen                40/276
 *   cotizaciones         164/276 tienen al menos una
 *
 * **Las que quedaron afuera, y por qué**, que es lo que evita que alguien las
 * vuelva a mirar:
 *
 * - `app_created` es `false` en las 276: un filtro que no parte nada.
 * - `cuit` tiene 8 y `observaciones` 3. No dan un desplegable; entran al
 *   buscador, que es donde sirven.
 * - `motivo_rechazo` tiene 0 porque todavía no se denegó ninguna. Entra al
 *   buscador por lo mismo que el anterior, y el estado DENEGADO ya está en el
 *   desplegable esperándolo.
 * - `comparativa` tiene 258 valores pero son dos: la palabra "LINK" y una URL.
 *   Lo que de verdad se quiere preguntar —si la OS tiene cotizaciones
 *   cargadas— se contesta con `os_comparativas`, y ése sí está.
 * - `sheets_tab` repite el área con otro nombre y en mayúsculas. Dos filtros
 *   para la misma pregunta es peor que uno.
 *
 * `fecha_pedido` está entre las fechas **aunque hoy tenga 0 filas**: no es una
 * columna muerta sino una que todavía nadie cargó —la escribe el detalle de la
 * OS y se exporta a la planilla—, así que el día que se use ya se puede
 * preguntar por ella. Es la misma decisión que los tipos de OT con 0 usos.
 *
 * ── CÓMO SE COMBINAN ───────────────────────────────────────────────────────
 *
 * Dentro de un filtro los valores suman (o) y entre filtros se recortan (y),
 * igual que en el listado de órdenes de trabajo. «Urgente o 1 semana, de
 * Polysan» es una sola pregunta y antes eran tres pasadas.
 *
 * Todo pasa en el navegador: la pantalla ya se trae las 276 órdenes enteras
 * para poder buscar sin volver al servidor en cada tecla.
 */

import { coincide } from "@/lib/core/texto";
import { ESTADOS_OS, PRIORIDADES_OS } from "./os";
import type { OrdenServicio } from "./types";

/** Una opción de un desplegable: lo que viaja al filtro y cómo se lee. */
export type OpcionDeFiltro = [valor: string, etiqueta: string];

/**
 * El valor que quiere decir "esta columna está vacía".
 *
 * Hace falta porque **la mitad de las preguntas útiles son por lo que falta**:
 * 39 órdenes sin estado, 29 sin prioridad, 84 sin proveedor elegido. Un
 * desplegable armado sólo con los valores presentes —que es lo que había— deja
 * esas filas fuera del alcance de cualquier filtro: aparecen únicamente cuando
 * no se filtra por nada.
 *
 * Lleva dos guiones bajos a propósito: tiene que no poder chocar con un valor
 * de la planilla, donde las columnas son texto libre.
 */
export const SIN_CARGAR = "__sin_cargar__";

/** Una pregunta de sí o no: vacío es "no preguntar". */
export type Ternario = "" | "si" | "no";

/** Las cuatro fechas de una OS, con cómo se leen. */
export const CAMPOS_DE_FECHA_OS = [
  ["fecha", "Fecha del pedido"],
  ["fecha_requerimiento", "Fecha en que se necesita"],
  ["fecha_pedido", "Fecha en que se encargó"],
  ["fecha_realizacion", "Fecha en que se hizo"],
] as const;

export type CampoDeFechaOs = (typeof CAMPOS_DE_FECHA_OS)[number][0];

/** Qué puede faltarle enlazar a una OS. */
export const ENLACES_OS = [
  ["", "Enlazada o no"],
  ["alguno", "Algo sin enlazar"],
  ["equipo", "Equipo sin enlazar"],
  ["sector", "Sector sin enlazar"],
] as const;

export type EnlaceOs = (typeof ENLACES_OS)[number][0];

export interface FiltrosOs {
  busqueda: string;
  area: string[];
  estado: string[];
  prioridad: string[];
  empresa: string[];
  sector: string[];
  equipo: string[];
  proveedor: string[];
  campoFecha: CampoDeFechaOs;
  desde: string;
  hasta: string;
  costoDesde: string;
  costoHasta: string;
  /** Si tiene cotizaciones cargadas en la comparativa. */
  cotizaciones: Ternario;
  /** Si la planilla le anotó un N° de orden de compra. */
  ordenCompra: Ternario;
  /** Si tiene costo cargado, sin importar cuánto. */
  costo: Ternario;
  /** Si el formulario trajo una foto. */
  foto: Ternario;
  enlace: EnlaceOs;
}

export const FILTROS_OS_VACIOS: FiltrosOs = {
  busqueda: "",
  area: [],
  estado: [],
  prioridad: [],
  empresa: [],
  sector: [],
  equipo: [],
  proveedor: [],
  campoFecha: "fecha",
  desde: "",
  hasta: "",
  costoDesde: "",
  costoHasta: "",
  cotizaciones: "",
  ordenCompra: "",
  costo: "",
  foto: "",
  enlace: "",
};

/**
 * El sector de una OS tal como lo muestra la tabla.
 *
 * Vive acá y no en la pantalla porque **el desplegable y la columna tienen que
 * decir lo mismo**: si el filtro se armara con `sector_raw` y la columna
 * mostrara el nombre del catálogo, elegir "Planta 0-2 mm" podría no devolver
 * las filas que en pantalla dicen "Planta 0-2 mm". Dos formas de nombrar lo
 * mismo es el error que no se nota.
 */
export const sectorDeLaOS = (o: OrdenServicio): string | null =>
  o.sectores?.nombre ?? o.sector_raw ?? null;

/** El equipo de una OS tal como lo muestra la tabla. Mismo motivo. */
export const equipoDeLaOS = (o: OrdenServicio): string | null =>
  o.equipos?.name ?? o.equipo_raw ?? null;

/**
 * Si la celda de orden de compra trae un número.
 *
 * La columna es texto libre y tiene las dos cosas: 56 filas con el N° de la OC
 * y 4 que dicen "Hacer orden de compra", que es un recordatorio y no una orden.
 * Preguntar por "tiene orden de compra" contando el texto daría esas 4 por
 * hechas, que es justo al revés de lo que pasa.
 */
export const tieneNumeroDeOrdenDeCompra = (v: string | null): boolean =>
  v !== null && /\d/.test(v);

/**
 * Las opciones de cada desplegable, sacadas de las órdenes que hay.
 *
 * Los vocabularios cerrados —estado y prioridad— van **completos y en su
 * orden**, no alfabéticos y no sólo los que tienen filas:
 *
 * - El orden del circuito significa algo. Alfabético, "ACEPTADO" queda antes
 *   que "POR APROBAR" y la lista deja de leerse como el camino de una OS.
 * - Un valor sin filas hoy es una pregunta válida igual: "¿hay alguna
 *   denegada?" se contesta con un cero, y si la opción no está, no se contesta.
 *   Es lo que pasó con los tipos de OT que las pantallas ofrecían y el filtro
 *   no listaba.
 *
 * Y lo que esté cargado **fuera** del vocabulario se suma al final: la columna
 * es texto libre, así que una palabra nueva en la planilla no puede quedar
 * fuera del alcance del filtro sin que nadie se entere.
 */
export function opcionesDeLasOrdenes(ordenes: OrdenServicio[]) {
  return {
    area: libres(ordenes.map((o) => o.area), "Sin área"),
    estado: conVocabulario(ordenes.map((o) => o.estado), ESTADOS_OS, "Sin estado"),
    prioridad: conVocabulario(ordenes.map((o) => o.prioridad), PRIORIDADES_OS, "Sin prioridad"),
    empresa: libres(ordenes.map((o) => o.empresa), "Sin empresa"),
    sector: libres(ordenes.map(sectorDeLaOS), "Sin sector"),
    equipo: libres(ordenes.map(equipoDeLaOS), "Sin equipo"),
    proveedor: libres(ordenes.map((o) => o.proveedor_elegido), "Sin proveedor elegido"),
  };
}

/** Las opciones de una columna de texto libre, ordenadas, más la de "vacío". */
function libres(valores: (string | null)[], comoSeLeeElVacio: string): OpcionDeFiltro[] {
  const presentes = [...new Set(valores.filter((v): v is string => Boolean(v)))]
    .sort((a, b) => a.localeCompare(b, "es"));
  const opciones: OpcionDeFiltro[] = presentes.map((v) => [v, v]);
  if (valores.some((v) => !v)) opciones.push([SIN_CARGAR, comoSeLeeElVacio]);
  return opciones;
}

/** Las de una columna con vocabulario: primero el vocabulario, después lo raro. */
function conVocabulario(
  valores: (string | null)[],
  vocabulario: readonly string[],
  comoSeLeeElVacio: string,
): OpcionDeFiltro[] {
  const presentes = new Set(valores.filter((v): v is string => Boolean(v)));
  const fuera = [...presentes].filter((v) => !vocabulario.includes(v))
    .sort((a, b) => a.localeCompare(b, "es"));
  const opciones: OpcionDeFiltro[] = [...vocabulario, ...fuera].map((v) => [v, v]);
  if (valores.some((v) => !v)) opciones.push([SIN_CARGAR, comoSeLeeElVacio]);
  return opciones;
}

/** Si un valor pasa un filtro de lista, contando el vacío como `SIN_CARGAR`. */
function pasa(elegidos: string[], valor: string | null): boolean {
  if (elegidos.length === 0) return true;
  return valor ? elegidos.includes(valor) : elegidos.includes(SIN_CARGAR);
}

/** Si un sí/no se cumple. */
function pasaTernario(filtro: Ternario, lo: boolean): boolean {
  return filtro === "" || (filtro === "si") === lo;
}

/**
 * Todo lo que se puede buscar escribiendo.
 *
 * Es más de lo que mostraba el buscador viejo, que miraba cinco campos. Los
 * que se sumaron y por qué:
 *
 * - **`detalle_extra`**, que tiene 263 de 276 filas y es donde está el texto
 *   que escribe quien pide: "ADJUNTO FOTOS Y COTIZACIÓN PEDIDA HACE 2 MESES".
 *   Era el campo con más prosa del módulo y no se podía buscar.
 * - **el código del equipo** (`PY-B1-09`), que es como lo nombra el que anda
 *   en planta, mientras que la columna muestra el nombre.
 * - **el N° de orden de compra**, `cuit`, `observaciones` y `motivo_rechazo`,
 *   que son pocos para un desplegable y exactos para escribirlos.
 *
 * El área y el estado **no** entran: tienen su propio desplegable, y meterlos
 * acá haría que buscar "cantera" devolviera además las 220 de Mantenimiento
 * que no tienen nada que ver.
 */
function dondeSeBusca(o: OrdenServicio): string {
  return [
    o.os_number === null ? "" : `OS ${o.os_number}`,
    o.descripcion,
    o.detalle_extra,
    o.equipo_raw,
    o.equipos?.name,
    o.equipo_code,
    o.sector_raw,
    o.sectores?.nombre,
    o.proveedor_elegido,
    o.tiene_orden_compra,
    o.cuit,
    o.observaciones,
    o.motivo_rechazo,
  ].filter(Boolean).join(" ");
}

/**
 * Las órdenes que quedan después de aplicar los filtros.
 *
 * `cotizacionesPorOS` llega de afuera porque las cotizaciones viven en otra
 * tabla: la pantalla ya las cuenta para saber si abrir la comparativa.
 */
export function filtrarOrdenesDeServicio(
  ordenes: OrdenServicio[],
  f: FiltrosOs,
  cotizacionesPorOS: Record<number, number>,
): OrdenServicio[] {
  const desde = Number(f.costoDesde);
  const hasta = Number(f.costoHasta);
  const hayDesde = f.costoDesde.trim() !== "" && Number.isFinite(desde);
  const hayHasta = f.costoHasta.trim() !== "" && Number.isFinite(hasta);

  return ordenes.filter((o) => {
    if (!pasa(f.area, o.area)) return false;
    if (!pasa(f.estado, o.estado)) return false;
    if (!pasa(f.prioridad, o.prioridad)) return false;
    if (!pasa(f.empresa, o.empresa)) return false;
    if (!pasa(f.sector, sectorDeLaOS(o))) return false;
    if (!pasa(f.equipo, equipoDeLaOS(o))) return false;
    if (!pasa(f.proveedor, o.proveedor_elegido)) return false;

    // Una fecha vacía no entra en ningún rango. Es lo contrario de lo que hace
    // una lista —donde el vacío es una opción más— porque "del 1 al 31" no
    // tiene forma de incluir a la que no tiene fecha sin mentir sobre ella.
    const cuando = o[f.campoFecha];
    if (f.desde && (!cuando || cuando < f.desde)) return false;
    if (f.hasta && (!cuando || cuando > f.hasta)) return false;

    if (hayDesde && (o.costo === null || o.costo < desde)) return false;
    if (hayHasta && (o.costo === null || o.costo > hasta)) return false;

    const cuantas = o.os_number ? cotizacionesPorOS[o.os_number] ?? 0 : 0;
    if (!pasaTernario(f.cotizaciones, cuantas > 0)) return false;
    if (!pasaTernario(f.ordenCompra, tieneNumeroDeOrdenDeCompra(o.tiene_orden_compra))) return false;
    if (!pasaTernario(f.costo, o.costo !== null)) return false;
    if (!pasaTernario(f.foto, Boolean(o.imagen))) return false;

    const equipoSuelto = Boolean(o.equipo_raw) && !o.equipment_id;
    const sectorSuelto = Boolean(o.sector_raw) && !o.sector_id;
    if (f.enlace === "equipo" && !equipoSuelto) return false;
    if (f.enlace === "sector" && !sectorSuelto) return false;
    if (f.enlace === "alguno" && !equipoSuelto && !sectorSuelto) return false;

    return coincide(dondeSeBusca(o), f.busqueda);
  });
}

/**
 * Cuántos filtros están puestos.
 *
 * Es para el botón de limpiar y para decirlo en pantalla: en el teléfono la
 * fila arranca cerrada, así que **un filtro puesto se vuelve invisible** y una
 * lista corta parece una lista vacía. El rango de fechas y el de costo cuentan
 * como uno cada uno aunque sean dos campos: se leen como una sola frase.
 */
export function cuantosFiltrosPuestos(f: FiltrosOs): number {
  const listas = [f.area, f.estado, f.prioridad, f.empresa, f.sector, f.equipo, f.proveedor];
  return (
    listas.filter((l) => l.length > 0).length +
    (f.busqueda.trim() ? 1 : 0) +
    (f.desde || f.hasta ? 1 : 0) +
    (f.costoDesde.trim() || f.costoHasta.trim() ? 1 : 0) +
    [f.cotizaciones, f.ordenCompra, f.costo, f.foto].filter(Boolean).length +
    (f.enlace ? 1 : 0)
  );
}
