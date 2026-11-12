/**
 * El borrador del reclamo que el área le manda a Compras.
 *
 * No es un formulario: es el texto con el que se abre el hilo de mensajes que
 * ya existe sobre ese requerimiento, **editable antes de enviar**. Quien
 * reclama agrega el contexto que el sistema no sabe —que esa pieza traba una
 * OT, que la obra arranca el lunes—, y eso es justamente lo que vuelve útil al
 * reclamo.
 *
 * Por qué existe: el motivo de una demora no está escrito en ningún lado.
 * Medido el 30/10/2026, `compras_historial` tenía **3 notas en 3.561
 * renglones**. El reclamo telefónico hay que repetirlo cada vez que alguien
 * pregunta; éste queda pegado al RI y el área lo lee sin volver a preguntar.
 */

import { COMPRA_LABELS } from "./constants";
import { recortarParaPantalla } from "./texto";
import type { EstadoCompra } from "./types";

/** Cuánto de la descripción entra en el borrador antes de volverse una pared. */
const LARGO_DE_LA_DESCRIPCION = 60;

export function textoDelReclamo(p: {
  nro_ri: number;
  descripcion: string | null;
  dias: number;
  estado: string;
}): string {
  // La etiqueta sale del catálogo y no de una copia: si alguien renombra un
  // estado, el reclamo tiene que decir lo mismo que el chip que está dos
  // centímetros más arriba en la misma pantalla.
  const estado = COMPRA_LABELS[p.estado as EstadoCompra]?.label ?? p.estado;
  const que = p.descripcion
    ? ` (${recortarParaPantalla(p.descripcion, LARGO_DE_LA_DESCRIPCION)})`
    : "";
  const tiempo = `${p.dias} ${p.dias === 1 ? "día" : "días"}`;

  return (
    `El RI ${p.nro_ri}${que} lleva ${tiempo} sin avanzar, en estado ${estado}. ` +
    "¿Nos pueden decir por qué está demorado?"
  );
}
