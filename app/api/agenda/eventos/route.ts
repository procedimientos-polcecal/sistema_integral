import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { problemasDelEvento } from "@/lib/agenda/evento";
import {
  aInstanteISO, esquemaDeAlta, eventoParaGoogle, invitadosLimpios,
} from "@/lib/agenda/pedido";
import {
  escribirEnGoogle, columnasDespuesDeEscribir, advertenciaDeLaEscritura,
} from "@/lib/agenda/escribirEnGoogle";
import { agregarInvitados } from "@/lib/agenda/invitados";
import { anotarEnLaFila } from "@/lib/agenda/cargar";
import { quienLlama } from "@/lib/agenda/sesion";

/**
 * Crear un evento de la Agenda (POST).
 *
 * Va con el cliente del usuario y **no** con el admin, para que corran las
 * policies: el alta sólo deja crear a nombre propio.
 *
 * ── EL ORDEN DEL ALTA, Y POR QUÉ ────────────────────────────────────────────
 *
 * Primero la fila, después los invitados, después Google. El SdG es el dueño del
 * dato y Google es el espejo, así que **un fallo de Google no deshace el
 * evento**: queda guardado con `google_pendiente` y la respuesta lo dice. Lo que
 * sí se deshace es la fila si no entran sus invitados: un evento sin los
 * invitados que se pidieron sería un evento distinto del que se quiso crear.
 *
 * El `id` de la fila se sortea acá y de él sale el de Google
 * (`idDeGoogleDe`), así que si Google contesta pero la anotación en la fila
 * falla, el reintento da con el mismo evento y no manda la invitación otra vez.
 *
 * **El insert no pide la fila de vuelta, pero no porque no pueda.**
 * `agenda_eventos_ver` pregunta por `agenda_veo_evento(id)`, que es `STABLE` y
 * lee la tabla con el snapshot del comienzo de la sentencia, así que no ve la
 * fila que esa misma sentencia está insertando; la migración lo resuelve con el
 * disyunto `dueno_id = (select auth.uid())` delante de la función, y con él un
 * `insert … returning` anda. La relectura es aparte porque trae los embeds
 * (invitados y nombre del dueño) y porque hay que esperar a que Google conteste
 * para devolver la fila ya anotada.
 *
 * **El evento y sus invitados van en sentencias separadas, nunca en una sola**
 * (ni con un CTE): el `with check` de `agenda_invitados` llama a
 * `agenda_veo_evento(evento_id)`, que busca el evento en la tabla, y dentro de
 * la misma sentencia todavía no es visible para esa función: el insert de los
 * invitados caería con `42501`.
 */

/**
 * **Esta ruta no tiene GET, a propósito.** La pantalla lee los eventos desde su
 * Server Component (`lib/agenda/listar.ts`), con ventana, y no hay nadie más que
 * los pida. Una ruta que nadie llama se pudre: alguien la cambia sin saber que
 * no se usa y, mientras tanto, le dice al próximo lector que la pantalla pasa
 * por ahí. Si algún día hace falta una API de lectura, se escribe con su
 * consumidor adelante.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const quien = await quienLlama(supabase);
  if (!quien.ok) return quien.respuesta;

  const cuerpo = await request.json().catch(() => null);
  if (typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) {
    return NextResponse.json({ error: "El pedido no trae un cuerpo válido" }, { status: 400 });
  }

  const r = validar(esquemaDeAlta, cuerpo);
  if (!r.ok) return errorDeValidacion(r.problemas);
  const datos = r.datos;

  const invitados = invitadosLimpios(datos.invitados, quien.casilla);
  // Todo junto: el título, las horas y los correos en una sola respuesta.
  const problemas = problemasDelEvento({
    titulo: datos.titulo,
    inicio: datos.inicio,
    fin: datos.fin,
    invitados,
  });
  if (problemas.length > 0) return errorDeValidacion(problemas);

  const inicio = aInstanteISO(datos.inicio);
  const fin = aInstanteISO(datos.fin);
  if (!inicio || !fin) {
    // No debería pasar: `problemasDelEvento` ya los habría rechazado.
    return NextResponse.json({ error: "El inicio o el fin no es una fecha y hora válida" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const fila = {
    id,
    titulo: datos.titulo.trim(),
    descripcion: datos.descripcion?.trim() || null,
    lugar: datos.lugar?.trim() || null,
    inicio,
    fin,
  };

  const { error: errorDeAlta } = await supabase
    .from("agenda_eventos")
    .insert({ ...fila, dueno_id: quien.id, casilla: quien.casilla });
  if (errorDeAlta) {
    return NextResponse.json(
      { error: `No se pudo guardar el evento: ${errorDeAlta.message}` },
      { status: errorDeAlta.code === "42501" ? 403 : 500 }
    );
  }

  const sinInvitados = await agregarInvitados(supabase, id, invitados);
  if (sinInvitados) {
    const { error: errorAlDeshacer } = await supabase.from("agenda_eventos").delete().eq("id", id);
    return NextResponse.json(
      {
        error:
          `${sinInvitados}. No se creó el evento.` +
          (errorAlDeshacer
            ? ` Ojo: quedó una fila a medias (${id}) que no se pudo sacar: ${errorAlDeshacer.message}`
            : ""),
      },
      { status: 500 }
    );
  }

  const enGoogle = await escribirEnGoogle(
    "crear",
    { casilla: quien.casilla, google_event_id: null, inicio, fin },
    eventoParaGoogle(fila, invitados, quien.casilla)
  );
  const errorAlAnotar = await anotarEnLaFila(
    supabase,
    id,
    columnasDespuesDeEscribir(enGoogle, new Date().toISOString())
  );

  const advertencias: string[] = [];
  const dePendiente = advertenciaDeLaEscritura(enGoogle, "El evento");
  if (dePendiente) advertencias.push(dePendiente);
  if (errorAlAnotar) {
    advertencias.push(
      `No se pudo anotar en el evento lo que pasó con Google, ni en dos intentos (${errorAlAnotar}). ` +
        (enGoogle.pendiente
          ? "El evento sigue sin estar en Google."
          : "El evento sí está en Google, y volver a guardarlo no lo duplica.")
    );
  }

  const { data, error: errorDeLectura } = await supabase
    .from("agenda_eventos")
    .select("*, agenda_invitados(email, usuario_id), usuarios!dueno_id(nombre, apellido, email)")
    .eq("id", id)
    .maybeSingle();
  if (errorDeLectura || !data) {
    advertencias.push(
      `El evento se guardó (${id}), pero no se pudo volver a leer${errorDeLectura ? `: ${errorDeLectura.message}` : ""}.`
    );
  }

  return NextResponse.json(
    {
      data: data ?? fila,
      google: { escrito: !enGoogle.pendiente, pendiente: enGoogle.pendiente ?? null },
      ...(advertencias.length > 0 ? { advertencia: advertencias.join(" ") } : {}),
    },
    { status: 201 }
  );
}
