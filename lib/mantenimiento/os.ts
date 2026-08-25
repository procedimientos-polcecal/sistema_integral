/**
 * Órdenes de servicio: leer la planilla donde viven.
 *
 * Una OS es un trabajo que se le pide a un tercero —una reparación, un
 * servicio, una fabricación—, a diferencia de la OT, que la hace el personal
 * propio. Van aparte de los requerimientos de Compras: aquéllos piden
 * materiales, éstas piden trabajo.
 *
 * La planilla tiene **una pestaña por área** y cada una arma su encabezado a su
 * manera, así que se lee por encabezado y no por posición: es lo que evita que
 * agregar una columna en una pestaña rompa la lectura de las otras.
 */

import { texto, fechaDeSheets, codigoDeEquipo, normalizar, monto } from "@/lib/mantenimiento/planilla";

/**
 * Las pestañas de la planilla, una por área.
 *
 * SERVICIOS va primera porque es la hoja maestra: ahí se cargan las OS nuevas
 * y de ahí salen las demás filtradas por área. "OTRA" es el cajón de lo que no
 * tiene pestaña propia.
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

  const equipoRaw = texto(celda("equipo_raw"));

  return {
    os_number: osNumber,
    fecha: fechaDeSheets(celda("fecha")),
    // Sin área en la celda vale la pestaña: la pestaña ES el área.
    area: texto(celda("area")) ?? pestana,
    sector_raw: texto(celda("sector_raw")),
    equipo_raw: equipoRaw,
    equipo_code: codigoDeEquipo(equipoRaw),
    descripcion: texto(celda("descripcion")),
    fecha_requerimiento: fechaDeSheets(celda("fecha_requerimiento")),
    detalle_extra: texto(celda("detalle_extra")),
    imagen: texto(celda("imagen")),
    prioridad: texto(celda("prioridad")),
    empresa: texto(celda("empresa")),
    comparativa: texto(celda("comparativa")),
    proveedor_elegido: texto(celda("proveedor_elegido")),
    estado: texto(celda("estado")),
    cuit: texto(celda("cuit")),
    tiene_orden_compra: texto(celda("tiene_orden_compra")),
    costo: monto(celda("costo")),
    fecha_pedido: fechaDeSheets(celda("fecha_pedido")),
    fecha_realizacion: fechaDeSheets(celda("fecha_realizacion")),
    observaciones: texto(celda("observaciones")),
    sheets_tab: pestana,
    sheets_row: numeroFila,
  };
}

/**
 * El valor de cada columna para escribir una fila nueva en la planilla.
 *
 * Se arma siguiendo el encabezado de la pestaña, no un orden fijo: cada
 * pestaña tiene el suyo y escribir a ciegas correría los datos de columna.
 */
export function filaParaPlanilla(
  encabezado: unknown[], valores: Record<string, string | number | null>
): (string | number)[] {
  return encabezado.map((h) => {
    const clave = claveDeEncabezado(h);
    for (const [nombre, alias] of Object.entries(ALIAS_OS)) {
      if (alias.some((a) => claveDeEncabezado(a) === clave)) {
        return valores[nombre] ?? "";
      }
    }
    return "";
  });
}
