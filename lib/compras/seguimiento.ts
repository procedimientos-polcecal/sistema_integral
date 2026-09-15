/**
 * Seguimiento de la compra: lo puro.
 *
 * Acá vive lo que se testea —la fila que se escribe en el master de
 * SEGUIMIENTO DE COMPRA y el dato duro que se muestra al lado del juicio—.
 * El I/O está en `seguimientoSheets.ts`.
 */

import { serialDelDia } from "@/lib/core/fechaDeSheets";
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

/** Lo que la pantalla muestra al lado de cada juicio. `null` = no hay qué decir. */
export interface ComoLlego {
  demora: string | null;
  cantidad: string | null;
}

/**
 * El dato duro, para decidir el juicio mirándolo.
 *
 * NO decide el juicio: `Cumplió COMPRAS?` y `Cumplió PROV?` son de la persona.
 * Se midió sobre las 1.757 filas del histórico y no hay regla: 295 de los "Sí"
 * de Compras habían llegado tarde, y 16 de los "No" del proveedor habían
 * recibido todo. Llegar tarde avisando no es lo mismo que llegar tarde.
 */
export function comoLeLlego(r: {
  fecha_estimada_recepcion: string | null;
  fecha_recepcion: string | null;
  cantidad: number | null;
  cantidad_comprada: number | null;
  cantidad_recibida: number | null;
}): ComoLlego {
  return { demora: laDemora(r), cantidad: laCantidad(r) };
}

function laDemora(r: {
  fecha_estimada_recepcion: string | null;
  fecha_recepcion: string | null;
}): string | null {
  if (!r.fecha_estimada_recepcion || !r.fecha_recepcion) return null;

  // La misma guardia que usa `fecha()` para escribir en la planilla: una fecha
  // que no existe, o que no viene como YYYY-MM-DD, no se corrige ni se estima.
  // Sin esto, un `" "` daba "llegó 46310 días tarde" —un número con forma de
  // dato real al lado de un juicio que carga una persona—, que es peor que no
  // decir nada.
  const estimada = serialDelDia(r.fecha_estimada_recepcion);
  const recibida = serialDelDia(r.fecha_recepcion);
  if (estimada === null || recibida === null) return null;

  // Los seriales ya son días enteros, así que la resta es la cantidad de días y
  // no hay husos de por medio.
  const dias = recibida - estimada;

  if (dias <= 0) return "llegó a tiempo";
  return `llegó ${dias} ${dias === 1 ? "día" : "días"} tarde`;
}

function laCantidad(r: {
  cantidad: number | null;
  cantidad_comprada: number | null;
  cantidad_recibida: number | null;
}): string | null {
  const recibida = r.cantidad_recibida;
  const esperada = r.cantidad_comprada ?? r.cantidad;
  if (recibida === null || esperada === null) return null;

  if (recibida === esperada) return "recibió todo lo comprado";
  if (recibida > esperada) {
    return `recibió ${recibida} de ${esperada}: ${recibida - esperada} de más`;
  }
  return `recibió ${recibida} de ${esperada}`;
}
