import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { problemasDelEvento } from "@/lib/agenda/evento";
import {
  aInstanteISO, esquemaDeCambio, eventoParaGoogle, idDeGoogleDe, invitadosLimpios,
} from "@/lib/agenda/pedido";
import {
  escribirEnGoogle, columnasDespuesDeEscribir, advertenciaDeLaEscritura,
} from "@/lib/agenda/escribirEnGoogle";
import { agregarInvitados, sacarInvitados, diferenciaDeInvitados } from "@/lib/agenda/invitados";
import { cargarEvento, rechazoDeEventoDeOT } from "@/lib/agenda/cargar";
import { quienLlama } from "@/lib/agenda/sesion";

/**
 * Un evento de la Agenda: modificarlo (PATCH) y borrarlo (DELETE). **Sólo el
 * dueño**; un invitado lo ve y recibe un 403 con el motivo.
 *
 * ── EL EVENTO DE UNA OT NO SE TOCA DESDE ACÁ ───────────────────────────────
 *
 * Un evento con `ot_id` es de sólo lectura para las dos rutas, en todas sus
 * partes, y contesta 409 con el número de la OT. **No es del que lo mira: es de
 * la orden.** Su horario sale de la fecha de ejecución y la sincronización lo
 * reescribe cuando la planilla la mueve; si se pudiera editar, la persona vería
 * su cambio guardado y después desaparecer sin aviso, que es la misma mentira
 * que evita el no pisar un evento divergido. La condición es `ot_id` y no «tocó
 * el horario» porque la OT reescribe también el título y los invitados. Ver
 * `rechazoDeEventoDeOT` en `lib/agenda/cargar.ts`.
 *
 * ── MODIFICAR ───────────────────────────────────────────────────────────────
 *
 * Se guarda en el SdG primero y se escribe en Google después, como el alta: el
 * SdG es el dueño del dato. Un fallo de Google no deshace el cambio, queda como
 * `google_pendiente` y la respuesta lo dice.
 *
 * **Un evento divergido no se escribe en Google.** Alguien lo movió o lo borró
 * del otro lado, y escribirlo encima es pisar sin avisar lo que esa persona
 * hizo —justo lo que el diseño decidió no hacer—. El cambio queda en el SdG, la
 * respuesta lo dice, y `destrabar` es el que lo vuelve a atar.
 *
 * Los invitados se cambian por diferencia —sacar los que sobran, agregar los
 * que faltan— y no con un upsert: la tabla no tiene policy de update.
 *
 * ── BORRAR ──────────────────────────────────────────────────────────────────
 *
 * **Primero Google, después la fila.** Al revés, un fallo de Google dejaría el
 * evento vivo en el calendario de los invitados sin ninguna fila que lo nombre,
 * y ya nadie podría borrarlo desde acá. Si Google falla la fila se queda, con lo
 * que dijo Google anotado, y la respuesta es un 502: no se borró.
 */

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const quien = await quienLlama(supabase);
  if (!quien.ok) return quien.respuesta;

  const cuerpo = await request.json().catch(() => null);
  if (typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) {
    return NextResponse.json({ error: "El pedido no trae un cuerpo válido" }, { status: 400 });
  }
  const r = validar(esquemaDeCambio, cuerpo);
  if (!r.ok) return errorDeValidacion(r.problemas);
  const cambio = r.datos;
  if (Object.values(cambio).every((v) => v === undefined)) {
    return NextResponse.json({ error: "No hay nada para cambiar" }, { status: 400 });
  }

  const cargado = await cargarEvento(supabase, id, quien.id, { accion: "modificarlo" });
  if (!cargado.ok) return cargado.respuesta;
  const actual = cargado.evento;
  const deUnaOT = await rechazoDeEventoDeOT(supabase, actual, "modificar");
  if (deUnaOT) return deUnaOT;

  // El evento como quedaría, para validarlo entero y no sólo lo que cambió: mover
  // sólo el fin puede dejarlo antes del inicio que ya tenía. Las horas que
  // entran se pasan a instante; si una no se puede leer se deja el texto crudo,
  // para que `problemasDelEvento` diga cuál es.
  const horaNueva = (texto: string | undefined, actualIso: string) =>
    texto === undefined ? actualIso : (aInstanteISO(texto) ?? texto);
  const inicio = horaNueva(cambio.inicio, actual.inicio);
  const fin = horaNueva(cambio.fin, actual.fin);
  const titulo = cambio.titulo === undefined ? actual.titulo : cambio.titulo.trim();
  const invitados =
    cambio.invitados === undefined ? actual.invitados : invitadosLimpios(cambio.invitados, actual.casilla);

  const problemas = problemasDelEvento({ titulo, inicio, fin, invitados });
  if (problemas.length > 0) return errorDeValidacion(problemas);

  // Sólo lo que vino: las columnas que no se mencionan no se tocan.
  const columnas: Record<string, unknown> = {};
  if (cambio.titulo !== undefined) columnas.titulo = titulo;
  if (cambio.descripcion !== undefined) columnas.descripcion = cambio.descripcion?.trim() || null;
  if (cambio.lugar !== undefined) columnas.lugar = cambio.lugar?.trim() || null;
  if (cambio.inicio !== undefined) columnas.inicio = inicio;
  if (cambio.fin !== undefined) columnas.fin = fin;

  if (Object.keys(columnas).length > 0) {
    const { data: guardadas, error } = await supabase
      .from("agenda_eventos")
      .update(columnas)
      .eq("id", id)
      .select("id");
    if (error) {
      return NextResponse.json(
        { error: `No se pudo guardar el cambio: ${error.message}` },
        { status: error.code === "42501" ? 403 : 500 }
      );
    }
    if (!guardadas || guardadas.length === 0) {
      return NextResponse.json(
        { error: "No se pudo guardar: el evento cambió o se borró mientras lo editabas. Recargá la pantalla." },
        { status: 409 }
      );
    }
  }

  if (cambio.invitados !== undefined) {
    const { sacar, agregar } = diferenciaDeInvitados(actual.invitados, invitados);
    // Primero los que se suman: si falla un insert, nadie quedó afuera.
    const falloAgregar = await agregarInvitados(supabase, id, agregar);
    if (falloAgregar) {
      return NextResponse.json(
        { error: `${falloAgregar}. Los demás cambios del evento sí se guardaron.` },
        { status: 500 }
      );
    }
    const falloSacar = await sacarInvitados(supabase, id, sacar);
    if (falloSacar) {
      return NextResponse.json(
        { error: `${falloSacar}. Los demás cambios del evento sí se guardaron.` },
        { status: 500 }
      );
    }
  }

  const advertencias: string[] = [];
  let enGoogle: { escrito: boolean; pendiente: string | null } | { escrito: false; trabado: true };

  if (actual.divergencia) {
    enGoogle = { escrito: false, trabado: true };
    advertencias.push(
      `El cambio se guardó en el SdG pero no se escribió en Google: ese evento ${
        actual.divergencia === "borrado" ? "lo borraron" : "lo movieron"
      } desde Google y el SdG no lo pisa en silencio. Destrabalo para decidir si vale lo del SdG o lo de Google.`
    );
  } else {
    const evento = eventoParaGoogle(
      {
        id,
        titulo,
        descripcion: "descripcion" in columnas ? (columnas.descripcion as string | null) : actual.descripcion,
        lugar: "lugar" in columnas ? (columnas.lugar as string | null) : actual.lugar,
        inicio,
        fin,
      },
      invitados,
      actual.casilla
    );
    // Sin id en Google es que el alta no llegó a escribirse: se reintenta crear,
    // y con el id derivado de la fila es idempotente.
    const sinEscribir = !actual.google_event_id;
    const resultado = await escribirEnGoogle(
      sinEscribir ? "crear" : "actualizar",
      { casilla: actual.casilla, google_event_id: actual.google_event_id, inicio, fin },
      sinEscribir ? { ...evento, id: idDeGoogleDe(id) } : evento
    );
    const { error: errorAlAnotar } = await supabase
      .from("agenda_eventos")
      .update(columnasDespuesDeEscribir(resultado, new Date().toISOString()))
      .eq("id", id);
    enGoogle = { escrito: !resultado.pendiente && !resultado.divergencia, pendiente: resultado.pendiente ?? null };
    const advertencia = advertenciaDeLaEscritura(resultado, "El cambio");
    if (advertencia) advertencias.push(advertencia);
    if (errorAlAnotar) {
      advertencias.push(`No se pudo anotar en el evento lo que pasó con Google (${errorAlAnotar.message}).`);
    }
  }

  const { data, error: errorDeLectura } = await supabase
    .from("agenda_eventos")
    .select("*, agenda_invitados(email, usuario_id), usuarios!dueno_id(nombre, apellido, email)")
    .eq("id", id)
    .maybeSingle();
  if (errorDeLectura || !data) {
    advertencias.push(`El cambio se guardó, pero no se pudo volver a leer el evento${errorDeLectura ? `: ${errorDeLectura.message}` : ""}.`);
  }

  return NextResponse.json({
    data: data ?? null,
    google: enGoogle,
    ...(advertencias.length > 0 ? { advertencia: advertencias.join(" ") } : {}),
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const quien = await quienLlama(supabase);
  if (!quien.ok) return quien.respuesta;

  const cargado = await cargarEvento(supabase, id, quien.id, { accion: "borrarlo" });
  if (!cargado.ok) return cargado.respuesta;
  const actual = cargado.evento;
  const deUnaOT = await rechazoDeEventoDeOT(supabase, actual, "borrar");
  if (deUnaOT) return deUnaOT;

  // Sin id en Google igual se intenta borrar el derivado de la fila: un alta que
  // cortó a los 30 segundos puede haberse creado de todos modos, y borrar un id
  // que Google no conoce es éxito (404).
  const enGoogle = await escribirEnGoogle("borrar", {
    casilla: actual.casilla,
    google_event_id: actual.google_event_id ?? idDeGoogleDe(id),
    inicio: actual.inicio,
    fin: actual.fin,
  });
  if (enGoogle.pendiente) {
    // La fila se queda: es lo único que sabe dónde está el evento vivo.
    await supabase
      .from("agenda_eventos")
      .update(columnasDespuesDeEscribir(enGoogle, new Date().toISOString()))
      .eq("id", id);
    return NextResponse.json(
      {
        error:
          `No se borró: Google no pudo borrar el evento, y si se borrara la fila quedaría vivo en el ` +
          `calendario de los invitados sin que nada lo nombre. Google dijo: ${enGoogle.pendiente}`,
      },
      { status: 502 }
    );
  }

  const { data: borradas, error } = await supabase
    .from("agenda_eventos")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) {
    return NextResponse.json(
      {
        error:
          `El evento ya se borró de Google, pero no se pudo borrar del SdG: ${error.message}. ` +
          `Volvé a intentarlo: borrar de Google un evento que ya no está no da error.`,
      },
      { status: 500 }
    );
  }
  if (!borradas || borradas.length === 0) {
    return NextResponse.json({ error: "El evento ya no existe" }, { status: 404 });
  }
  return NextResponse.json({ data: { id } });
}
