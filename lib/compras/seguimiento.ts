/**
 * Seguimiento de la compra: lo puro.
 *
 * Acá vive lo que se testea —la fila que se escribe en el master de
 * SEGUIMIENTO DE COMPRA y el dato duro que se muestra al lado del juicio—.
 * El I/O está en `seguimientoSheets.ts`.
 */

import { fechaDeSheets, serialDelDia } from "@/lib/core/fechaDeSheets";
import { empresaParaPlanilla } from "@/lib/compras/sheets";
import type { Cumplio } from "@/lib/compras/types";

/** Cómo se escribe cada juicio en la planilla. "Si" va sin tilde: es así allá. */
export const ETIQUETA_CUMPLIO: Record<Cumplio, string> = {
  SI: "Si",
  MAS_O_MENOS: "Más o menos",
  NO: "No",
};

/** Lo que hace falta saber de un RI para armar su fila. */
export interface DatosDeSeguimiento {
  nro_ri: number;
  codigo: string | null;
  area: string | null;
  descripcion: string | null;
  proveedor: string | null;
  empresa: string | null;
  paga_ambas: boolean;
  cantidad: number | null;
  cantidad_comprada: number | null;
  cantidad_recibida: number | null;
  fecha_estimada_recepcion: string | null;
  fecha_recepcion: string | null;
  cumplio_compras: Cumplio | null;
  cumplio_proveedor: Cumplio | null;
}

const texto = (n: number | null) => (n === null || n === undefined ? "" : String(n));

/**
 * La fecha como serial, que es como la escribe todo el sistema.
 *
 * `serialDelDia` devuelve null para una fecha que no existe —el 30 de febrero
 * no se rueda al 2 de marzo— y acá eso queda en celda vacía: una celda vacía
 * se ve, una fecha corrida tres días no.
 */
const fecha = (iso: string | null) => {
  const serial = iso ? serialDelDia(iso) : null;
  return serial === null ? "" : String(serial);
};

/**
 * Las trece celdas de una fila de `COMPRAS CON RI`, en orden A..M.
 *
 * `null` en una posición significa **no escribir esa celda**, y hoy le pasa a
 * una sola: `MAIL_ENVIADO`. Un Apps Script de la planilla barre el master
 * buscando "fecha de recepción sin mail enviado" para avisarle al área, y
 * estampa el "SI". Si al reescribir una fila pisáramos esa celda con vacío, el
 * área recibiría el aviso de nuevo. La planilla manda sobre esa columna, igual
 * que sobre la celda LINK de la comparativa en el otro libro.
 *
 * El SdG no puede mandar ese mail en su lugar: no hay transporte de correo en
 * el proyecto —Remises usa web push— ni dirección de mail por área en la base.
 */
export function filaDeSeguimiento(r: DatosDeSeguimiento): (string | null)[] {
  return [
    String(r.nro_ri),                                    // A  NºRI
    r.codigo ?? "",                                      // B  CODIGO
    r.area ?? "",                                        // C  ÁREA
    r.descripcion ?? "",                                 // D  Descripción
    r.proveedor ?? "",                                   // E  Proveedor
    empresaParaPlanilla(r.empresa, r.paga_ambas),        // F  ¿Quién compro?
    texto(r.cantidad_comprada ?? r.cantidad),            // G  Cant Pedida
    texto(r.cantidad_recibida),                          // H  Cant Recibida
    fecha(r.fecha_estimada_recepcion),                   // I  Fecha estimada
    fecha(r.fecha_recepcion),                            // J  Fecha de recepción
    null,                                                // K  MAIL_ENVIADO ← nunca
    r.cumplio_compras ? ETIQUETA_CUMPLIO[r.cumplio_compras] : "",     // L
    r.cumplio_proveedor ? ETIQUETA_CUMPLIO[r.cumplio_proveedor] : "", // M
  ];
}
