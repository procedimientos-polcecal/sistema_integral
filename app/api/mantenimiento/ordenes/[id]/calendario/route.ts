import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import {
  INVITADOS_DE_UNA_OT, datosDeLaOT, duenoDelEventoDeLaOT, fechaParaElCalendario,
  horarioDeLaOT, problemasDeMandarLaOT, problemasDelEvento,
} from "@/lib/agenda/evento";
import { aInstanteISO, eventoParaGoogle, invitadosLimpios } from "@/lib/agenda/pedido";
import {
  escribirEnGoogle, columnasDespuesDeEscribir, advertenciaDeLaEscritura, parDivergencia, parPendiente,
} from "@/lib/agenda/escribirEnGoogle";
import { agregarInvitados, sacarInvitados, diferenciaDeInvitados } from "@/lib/agenda/invitados";
import { anotarEnLaFila, POR_SI_YA_ESCRIBIO } from "@/lib/agenda/cargar";
import { ES_UUID, quienLlama } from "@/lib/agenda/sesion";
import type { Turno } from "@/lib/mantenimiento/programacion";

type Params = { params: Promise<{ id: string }> };

/**
 * `turno` se completa con vacío si no vino, a propósito: así
 * `problemasDeMandarLaOT` lo ve y lo dice junto con todo lo demás.
 */
const esquemaDeMandar = z.object({
  turno: z.string().default(""),
  invitados: z.array(z.string()).max(50).default([]),
});

/**
 * Mandar una OT al calendario (POST): se elige el turno, el evento arranca con
 * él y dura 1:30. Vuelve a mandarla y **reemplaza**: `agenda_eventos.ot_id` es
 * `unique`, así que una OT tiene un solo evento y cambiarle el turno lo mueve.
 *
 * ── EL EVENTO ES DE LA ORDEN, NO DE QUIEN APRIETA EL BOTÓN ──────────────────
 *
 * Con el alta, el dueño es la casilla que generó la OT (`created_by`). Con un
 * evento que ya existía, **el dueño no cambia**, aunque lo reenvíe otra
 * persona u otra casilla. Por eso esta ruta escribe con el cliente admin y no
 * con el de la sesión: la policy de editar sólo deja al dueño, y el insert sólo
 * deja crear a nombre propio. El permiso se comprueba acá, en el código: quien
 * edita Mantenimiento.
 *
 * ── LA FECHA ─────────────────────────────────────────────────────────────────
 *
 * Manda `fecha_ejecucion_pendiente` cuando la hay (`fechaParaElCalendario`).
 * Una OT sin ninguna fecha no se manda: es un 400 con el motivo. La fecha se
 * valida antes de guardar nada, porque `horarioDeLaOT` no lo hace y una mal
 * formada haría que cada aviso de Google saliera «movido» para siempre.
 *
 * ── EL ORDEN ─────────────────────────────────────────────────────────────────
 *
 * Como el alta de la Agenda: la fila, después los invitados, después Google. El
 * SdG es el dueño del dato y un fallo de Google **no** deshace el evento: queda
 * `google_pendiente` y la respuesta lo dice. Los invitados van **en otra
 * sentencia** que el evento, nunca en la misma: la policy de `agenda_invitados`
 * no ve un evento insertado en la misma sentencia (`42501`).
 *
 * Se escribe en Google siempre con `crear`, que es idempotente: si el evento ya
 * estaba lo pisa entero, y si estaba borrado lo resucita. Mandar una OT es una
 * orden explícita de que el evento esté donde dice el SdG, así que **resuelve
 * una divergencia** en vez de respetarla (lo que el SdG no hace es pisar solo,
 * y esto no es solo): la respuesta lo dice.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const quien = await quienLlama(supabase);
  if (!quien.ok) return quien.respuesta;

  if (!(await puedeEditarMantenimiento(supabase, quien.id))) {
    return NextResponse.json(
      { error: "Mandar una OT al calendario requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const cuerpo = await request.json().catch(() => null);
  if (typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) {
    return NextResponse.json({ error: "El pedido no trae un cuerpo válido" }, { status: 400 });
  }
  const r = validar(esquemaDeMandar, cuerpo);
  if (!r.ok) return errorDeValidacion(r.problemas);
  const datos = r.datos;

  if (!ES_UUID.test(id)) return NextResponse.json({ error: "No existe esa orden" }, { status: 404 });

  const admin = createAdminClient();

  const { data: orden, error: errorDeOrden } = await admin
    .from("ordenes_trabajo")
    // La cadena va literal y en una sola pieza: partida con `+` pierde la
    // inferencia de tipos de Supabase.
    .select("id, ot_number, fecha_ejecucion, fecha_ejecucion_pendiente, created_by, equipo_raw, equipo_code, sector_raw, especialidad, tipo, descripcion")
    .eq("id", id)
    .maybeSingle();
  if (errorDeOrden) {
    return NextResponse.json({ error: `No se pudo leer la orden: ${errorDeOrden.message}` }, { status: 500 });
  }
  if (!orden) return NextResponse.json({ error: "No existe esa orden" }, { status: 404 });

  // ── ¿Ya tenía evento? Entonces el dueño es el que ya es ───────────────────
  const { data: actual, error: errorDeEvento } = await admin
    .from("agenda_eventos")
    .select("id, dueno_id, casilla, google_event_id, divergencia")
    .eq("ot_id", id)
    .maybeSingle();
  if (errorDeEvento) {
    return NextResponse.json({ error: `No se pudo leer el evento de la orden: ${errorDeEvento.message}` }, { status: 500 });
  }

  let dueno: { id: string; casilla: string; deQuienLlama: boolean };
  if (actual) {
    dueno = { id: actual.dueno_id, casilla: actual.casilla, deQuienLlama: false };
  } else {
    let generador: { id: string; email: string | null } | null = null;
    if (orden.created_by) {
      const { data: u, error: errorDeUsuario } = await admin
        .from("usuarios")
        .select("id, email")
        .eq("id", orden.created_by)
        .maybeSingle();
      if (errorDeUsuario) {
        return NextResponse.json(
          { error: `No se pudo averiguar quién generó la orden: ${errorDeUsuario.message}` },
          { status: 500 }
        );
      }
      generador = u ?? null;
    }
    dueno = duenoDelEventoDeLaOT(generador, quien);
  }

  // ── Validar todo junto, antes de guardar nada ─────────────────────────────
  const extras = datos.invitados.map((c) => c.trim()).filter((c) => c !== "");
  const fecha = fechaParaElCalendario(orden);
  const delPedido = problemasDeMandarLaOT({ fecha_ejecucion: fecha, turno: datos.turno, invitados: extras });
  if (delPedido.length > 0) return errorDeValidacion(delPedido);

  const turno = datos.turno as Turno;
  const texto = datosDeLaOT(orden);
  const horario = horarioDeLaOT(fecha as string, turno);
  const invitados = invitadosLimpios([...INVITADOS_DE_UNA_OT, ...extras], dueno.casilla);
  const delEvento = problemasDelEvento({ titulo: texto.titulo, inicio: horario.inicio, fin: horario.fin, invitados });
  if (delEvento.length > 0) return errorDeValidacion(delEvento);

  const inicio = aInstanteISO(horario.inicio);
  const fin = aInstanteISO(horario.fin);
  if (!inicio || !fin) {
    // No debería pasar: `problemasDelEvento` ya los habría rechazado.
    return NextResponse.json({ error: "El inicio o el fin no es una fecha y hora válida" }, { status: 400 });
  }

  const eventoId = actual?.id ?? crypto.randomUUID();
  const fila = { id: eventoId, titulo: texto.titulo, descripcion: texto.descripcion, lugar: texto.lugar, inicio, fin };
  const advertencias: string[] = [];

  if (actual) {
    // ── Reemplazar: se mueve al turno nuevo, no se duplica ──────────────────
    const { data: guardadas, error } = await admin
      .from("agenda_eventos")
      .update({ ...fila, turno })
      .eq("id", eventoId)
      .select("id");
    if (error) {
      return NextResponse.json({ error: `No se pudo guardar el evento: ${error.message}` }, { status: 500 });
    }
    if (!guardadas || guardadas.length === 0) {
      return NextResponse.json(
        { error: "El evento se borró mientras tanto. Volvé a mandar la orden." },
        { status: 409 }
      );
    }

    const { data: actuales, error: errorDeInvitados } = await admin
      .from("agenda_invitados")
      .select("email")
      .eq("evento_id", eventoId);
    const falloDeInvitados = errorDeInvitados
      ? `No se pudieron leer los invitados: ${errorDeInvitados.message}`
      : await cambiarInvitados(admin, eventoId, (actuales ?? []).map((i: { email: string }) => i.email.toLowerCase()), invitados);
    if (falloDeInvitados) {
      // La fila ya va adelantada de Google: sin pendiente nada lo registra.
      const sinAnotar = await anotarEnLaFila(
        admin,
        eventoId,
        parPendiente(
          `El evento de la OT se movió en el SdG pero no los invitados, y Google no recibió nada: ${falloDeInvitados}`,
          new Date().toISOString()
        )
      );
      return NextResponse.json(
        {
          error:
            `${falloDeInvitados}. El horario sí se guardó en el SdG, pero todavía no está en Google: quedó pendiente.` +
            (sinAnotar ? ` Ojo: tampoco se pudo anotar el pendiente (${sinAnotar}), así que volvé a mandar la orden.` : ""),
        },
        { status: 500 }
      );
    }
  } else {
    // ── Alta ────────────────────────────────────────────────────────────────
    const { error } = await admin
      .from("agenda_eventos")
      .insert({ ...fila, dueno_id: dueno.id, casilla: dueno.casilla, ot_id: id, turno });
    if (error) {
      // `ot_id` es único: otra persona la mandó en este mismo instante.
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Alguien acaba de mandar esta orden al calendario. Volvé a intentarlo para moverla al turno que elegiste." },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: `No se pudo guardar el evento: ${error.message}` }, { status: 500 });
    }

    // Sentencia aparte: ver el encabezado.
    const sinInvitados = await agregarInvitados(admin, eventoId, invitados);
    if (sinInvitados) {
      const { error: errorAlDeshacer } = await admin.from("agenda_eventos").delete().eq("id", eventoId);
      return NextResponse.json(
        {
          error:
            `${sinInvitados}. No se creó el evento.` +
            (errorAlDeshacer
              ? ` Ojo: quedó una fila a medias (${eventoId}) que no se pudo sacar: ${errorAlDeshacer.message}`
              : ""),
        },
        { status: 500 }
      );
    }

    if (dueno.deQuienLlama) {
      advertencias.push(
        `Esta orden no la cargó nadie en el sistema (entró por el formulario), así que no hay una casilla ` +
          `que la haya generado: el evento quedó a nombre de ${dueno.casilla}.`
      );
    }
  }

  // ── Google ────────────────────────────────────────────────────────────────
  const enGoogle = await escribirEnGoogle(
    "crear",
    { casilla: dueno.casilla, google_event_id: actual?.google_event_id ?? null, inicio, fin },
    eventoParaGoogle(fila, invitados, dueno.casilla)
  );

  // **Lo que Google devolvió, no lo que se mandó** (`columnasDespuesDeEscribir`):
  // es lo único que separa el eco de una escritura propia de un cambio hecho por
  // una persona. Si se anotara lo enviado, cada sincronización que mueva la OT
  // sonaría como divergencia en cinco teléfonos.
  const columnas = columnasDespuesDeEscribir(enGoogle, new Date().toISOString());
  if (actual?.divergencia && !enGoogle.pendiente) {
    Object.assign(columnas, parDivergencia(null, new Date().toISOString()));
    advertencias.push(
      `Este evento ${actual.divergencia === "borrado" ? "lo habían borrado" : "lo habían movido"} desde ` +
        `Google: se volvió a escribir como dice la orden y la divergencia quedó resuelta.`
    );
  }
  const errorAlAnotar = await anotarEnLaFila(admin, eventoId, columnas);

  const dePendiente = advertenciaDeLaEscritura(enGoogle, "El evento");
  if (dePendiente) advertencias.push(dePendiente);
  if (errorAlAnotar) {
    advertencias.push(
      `No se pudo anotar en el evento lo que pasó con Google, ni en dos intentos (${errorAlAnotar}). ` +
        (enGoogle.pendiente ? "El evento sigue sin estar en Google." : POR_SI_YA_ESCRIBIO)
    );
  }

  const { data, error: errorDeLectura } = await admin
    .from("agenda_eventos")
    .select("*, agenda_invitados(email, usuario_id), usuarios!dueno_id(nombre, apellido, email)")
    .eq("id", eventoId)
    .maybeSingle();
  if (errorDeLectura || !data) {
    advertencias.push(
      `El evento se guardó (${eventoId}), pero no se pudo volver a leer${errorDeLectura ? `: ${errorDeLectura.message}` : ""}.`
    );
  }

  return NextResponse.json(
    {
      data: data ?? fila,
      reemplazo: Boolean(actual),
      google: { escrito: !enGoogle.pendiente, pendiente: enGoogle.pendiente ?? null },
      ...(advertencias.length > 0 ? { advertencia: advertencias.join(" ") } : {}),
    },
    { status: actual ? 200 : 201 }
  );
}

/** Deja los invitados del evento como `nuevos`, tocando sólo la diferencia. Devuelve el error, o `null`. */
async function cambiarInvitados(
  admin: ReturnType<typeof createAdminClient>,
  eventoId: string,
  actuales: string[],
  nuevos: string[]
): Promise<string | null> {
  const { sacar, agregar } = diferenciaDeInvitados(actuales, nuevos);
  // Primero los que se suman: si falla un insert, nadie quedó afuera.
  return (await agregarInvitados(admin, eventoId, agregar)) ?? (await sacarInvitados(admin, eventoId, sacar));
}
