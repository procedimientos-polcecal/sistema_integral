import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { invitadosExtraDeLaOT } from "@/lib/agenda/evento";
import { aHoraDePared } from "@/lib/agenda/pedido";
import { leerEvento } from "@/lib/core/calendar";
import { mandarLaOTAlCalendario } from "@/lib/agenda/mandarLaOT";
import { elegirElDuenoDeLaOT } from "@/lib/agenda/duenoDeLaOT";
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
  /** Confirma que se pisa lo que alguien hizo en Google (ver `faltaConfirmarElPisado`). */
  pisar: z.boolean().default(false),
});

/**
 * El estado del evento de una OT, para que el modal lo muestre **antes** de
 * mandar (GET): si ya hay evento y si alguien lo tocó en Google. Con
 * `divergencia: "movido"` trae el horario que Google tiene hoy, leído en vivo y
 * como hora de pared de Argentina (`2026-11-03T08:00:00`); con `"borrado"`, o si
 * Google ya no lo conoce, `google` es `null`. Una lectura que falla no tira el
 * pedido: vuelve en `google_error` con lo que dijo Google, sin traducir.
 *
 * Trae también **de quién es el evento** (`dueno_casilla`), para que el modal lo
 * diga antes de apretar: el del evento que ya existe, o el que va a tener según
 * `elegirElDuenoDeLaOT`, que es la misma lectura que usa el POST al crearlo.
 * `dueno_casilla` es `null` si no se pudo averiguar, y el modal calla antes que
 * inventarlo.
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const quien = await quienLlama(supabase);
  if (!quien.ok) return quien.respuesta;
  if (!(await puedeEditarMantenimiento(supabase, quien.id))) {
    return NextResponse.json({ error: "Requiere nivel de edición en Mantenimiento" }, { status: 403 });
  }
  if (!ES_UUID.test(id)) return NextResponse.json({ error: "No existe esa orden" }, { status: 404 });

  const admin = createAdminClient();
  const { data: evento, error } = await admin
    .from("agenda_eventos")
    .select("id, casilla, google_event_id, divergencia")
    .eq("ot_id", id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: `No se pudo leer el evento de la orden: ${error.message}` }, { status: 500 });
  }
  if (!evento) {
    // Todavía no hay evento: el dueño es el que va a tener (ver `elegirElDuenoDeLaOT`).
    const { data: orden } = await admin.from("ordenes_trabajo").select("created_by").eq("id", id).maybeSingle();
    const elegido = orden ? await elegirElDuenoDeLaOT(admin, orden.created_by ?? null) : null;
    return NextResponse.json({
      existe: false, divergencia: null, google: null, google_error: null, invitados_extra: [],
      dueno_casilla: elegido?.ok ? elegido.casilla : null,
      dueno_del_area: elegido?.ok ? elegido.delArea : false,
    });
  }

  // A quién se sumó a mano la vez anterior: el modal los precarga, porque
  // reenviar reemplaza la lista y sin esto los sacaría sin avisar.
  const { data: invitados, error: errorDeInvitados } = await admin
    .from("agenda_invitados")
    .select("email")
    .eq("evento_id", evento.id);
  if (errorDeInvitados) {
    return NextResponse.json({ error: `No se pudieron leer los invitados: ${errorDeInvitados.message}` }, { status: 500 });
  }

  let google: { inicio: string; fin: string } | null = null;
  let googleError: string | null = null;
  if (evento.divergencia === "movido" && evento.google_event_id) {
    try {
      const enGoogle = await leerEvento(evento.casilla, evento.google_event_id);
      const inicio = enGoogle && !enGoogle.cancelado ? aHoraDePared(enGoogle.inicio) : null;
      const fin = enGoogle && !enGoogle.cancelado ? aHoraDePared(enGoogle.fin) : null;
      if (inicio && fin) google = { inicio, fin };
    } catch (e) {
      googleError = e instanceof Error ? e.message : String(e);
    }
  }

  return NextResponse.json({
    existe: true,
    dueno_casilla: evento.casilla,
    dueno_del_area: false,
    divergencia: evento.divergencia,
    google,
    google_error: googleError,
    invitados_extra: invitadosExtraDeLaOT((invitados ?? []).map((i: { email: string }) => i.email)),
  });
}

/**
 * Mandar una OT al calendario (POST). **La decisión entera vive en
 * `mandarLaOTAlCalendario`** (`lib/agenda/mandarLaOT.ts`), que es donde está
 * explicado por qué cada paso está donde está: el dueño que no cambia, el orden
 * fila → invitados → Google, y el 409 de pisar un evento divergido.
 *
 * Acá quedan las tres cosas que son de la ruta y de nadie más: el permiso, el
 * cuerpo, y volver a leer el evento para devolverlo. **El turno siempre viaja
 * explícito**: el botón pregunta cuál, y el apilado automático es para los
 * procesos sin pantalla.
 *
 * El `GET` de arriba es el que el modal usa para mostrar, antes de apretar, si
 * la orden ya tiene evento y de quién es.
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

  const admin = createAdminClient();
  const hecho = await mandarLaOTAlCalendario(admin, id, {
    // El turno va tal cual vino, vacío incluido: `null` significaría
    // «calculá el hueco» y acá siempre lo eligió una persona. Un turno que no
    // es del taller lo rechaza `problemasDeMandarLaOT` nombrando los tres.
    turno: datos.turno as Turno,
    invitadosExtra: datos.invitados,
    pisar: datos.pisar,
  });
  if (!hecho.ok) {
    return NextResponse.json(
      { error: hecho.error, ...(hecho.requiereConfirmacion ? { requiere_confirmacion: true } : {}) },
      { status: hecho.estado }
    );
  }

  const advertencias = [...hecho.advertencias];
  const { data, error: errorDeLectura } = await admin
    .from("agenda_eventos")
    .select("*, agenda_invitados(email, usuario_id), usuarios!dueno_id(nombre, apellido, email)")
    .eq("id", hecho.eventoId)
    .maybeSingle();
  if (errorDeLectura || !data) {
    advertencias.push(
      `El evento se guardó (${hecho.eventoId}), pero no se pudo volver a leer${errorDeLectura ? `: ${errorDeLectura.message}` : ""}.`
    );
  }

  return NextResponse.json(
    {
      data: data ?? null,
      reemplazo: hecho.reemplazo,
      google: { escrito: hecho.enGoogle, pendiente: hecho.pendiente },
      ...(advertencias.length > 0 ? { advertencia: advertencias.join(" ") } : {}),
    },
    { status: hecho.reemplazo ? 200 : 201 }
  );
}
