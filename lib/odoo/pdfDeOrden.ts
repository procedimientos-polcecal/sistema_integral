/**
 * Confirmar una orden de compra en Odoo y bajar su PDF oficial.
 *
 * El PDF es **el mismo** que sale de *Imprimir → Orden de compra* en Odoo, no
 * uno parecido generado acá. Eso importa porque es el papel que ve el
 * proveedor.
 *
 * ## Por qué el camino es tan raro
 *
 * Medido contra staging el 10 y el 11/09/2026. Las tres puertas obvias están
 * cerradas para un cliente JSON-RPC con API key:
 *
 * | camino | resultado |
 * |---|---|
 * | `ir.actions.report._render_qweb_pdf` por RPC | **bloqueado**: "Private methods cannot be called remotely" |
 * | `ir.actions.report.render_qweb_pdf` (el público viejo) | **no existe** en la 17 |
 * | `mail.template.generate_email` | **no existe** en la 17 (pasó a privado) |
 * | `/web/session/authenticate` con la API key → `/report/pdf/...` | **`AccessDenied`** y sin cookie |
 *
 * Lo último no es un permiso que falte: las API keys de Odoo tienen alcance
 * `rpc` y **no abren sesión web**, que es lo único que habilita el endpoint de
 * reportes. Guardar una contraseña de usuario de Odoo era la salida, y es la
 * que esto evita.
 *
 * La puerta que sí abre es el **compositor de correo**: al crear un
 * `mail.compose.message` con una plantilla que lleva el reporte adjunto, Odoo
 * lo renderiza y lo guarda como `ir.attachment`. Todo con `create` y `read`, o
 * sea ORM público. Es el mismo mecanismo por el que en la base ya había un
 * `Orden de compra - P01766.pdf` colgado de una orden.
 *
 * **Y no manda ningún correo.** El correo sale recién con `action_send_mail`,
 * que acá no se llama nunca. Verificado sobre la P02420: el adjunto queda
 * colgado del compositor y no de la orden, el chatter no se mueve y el
 * `write_date` de la orden no cambia.
 *
 * Lo que queda atrás: el registro del compositor, que es un modelo transitorio
 * y lo limpia el autovacuum de Odoo. El adjunto lo borramos nosotros —el
 * `unlink` está permitido, probado—, así que no se acumulan PDFs.
 */

import { buscarLeer, llamar } from "./client";

/** El nombre técnico del reporte, que es lo estable. */
const REPORTE = "purchase.report_purchaseorder";

/**
 * No se resuelve por xmlid a propósito: `ir.model.data` está cerrado para el
 * usuario de integración ("You are not allowed to access 'Datos del modelo'"),
 * así que el nombre técnico del reporte es lo más estable que hay a mano.
 */
async function idDelReporte(): Promise<number> {
  const [reporte] = await buscarLeer<{ id: number }>(
    "ir.actions.report",
    [["report_name", "=", REPORTE]],
    ["id"],
    { limite: 1 }
  );

  if (!reporte) {
    throw new Error(
      `Odoo no tiene el reporte ${REPORTE}. Sin él no hay PDF oficial que bajar: ` +
        `hay que revisarlo en Odoo (Ajustes → Técnico → Informes).`
    );
  }

  return reporte.id;
}

/**
 * La plantilla de correo que lleva ese reporte adjunto.
 *
 * En la base hay dos que sirven —"Compra: orden de compra" y "Compra:
 * recordatorio de proveedor"—, y las dos adjuntan el mismo reporte: el PDF sale
 * igual con cualquiera. Se toma la de id más bajo para que sea siempre la misma
 * y el resultado no dependa del orden en que Odoo las devuelva.
 */
async function idDeLaPlantilla(reporteId: number): Promise<number> {
  const [plantilla] = await buscarLeer<{ id: number }>(
    "mail.template",
    [
      ["model", "=", "purchase.order"],
      ["report_template_ids", "in", [reporteId]],
    ],
    ["id"],
    { limite: 1, orden: "id asc" }
  );

  if (!plantilla) {
    throw new Error(
      `Ninguna plantilla de correo de Odoo lleva adjunto el reporte ${REPORTE}, ` +
        `y es por ahí que el SdG consigue el PDF. Se arregla en Odoo, agregándole ` +
        `el informe "Orden de compra" a la plantilla de compras.`
    );
  }

  return plantilla.id;
}

export interface PdfDeOrden {
  /** Como lo nombra Odoo: `Orden de compra - P02420.pdf`. */
  nombre: string;
  contenido: Buffer;
}

/**
 * El PDF oficial de una orden de compra.
 *
 * Si la orden todavía está en borrador, Odoo titula el mismo documento
 * *Solicitud de cotización*: es su propia regla (`print_report_name` mira el
 * estado), y se respeta en vez de forzar el otro título. Un papel que dice
 * "orden" sobre algo que nadie confirmó sería peor.
 */
export async function pdfDeLaOrden(odooOrderId: number): Promise<PdfDeOrden> {
  const reporteId = await idDelReporte();
  const plantillaId = await idDeLaPlantilla(reporteId);

  /*
   * El contexto va completo porque el compositor de la 17 lo exige así:
   * `default_res_id` (en singular) ya no se acepta —tira "Uso obsoleto de
   * 'default_res_id'"— y sin `default_template_id` el cómputo de adjuntos no
   * corre, así que no se genera nada y el PDF vuelve vacío.
   */
  const compositorId = await llamar<number>(
    "mail.compose.message",
    "create",
    [
      {
        model: "purchase.order",
        composition_mode: "comment",
        template_id: plantillaId,
        res_ids: JSON.stringify([odooOrderId]),
      },
    ],
    {
      context: {
        default_model: "purchase.order",
        default_res_ids: [odooOrderId],
        default_template_id: plantillaId,
        default_composition_mode: "comment",
        active_model: "purchase.order",
        active_id: odooOrderId,
        active_ids: [odooOrderId],
      },
    }
  );

  const [compositor] = await llamar<{ attachment_ids: number[] }[]>(
    "mail.compose.message",
    "read",
    [[compositorId], ["attachment_ids"]]
  );

  const adjuntos = compositor?.attachment_ids ?? [];
  if (!adjuntos.length) {
    throw new Error(
      `Odoo creó el correo de la orden ${odooOrderId} pero no generó el PDF adjunto. ` +
        `Suele ser que la plantilla perdió el informe "Orden de compra".`
    );
  }

  try {
    const archivos = await buscarLeer<{
      id: number;
      name: string;
      mimetype: string;
      datas: string | false;
    }>("ir.attachment", [["id", "in", adjuntos]], ["name", "mimetype", "datas"]);

    const pdf = archivos.find((a) => a.mimetype === "application/pdf" && a.datas);
    if (!pdf || typeof pdf.datas !== "string") {
      throw new Error(
        `El adjunto que generó Odoo para la orden ${odooOrderId} no es un PDF ` +
          `(${archivos.map((a) => a.mimetype).join(", ") || "sin adjuntos legibles"}).`
      );
    }

    return { nombre: pdf.name, contenido: Buffer.from(pdf.datas, "base64") };
  } finally {
    /*
     * Se borra siempre, también si la lectura falló: si no, cada descarga deja
     * un PDF colgado en el Odoo del grupo. Y si el borrado falla no se rompe
     * nada —el PDF ya se leyó, o ya falló por otra cosa—: queda en el log.
     */
    try {
      await llamar("ir.attachment", "unlink", [adjuntos]);
    } catch (e) {
      console.error(
        `No se pudo borrar el adjunto temporal ${adjuntos.join(", ")} en Odoo:`,
        e instanceof Error ? e.message : String(e)
      );
    }
  }
}

/**
 * Confirmar la orden en Odoo (*Confirmar pedido*).
 *
 * Es `button_confirm`, público, probado sobre la P02429 el 11/09/2026: pasó de
 * `draft` a `purchase`. **Y no es gratis**: confirmar crea el remito de entrada
 * —en esa prueba, `Polys/IN/00176`— y a partir de ahí la orden no se edita ni
 * se borra en Odoo, sólo se cancela. Por eso lo dispara una persona desde la
 * ficha, y no la generación de la orden.
 *
 * Devuelve el estado que quedó, leído de Odoo y no supuesto: si una regla del
 * otro lado la dejó en otro estado, lo que vale es lo que dice Odoo.
 */
export async function confirmarLaOrden(odooOrderId: number): Promise<string> {
  await llamar("purchase.order", "button_confirm", [[odooOrderId]]);

  const [orden] = await buscarLeer<{ id: number; state: string }>(
    "purchase.order",
    [["id", "=", odooOrderId]],
    ["state"],
    { limite: 1 }
  );

  return orden?.state ?? "desconocido";
}

/** El estado de una orden en Odoo, o `null` si ya no está. */
export async function estadoDeLaOrden(odooOrderId: number): Promise<string | null> {
  return (await estadosDeLasOrdenes([odooOrderId])).get(odooOrderId) ?? null;
}

/**
 * Los estados de varias órdenes, en **una** llamada.
 *
 * La ficha de un RI compartido tiene dos órdenes y las pregunta juntas: contra
 * Odoo Online, dos viajes de red son el doble de espera para mostrar dos
 * palabras.
 *
 * Una orden que no vuelve en el resultado es una orden que ya no está en Odoo
 * —la borraron—, y eso es un dato: queda fuera del mapa, no como `null` dentro.
 */
export async function estadosDeLasOrdenes(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();

  const ordenes = await buscarLeer<{ id: number; state: string }>(
    "purchase.order",
    [["id", "in", ids]],
    ["state"],
    { limite: ids.length }
  );

  return new Map(ordenes.map((o) => [o.id, o.state]));
}
