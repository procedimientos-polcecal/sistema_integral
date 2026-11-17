/**
 * Si una factura leída se puede guardar **sin que nadie la mire**.
 *
 * ## Por qué existe
 *
 * El buzón traía 398 adjuntos pendientes y el sistema tenía **3 facturas
 * cargadas** (medido el 29/10/2026). El cuello no era el lector —el QR se lee
 * al 98%— sino que cada pendiente son dos clics en serie: uno en la bandeja,
 * que baja y lee, y otro en la fila, que guarda. 796 clics, y la bandeja
 * deshabilita todo mientras una está en curso.
 *
 * Con esto, las que el QR resolvió enteras se guardan solas y en la cola
 * quedan **sólo las que necesitan una decisión**.
 *
 * ## Las cuatro condiciones, y por qué cada una
 *
 * Son conjuntas: con que falte una, la factura va a la cola para que la mire
 * una persona. No se guarda a medias ni se completa con un valor por defecto.
 */

import type { LecturaDeFactura } from "./leerArchivo";

/** Lo que hace falta saber de la pantalla para decidir. */
export interface LoLeido {
  lectura: LecturaDeFactura | null;
  /** La empresa del grupo resuelta por el CUIT receptor del QR. */
  empresaReconocida: boolean;
}

export type Veredicto =
  | { sola: true }
  | { sola: false; porque: string };

/**
 * Decide, y cuando dice que no **dice por qué**.
 *
 * El motivo no es decorativo: es lo que la pantalla muestra para que quien
 * revisa sepa qué mirar en esa factura, en vez de encontrarse una cola de
 * filas idénticas sin saber qué tienen de distinto.
 */
export function sePuedeGuardarSola({ lectura, empresaReconocida }: LoLeido): Veredicto {
  /*
   * 1. Tiene cabecera. Sin emisor, número, fecha e importe no hay factura que
   *    guardar: es el caso del escaneo sin capa de texto.
   */
  if (!lectura?.cabecera) {
    return { sola: false, porque: "No se le pudo leer la cabecera: hay que completarla a mano." };
  }

  /*
   * 2. Salió del QR y no del texto impreso.
   *
   *    El QR está firmado por ARCA; el texto lo interpretó un lector sobre lo
   *    que imprimió el emisor. Los dos entran al buzón, pero sólo uno se puede
   *    dar por bueno sin que nadie lo mire — es la misma distinción que hace
   *    `identificado_por` en la cabecera, y la razón por la que existe.
   */
  if (lectura.origenDeLaCabecera !== "qr") {
    return {
      sola: false,
      porque: "Los datos salieron del texto impreso y no del QR: conviene mirarlos.",
    };
  }

  /*
   * 3. El importe del QR coincide con el impreso.
   *
   *    Cuando no, son dos números que tendrían que ser el mismo y el que se va
   *    a guardar puede ser cien veces más grande —hay emisores que mandan el
   *    importe en centavos—. Es exactamente el caso que no puede pasar solo.
   */
  if (lectura.avisoDelImporte) {
    return { sola: false, porque: lectura.avisoDelImporte.texto };
  }

  /*
   * 4. La empresa está reconocida.
   *
   *    Si el CUIT receptor no es ni de Polcecal ni de Polysan, la factura
   *    puede no ser del grupo. El alta la guarda igual con un aviso —la
   *    entrada nunca se bloquea—, pero eso es una decisión que toma una
   *    persona mirando el papel, no una corrida de veinticinco.
   */
  if (!empresaReconocida) {
    return {
      sola: false,
      porque: "El comprobante no está emitido a Polcecal ni a Polysan: revisá a qué empresa va.",
    };
  }

  return { sola: true };
}

/**
 * Cuántas se bajan y leen por tanda.
 *
 * No es un número cómodo: leer un QR **rasteriza la página a 3600 px** y ocupa
 * el hilo del navegador. Las 398 de una dejarían la pestaña congelada varios
 * minutos sin poder parar, que es peor que el problema que esto resuelve. De a
 * 25 son unos dieciséis clics para vaciar la cola de hoy, y cada tanda se
 * puede abandonar.
 */
export const POR_TANDA = 25;
