import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rutaDelAdjunto, sirveComoFactura } from "@/lib/facturacion/correoEntrante";

/**
 * Lo que llegó por mail, que después alguien carga desde el buzón.
 *
 * Lo llama un Apps Script instalado en la casilla que recibe las facturas —ver
 * `docs/facturacion-correo-apps-script.gs`—. Mismo patrón que la planilla de
 * Compras: un disparador por tiempo del lado de Google, un POST con un secreto
 * compartido, y el trabajo de este lado.
 *
 * **Por qué un Apps Script y no que el servidor lea el buzón.** Se probó: la
 * cuenta de servicio pide un token de Gmail haciéndose pasar por un usuario del
 * dominio y Google contesta `unauthorized_client`, porque la delegación a nivel
 * dominio no está otorgada. Otorgarla es una acción de un admin de Workspace y
 * le daría al sistema permiso de leer **cualquier** buzón del dominio. El
 * script lo instala el dueño de la casilla y sólo ve esa.
 *
 * ## No lee el QR
 *
 * A propósito. El lector corre en el navegador de quien carga —es lo que llevó
 * la lectura automática al 98%— y esto sólo acerca el archivo. La factura se
 * crea cuando una persona la carga desde el buzón, no acá.
 *
 * ## Falla cerrado
 *
 * Sin `FACTURACION_CORREO_SECRET` configurado devuelve 503 y no escribe nada.
 * Un endpoint que acepta archivos no puede quedar abierto porque falte una
 * variable.
 */

export const maxDuration = 120;

const BUCKET = "facturas-proveedor";

/** Un adjunto, como lo manda el script: el contenido va en base64. */
interface AdjuntoEntrante {
  nombre?: unknown;
  tipo?: unknown;
  contenido?: unknown;
}

interface MensajeEntrante {
  id?: unknown;
  remitente?: unknown;
  asunto?: unknown;
  fecha?: unknown;
  adjuntos?: unknown;
}

const texto = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

export async function POST(request: Request) {
  const secreto = process.env.FACTURACION_CORREO_SECRET;
  if (!secreto) {
    return NextResponse.json(
      { error: "FACTURACION_CORREO_SECRET no configurado" },
      { status: 503 }
    );
  }

  const enviado =
    request.headers.get("x-webhook-secret") ??
    new URL(request.url).searchParams.get("secret");

  if (enviado !== secreto) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const cuerpo = await request.json().catch(() => null);
  const mensajes: MensajeEntrante[] = Array.isArray(cuerpo?.mensajes) ? cuerpo.mensajes : [];
  if (!mensajes.length) {
    return NextResponse.json({ nuevos: 0, repetidos: 0, descartados: [] });
  }

  const admin = createAdminClient();

  /*
   * Lo que ya está, de una sola consulta. El script no debería mandar
   * repetidos —marca con una etiqueta lo que ya pasó— pero un reintento suyo o
   * una etiqueta que no se llegó a escribir lo haría, y re-subir el archivo en
   * cada corrida es el costo que esto evita. La restricción UNIQUE de la tabla
   * es la red de abajo; esto es para no trabajar de más.
   */
  const ids = mensajes.map((m) => texto(m.id)).filter((x): x is string => x !== null);
  const { data: yaEstan } = await admin
    .from("facturacion_correo")
    .select("mensaje_id, adjunto")
    .in("mensaje_id", ids.slice(0, 200));

  const conocidos = new Set((yaEstan ?? []).map((f) => `${f.mensaje_id}\u0000${f.adjunto}`));

  let nuevos = 0;
  let repetidos = 0;
  const descartados: { adjunto: string; motivo: string }[] = [];
  const fallaron: { adjunto: string; motivo: string }[] = [];

  for (const m of mensajes) {
    const mensajeId = texto(m.id);
    if (!mensajeId) continue;

    const adjuntos: AdjuntoEntrante[] = Array.isArray(m.adjuntos) ? m.adjuntos : [];

    for (const adj of adjuntos) {
      const nombre = texto(adj.nombre);
      const contenido = texto(adj.contenido);
      if (!nombre || !contenido) continue;

      if (conocidos.has(`${mensajeId}\u0000${nombre}`)) {
        repetidos++;
        continue;
      }

      const bytes = Buffer.from(contenido, "base64");
      const tipo = texto(adj.tipo) ?? "application/octet-stream";
      const veredicto = sirveComoFactura({ nombre, tipo, tamano: bytes.byteLength });

      /*
       * Lo descartado **se guarda igual**, con su motivo y sin archivo. Si no
       * quedara registrado, el script lo volvería a traer en cada corrida y
       * nadie podría saber qué quedó afuera ni por qué.
       */
      if (!veredicto.sirve) {
        descartados.push({ adjunto: nombre, motivo: veredicto.motivo });
        await admin.from("facturacion_correo").upsert(
          {
            mensaje_id: mensajeId,
            adjunto: nombre,
            remitente: texto(m.remitente),
            asunto: texto(m.asunto),
            recibido_en: texto(m.fecha),
            archivo_url: "",
            tamano_bytes: bytes.byteLength,
            tipo,
            estado: "descartada",
            motivo: veredicto.motivo,
          },
          { onConflict: "mensaje_id,adjunto", ignoreDuplicates: true }
        );
        continue;
      }

      const ruta = rutaDelAdjunto(mensajeId, nombre);

      const { error: errorArchivo } = await admin.storage
        .from(BUCKET)
        .upload(ruta, bytes, { contentType: tipo, upsert: true });

      if (errorArchivo) {
        fallaron.push({ adjunto: nombre, motivo: errorArchivo.message });
        continue;
      }

      /*
       * La fila va **después** del archivo, nunca antes: una fila que apunta a
       * un archivo que no está es una entrada rota en la bandeja que nadie
       * puede cargar. Al revés, un archivo sin fila es un huérfano en el bucket
       * que no molesta a nadie y que el próximo intento pisa.
       */
      const { error: errorFila } = await admin.from("facturacion_correo").upsert(
        {
          mensaje_id: mensajeId,
          adjunto: nombre,
          remitente: texto(m.remitente),
          asunto: texto(m.asunto),
          recibido_en: texto(m.fecha),
          archivo_url: ruta,
          tamano_bytes: bytes.byteLength,
          tipo,
          estado: "pendiente",
        },
        { onConflict: "mensaje_id,adjunto", ignoreDuplicates: true }
      );

      if (errorFila) fallaron.push({ adjunto: nombre, motivo: errorFila.message });
      else nuevos++;
    }
  }

  return NextResponse.json({ nuevos, repetidos, descartados, fallaron });
}
