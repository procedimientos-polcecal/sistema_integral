/**
 * Órdenes de servicio: leer la planilla donde viven.
 *
 * Una OS es un trabajo que se le pide a un tercero —una reparación, un
 * servicio, una fabricación—, a diferencia de la OT, que la hace el personal
 * propio. Van aparte de los requerimientos de Compras: aquéllos piden
 * materiales, éstas piden trabajo.
 *
 * **Cómo está armada la planilla**, verificado contra ella:
 *
 * - `SERVICIOS` es la hoja maestra, pero **no se escribe**: sus columnas A..J
 *   son un `QUERY(IMPORTRANGE(...))` sobre la planilla de respuestas de un
 *   formulario de Google. Las OS nacen ahí, no acá. Sólo K (empresa) y L
 *   (estado) están escritas a mano.
 * - Cada pestaña de área es un `FILTER(SERVICIOS!A2:K; área=…; estado="APROBADO")`.
 *   Es decir: **A..K son fórmula** y sólo las columnas siguientes —comparativa,
 *   proveedor, estado, costo, fechas, observaciones— son valores escritos a
 *   mano. El seguimiento vive ahí.
 * - Y por eso el número de fila es inestable: cuando una OS entra o sale del
 *   `FILTER`, las de abajo se corren, pero el seguimiento escrito a mano **no
 *   se corre con ellas**. Antes de escribir hay que verificar la fila.
 *
 * Se lee por encabezado y no por posición: cada pestaña arma el suyo a su
 * manera y no todas traen las mismas columnas.
 */

import { texto, fechaDeSheets, codigoDeEquipo, normalizar, monto } from "@/lib/mantenimiento/planilla";

/**
 * Un campo de texto de la planilla.
 *
 * El guión suelto es como se escribe "acá no va nada": 39 filas lo tienen en
 * la columna del equipo, y ninguna se refiere a una máquina llamada "-".
 */
const campo = (v: unknown): string | null => {
  const s = texto(v);
  return s === null || s === "-" ? null : s;
};

/**
 * Las pestañas de la planilla, una por área.
 *
 * SERVICIOS va primera porque es la hoja maestra —la que tiene todas— y de ahí
 * salen las demás filtradas por área. "OTRA" es el cajón de lo que no tiene
 * pestaña propia.
 */
export const OS_PESTANAS = [
  "SERVICIOS",
  "MANTENIMIENTO", "TALLER VIAL", "PRODUCCIÓN", "LABORATORIO",
  "ALMACÉN", "INVERSIONES", "DESPACHO", "CANTERA", "OTRA",
] as const;

/**
 * Cómo puede llamarse cada columna.
 *
 * Cada pestaña la escribió alguien distinto en su momento, así que el mismo
 * dato aparece con nombres parecidos pero no iguales.
 */
export const ALIAS_OS: Record<string, string[]> = {
  os_number: ["N OS", "N° OS", "NRO OS", "NUMERO OS", "O.S"],
  fecha: ["FECHA"],
  area: ["AREA"],
  sector_raw: ["SECTOR"],
  equipo_raw: ["EQUIPO"],
  descripcion: ["DESCRIPCION"],
  fecha_requerimiento: ["FECHA DE REQ", "FECHA DE REQUERIMIENTO"],
  detalle_extra: ["DETALLE EXTRA"],
  imagen: ["IMAGEN"],
  prioridad: ["PRIORIDAD"],
  empresa: ["EMPRESA"],
  comparativa: ["COMPARATIVA"],
  proveedor_elegido: ["PROVEEDOR ELEGIDO"],
  estado: ["ESTADO"],
  cuit: ["CUIT"],
  tiene_orden_compra: ["TIENE ORDEN DE COMPRA"],
  costo: ["COSTO SIN IVA", "COSTO + IVA", "COSTO"],
  fecha_pedido: ["FECHA DE PEDIDO"],
  fecha_realizacion: ["FECHA DE REALIZACION"],
  observaciones: ["OBSERVACIONES EXTRA", "OBSERVACIONES"],
};

/**
 * Para comparar encabezados: sin acentos, en mayúscula y sin puntos.
 *
 * "N° OS", "N OS" y "N. OS" son la misma columna escrita tres veces.
 */
export const claveDeEncabezado = (v: unknown): string =>
  normalizar(v).toUpperCase().replace(/[.°]/g, "").replace(/\s+/g, " ").trim();

const PESTANA_POR_AREA = new Map(
  OS_PESTANAS.map((p) => [claveDeEncabezado(p), p as string])
);

/** En qué pestaña de la planilla va una OS, según su área. */
export function pestanaDeArea(area: string | null | undefined): string {
  return PESTANA_POR_AREA.get(claveDeEncabezado(area)) ?? "OTRA";
}

/** Dónde quedó cada dato en esta pestaña. `-1` es que la pestaña no lo tiene. */
export type IndiceOS = Record<string, number>;

/**
 * El encabezado de una pestaña, resuelto a índices de columna.
 *
 * Si el número de OS no se reconoce se usa la columna A: en SERVICIOS el
 * encabezado viene raro, pero el número siempre está primero.
 */
export function mapearEncabezados(encabezado: unknown[]): IndiceOS {
  const claves = encabezado.map(claveDeEncabezado);
  const idx: IndiceOS = {};

  for (const [clave, alias] of Object.entries(ALIAS_OS)) {
    idx[clave] = -1;
    for (const a of alias) {
      const i = claves.indexOf(claveDeEncabezado(a));
      if (i >= 0) { idx[clave] = i; break; }
    }
  }

  if (idx.os_number < 0) idx.os_number = 0;
  return idx;
}

export interface OrdenServicioLeida {
  os_number: number;
  fecha: string | null;
  area: string;
  sector_raw: string | null;
  equipo_raw: string | null;
  equipo_code: string | null;
  descripcion: string | null;
  fecha_requerimiento: string | null;
  detalle_extra: string | null;
  imagen: string | null;
  prioridad: string | null;
  empresa: string | null;
  comparativa: string | null;
  proveedor_elegido: string | null;
  estado: string | null;
  cuit: string | null;
  tiene_orden_compra: string | null;
  costo: number | null;
  fecha_pedido: string | null;
  fecha_realizacion: string | null;
  observaciones: string | null;
  sheets_tab: string;
  sheets_row: number;
}

/** Una fila de la planilla como orden de servicio. `null` si no lo es. */
export function filaDeOS(
  fila: unknown[], idx: IndiceOS, pestana: string, numeroFila: number
): OrdenServicioLeida | null {
  const celda = (clave: string): unknown => {
    const i = idx[clave];
    return i >= 0 ? fila[i] : undefined;
  };

  const osNumber = Number(celda("os_number"));
  if (!osNumber || isNaN(osNumber)) return null;

  const equipoRaw = campo(celda("equipo_raw"));

  return {
    os_number: osNumber,
    fecha: fechaDeSheets(celda("fecha")),
    // Sin área en la celda vale la pestaña: la pestaña ES el área.
    area: campo(celda("area")) ?? pestana,
    sector_raw: campo(celda("sector_raw")),
    equipo_raw: equipoRaw,
    equipo_code: codigoDeEquipo(equipoRaw),
    descripcion: campo(celda("descripcion")),
    fecha_requerimiento: fechaDeSheets(celda("fecha_requerimiento")),
    detalle_extra: campo(celda("detalle_extra")),
    imagen: campo(celda("imagen")),
    prioridad: campo(celda("prioridad")),
    empresa: campo(celda("empresa")),
    comparativa: campo(celda("comparativa")),
    proveedor_elegido: campo(celda("proveedor_elegido")),
    estado: campo(celda("estado")),
    cuit: campo(celda("cuit")),
    tiene_orden_compra: campo(celda("tiene_orden_compra")),
    costo: monto(celda("costo")),
    fecha_pedido: fechaDeSheets(celda("fecha_pedido")),
    fecha_realizacion: fechaDeSheets(celda("fecha_realizacion")),
    observaciones: campo(celda("observaciones")),
    sheets_tab: pestana,
    sheets_row: numeroFila,
  };
}

/**
 * Los estados por los que pasa una OS, verificados contra la planilla.
 *
 * En orden del circuito: se pide, se revisa, se aprueba, se comparan
 * proveedores y se acepta uno. No son los de las OT ni los de Compras.
 *
 * DENEGADO va al final porque no es un paso del circuito sino su salida, igual
 * que EN_ESPERA en Compras. Es la palabra que ya se escribe a mano en la
 * planilla: usar otra dejaría los dos lados diciendo cosas distintas del mismo
 * pedido. Lo que exige al denegar —el motivo— vive en `denegacion.ts`.
 */
export const ESTADOS_OS = [
  "POR APROBAR",
  "EN REVISIÓN",
  "APROBADO",
  "EN PROCESO (COMPARATIVA)",
  "ACEPTADO",
  "DENEGADO",
] as const;

/** Con qué estado nace una OS. */
export const ESTADO_INICIAL_OS = "POR APROBAR";

/**
 * Las prioridades de la planilla, de más a menos urgente.
 *
 * Verificadas contra ella: no son ALTA/MEDIA/BAJA como en las órdenes de
 * trabajo, y usar ésas dejaría dos vocabularios para lo mismo.
 */
export const PRIORIDADES_OS = ["URGENTE", "1 SEMANA", "NORMAL", "LEVE"] as const;

/**
 * Lo que la app puede escribir en la planilla: el seguimiento.
 *
 * Todo lo demás —el número, la fecha, el área, el sector, el equipo, la
 * descripción, la prioridad, la empresa— llega por fórmula desde SERVICIOS, y
 * SERVICIOS a su vez lo importa del formulario. Escribir ahí no cambia el dato:
 * rompe la fórmula, y con ella toda la pestaña.
 */
const SEGUIMIENTO = [
  "comparativa", "proveedor_elegido", "estado", "cuit", "tiene_orden_compra",
  "costo", "fecha_pedido", "fecha_realizacion", "observaciones",
];

/** Si ese dato se puede escribir en la planilla. */
export function puedeEscribirse(clave: string): boolean {
  return SEGUIMIENTO.includes(clave);
}

/**
 * Si una fila tiene seguimiento cargado pero ninguna OS a la izquierda.
 *
 * Pasa porque el `FILTER` corre las filas cuando una OS entra o sale, y el
 * seguimiento escrito a mano no se corre con ellas: queda un proveedor, un
 * costo o una fecha colgados de ninguna orden. Detectarlo es lo único que se
 * puede hacer desde afuera —arreglarlo es a mano, en la planilla—.
 */
export function seguimientoHuerfano(fila: unknown[]): boolean {
  // A..K es lo que trae el FILTER. La L —COMPARATIVA— no cuenta: dice "LINK"
  // en las mil filas de la pestaña, vengan o no con una OS, así que mirarla
  // daría por huérfana a la planilla entera. La señal empieza en la M.
  const delFilter = fila.slice(0, 11).some((c) => texto(c) !== null);
  const aMano = fila.slice(12).some((c) => texto(c) !== null);
  return aMano && !delFilter;
}
