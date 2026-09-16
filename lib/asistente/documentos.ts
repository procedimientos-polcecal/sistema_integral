import type { Modulo } from "@/lib/core/types";
import type { Ambito } from "./modulos";

/**
 * Qué documento de `docs/` puede leer cada usuario.
 *
 * Los documentos son técnicos y describen el sistema, no los datos, así que el
 * riesgo es bajo — pero se filtran igual por los mismos módulos que las tablas,
 * porque algunos traen ejemplos con datos reales y porque una regla que vale
 * para una mitad y no para la otra es una regla que alguien va a leer mal.
 *
 * La lista es explícita y no un `readdir`: un documento nuevo no queda visible
 * por descuido. Si falta uno, se agrega acá.
 */
const AMBITO_DEL_DOCUMENTO: Record<string, Ambito> = {
  "NUCLEO-COMPARTIDO.md": "nucleo",
  "AUTENTICACION.md": "nucleo",
  "BACKUPS.md": "nucleo",
  "VARIABLES-VERCEL.md": "nucleo",
  "ODOO-INTEGRACION.md": "nucleo",
  "COMPRAS.md": "compras",
  "COMPRAS-ESTADO.md": "compras",
  "COMPRAS-SINCRONIZACION.md": "compras",
  "COMPRAS-ANALISIS-PLANILLA.md": "compras",
  "COMPRAS-PROVEEDORES-ODOO.md": "compras",
  "MANTENIMIENTO-INTEGRACION.md": "mantenimiento",
  "RRHH-ACTUALIZACION.md": "rrhh",
  "RRHH-RENDIMIENTO.md": "rrhh",
  "PRODUCCION.md": "produccion",
  "DESPACHO.md": "despacho",
  "FACTURACION.md": "facturacion",
};

export function documentosPara(modulos: Modulo[]): string[] {
  const suyos = new Set<Ambito>([...modulos, "nucleo"]);
  return Object.keys(AMBITO_DEL_DOCUMENTO)
    .filter((d) => suyos.has(AMBITO_DEL_DOCUMENTO[d]))
    .sort();
}

/**
 * La ruta en disco de un documento, o null si no corresponde.
 *
 * El nombre lo escribe el modelo, así que es entrada no confiable: se compara
 * contra la lista, no se concatena. Sin esto, un "../.env.local" lee secretos.
 */
export function rutaDelDocumento(nombre: string, modulos: Modulo[]): string | null {
  if (!documentosPara(modulos).includes(nombre)) return null;
  return `docs/${nombre}`;
}
