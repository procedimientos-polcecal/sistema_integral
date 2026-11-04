import { NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { traerTodo } from "@/lib/core/paginado";
import { comoSeLee, esFechaIso } from "@/lib/core/fechas";
import { invitadosExtraDeLaOT } from "@/lib/agenda/evento";
import { mandarLaOTAlCalendario, TURNO_AUTOMATICO } from "@/lib/agenda/mandarLaOT";
import { ES_UUID, quienLlama } from "@/lib/agenda/sesion";
import { RAZON_DEL_PLAN, justificacionDelPlan, queHacerConElItem } from "@/lib/mantenimiento/planAlCalendario";
import type { Turno } from "@/lib/mantenimiento/programacion";
// **La escritura de la fecha es la de postergar, no una copia.** Su orden de
// pasos es media decisión de diseño (la planilla primero, después la base, con
// `fecha_ejecucion_pendiente` protegiendo la fila mientras el derrame llega) y
// duplicarlo es la forma de que un día los dos caminos dejen de coincidir.
import { POST as postergarLaOT } from "@/app/api/mantenimiento/ordenes/[id]/postergar/route";

type Params = { params: Promise<{ id: string }> };

/** Cada orden escribe en la planilla y en Google, de a una: un plan grande no entra en el minuto por defecto. */
export const maxDuration = 300;

const esquema = z.object({
  /** Sin esto, el plan entero. */
  item_id: z.string().regex(ES_UUID, "no es un ítem válido").optional(),
});

/** Qué pasó con cada ítem. La pantalla lo muestra renglón por renglón. */
type Resultado = {
  item_id: string;
  ot_number: number | null;
  estado: "mandada" | "mandada_en_otra_fecha" | "salteada" | "fallo";
  /** El día en que quedó (o iba a quedar) el evento. */
  fecha: string | null;
  /** `true` si el plan le cambió la fecha a la orden. */
  fecha_corrida: boolean;
  /** Lo que la persona tiene que saber: por qué se salteó, por qué no se movió, qué falló. */
  mensaje: string | null;
  advertencias: string[];
};

type Item = { id: string; ot_number: number | null; work_order_id: string | null };

/**
 * POST — mandar un plan del día al calendario, entero o un ítem (`item_id`).
 *
 * **El plan manda la fecha** (ver `planAlCalendario.ts` para qué pasa cuando no
 * puede): si la orden es del SdG y está para antes que el plan, se le corre la
 * fecha por la ruta de postergar y después se manda el evento. Con el evento ya
 * mandado, `mandarLaOTAlCalendario` hace el resto.
 *
 * **Se lee la orden y nunca la copia del ítem.** El ítem tiene su propia
 * `fecha_ejecucion`, editable, que no vuelve a la orden: decidir con ella
 * correría una fecha que no es la de la orden, o no correría una que sí hace
 * falta.
 *
 * **Un ítem que falla no cancela a los demás**: se recorren de a uno, cada uno
 * con su propio `try`, y la respuesta trae un renglón por ítem. De a uno y no en
 * paralelo: cada postergación escribe una celda de la planilla de producción.
 *
 * **Se manda sin turno** (`turno: null`), o sea que el horario sale del apilado
 * automático, y **sin pisar** (`pisar: false`): el plan no tiene dónde preguntar
 * cuál turno ni si se pisa lo que alguien movió en Google, y un 409 por eso es
 * un renglón en el informe. Con una excepción, que es lo que evita una
 * sorpresa: **si la orden ya tenía evento, se conservan su turno y sus
 * invitados extra.** Reenviar reemplaza ambos, y el plan no los conoce.
 *
 * **Y esta ruta no está en el registro de `revisar-exportaciones`, a propósito
 * y sabiendo que escribe en una planilla**: lo hace sólo a través de la ruta de
 * postergar, que sí está declarada (`aborta`: la planilla primero, y si no
 * contesta no se mueve nada), y el script sólo sigue la indirección desde los
 * módulos `delega`. Declararla `delega` daría un «MIRAR: ya no escribe» que no
 * es cierto, y no declararla es lo que es: la obligación de anotar no se mudó
 * acá, se quedó en postergar, que la cumple por su cuenta.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const quien = await quienLlama(supabase);
  if (!quien.ok) return quien.respuesta;

  if (!(await puedeEditarMantenimiento(supabase, quien.id))) {
    return NextResponse.json(
      { error: "Mandar un plan al calendario requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  // Sin cuerpo es el plan entero; con un cuerpo que no es un objeto, un 400.
  const texto = await request.text();
  let cuerpo: unknown = {};
  if (texto.trim() !== "") {
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      return NextResponse.json({ error: "El pedido no trae un cuerpo válido" }, { status: 400 });
    }
  }
  if (typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) {
    return NextResponse.json({ error: "El pedido no trae un cuerpo válido" }, { status: 400 });
  }
  const r = validar(esquema, cuerpo);
  if (!r.ok) return errorDeValidacion(r.problemas);
  const { item_id: itemId } = r.datos;

  if (!ES_UUID.test(id)) return NextResponse.json({ error: "No existe ese plan" }, { status: 404 });

  const admin = createAdminClient();
  const { data: plan, error: errorDelPlan } = await admin
    .from("planificacion_diaria")
    .select("id, fecha")
    .eq("id", id)
    .maybeSingle();
  if (errorDelPlan) {
    return NextResponse.json({ error: `No se pudo leer el plan: ${errorDelPlan.message}` }, { status: 500 });
  }
  if (!plan) return NextResponse.json({ error: "No existe ese plan" }, { status: 404 });
  // `date` en Postgres: no debería llegar de otra forma, pero todo lo que sigue
  // compara texto contra texto.
  if (!esFechaIso(plan.fecha)) {
    return NextResponse.json({ error: `El plan tiene una fecha ilegible («${plan.fecha}»)` }, { status: 500 });
  }

  let items: Item[];
  try {
    items = await traerTodo<Item>((desde, hasta) =>
      admin
        .from("planificacion_diaria_items")
        // La cadena va literal y en una sola pieza: partida con `+` pierde la
        // inferencia de tipos de Supabase.
        .select("id, ot_number, work_order_id")
        .eq("plan_id", id)
        .order("orden")
        .order("id")
        .range(desde, hasta)
        .returns<Item[]>()
    );
  } catch (e) {
    return NextResponse.json(
      { error: `No se pudieron leer los ítems del plan: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }

  if (itemId) {
    items = items.filter((i) => i.id === itemId);
    if (items.length === 0) return NextResponse.json({ error: "Ese ítem no está en este plan" }, { status: 404 });
  } else if (items.length === 0) {
    return NextResponse.json({ error: "El plan no tiene ítems para mandar" }, { status: 400 });
  }

  // De a uno, y cada uno con su propio `try`: un fallo no cancela los demás.
  const resultados: Resultado[] = [];
  for (const item of items) {
    try {
      resultados.push(await mandarUnItem(admin, item, plan.fecha));
    } catch (e) {
      resultados.push({
        item_id: item.id,
        ot_number: item.ot_number,
        estado: "fallo",
        fecha: null,
        fecha_corrida: false,
        mensaje: `Falló de golpe: ${e instanceof Error ? e.message : String(e)}`,
        advertencias: [],
      });
    }
  }

  const cuenta = (estado: Resultado["estado"]) => resultados.filter((x) => x.estado === estado).length;
  return NextResponse.json({
    plan: { id: plan.id, fecha: plan.fecha },
    resultados,
    resumen: {
      mandadas: cuenta("mandada"),
      mandadas_en_otra_fecha: cuenta("mandada_en_otra_fecha"),
      salteadas: cuenta("salteada"),
      fallaron: cuenta("fallo"),
    },
  });
}

async function mandarUnItem(admin: SupabaseClient, item: Item, fechaDelPlan: string): Promise<Resultado> {
  const base = { item_id: item.id, ot_number: item.ot_number, fecha_corrida: false, advertencias: [] as string[] };
  const salteada = (mensaje: string): Resultado => ({ ...base, estado: "salteada", fecha: null, mensaje });
  const fallo = (mensaje: string, fecha: string | null = null): Resultado => ({ ...base, estado: "fallo", fecha, mensaje });

  if (!item.work_order_id && item.ot_number === null) {
    return salteada("El ítem no tiene ninguna OT asociada.");
  }

  // ── La orden de verdad ────────────────────────────────────────────────────
  const consulta = admin
    .from("ordenes_trabajo")
    // La cadena va literal y en una sola pieza.
    .select("id, ot_number, fecha_ejecucion, fecha_ejecucion_pendiente, fecha_cierre, estado, app_created");
  const { data: orden, error: errorDeOrden } = await (item.work_order_id
    ? consulta.eq("id", item.work_order_id)
    : consulta.eq("ot_number", item.ot_number as number)
  ).maybeSingle();
  if (errorDeOrden) return fallo(`No se pudo leer la orden: ${errorDeOrden.message}`);

  const decision = queHacerConElItem({ ot_number: item.ot_number ?? orden?.ot_number ?? 0 }, orden, fechaDelPlan);
  if (decision.que === "saltear") return salteada(decision.motivo);
  // `decision` no es `saltear`, así que la orden existe.
  const ordenId = (orden as { id: string }).id;

  const advertencias = [...base.advertencias];
  let fechaCorrida = false;

  // ── El plan manda: se le corre la fecha, por la ruta de postergar ─────────
  if (decision.que === "correr-y-mandar") {
    const pedido = new Request("http://interno/postergar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        razon: RAZON_DEL_PLAN,
        dias: decision.dias,
        justificacion: justificacionDelPlan(fechaDelPlan),
      }),
    });
    const respuesta = await postergarLaOT(pedido, { params: Promise.resolve({ id: ordenId }) });
    const cuerpo = (await respuesta.json().catch(() => ({}))) as {
      error?: string; nota_error?: string | null; planilla_error?: string | null;
      data?: { fecha_ejecucion?: string };
    };
    if (!respuesta.ok) {
      // Postergar ya dice, en cada uno de sus fallos, qué quedó hecho y qué no.
      // El evento no se manda: iría en una fecha que el plan no quiso.
      return fallo(
        `No se le pudo correr la fecha de la orden al ${comoSeLee(fechaDelPlan)}. ${cuerpo.error ?? `Respondió ${respuesta.status}.`}`
      );
    }
    fechaCorrida = true;
    // Postergar corre desde `fecha_ejecucion` y el plan midió contra la fecha
    // del calendario (la pendiente, si la hay). Son la misma mientras la
    // pendiente se escribe sólo desde postergar, y si algún día dejan de serlo
    // la cuenta caería en otro día sin avisar: por eso se comprueba.
    if (cuerpo.data?.fecha_ejecucion && cuerpo.data.fecha_ejecucion !== decision.fecha) {
      advertencias.push(
        `La fecha de la orden quedó en el ${comoSeLee(cuerpo.data.fecha_ejecucion)} y no en el ` +
          `${comoSeLee(decision.fecha)} del plan.`
      );
    }
    if (cuerpo.nota_error) advertencias.push(`La fecha se corrió, pero no se pudo guardar la nota: ${cuerpo.nota_error}`);
    if (cuerpo.planilla_error) {
      advertencias.push(`La fecha se corrió, pero la nota no llegó a la planilla: ${cuerpo.planilla_error}`);
    }
  }

  // ── Lo que el evento ya tenía, para no sacárselo sin avisar ───────────────
  const previo = await loQueYaTieneElEvento(admin, ordenId);
  if (!previo.ok) {
    return { ...base, estado: "fallo", fecha: decision.fecha, fecha_corrida: fechaCorrida, advertencias,
      mensaje: previo.error + (fechaCorrida ? " La fecha de la orden sí se corrió." : "") };
  }

  // ── El evento ─────────────────────────────────────────────────────────────
  const hecho = await mandarLaOTAlCalendario(admin, ordenId, {
    turno: previo.turno,
    invitadosExtra: previo.invitadosExtra,
    pisar: false,
  });
  if (!hecho.ok) {
    return {
      ...base, estado: "fallo", fecha: decision.fecha, fecha_corrida: fechaCorrida, advertencias,
      mensaje:
        `${hecho.error}` +
        (fechaCorrida ? ` La fecha de la orden sí se corrió al ${comoSeLee(decision.fecha)}.` : ""),
    };
  }
  advertencias.push(...hecho.advertencias);

  const avisando = decision.que === "mandar-avisando";
  return {
    ...base,
    estado: avisando ? "mandada_en_otra_fecha" : "mandada",
    fecha: decision.fecha,
    fecha_corrida: fechaCorrida,
    mensaje: avisando ? decision.aviso : null,
    advertencias,
  };
}

/**
 * El turno y los invitados extra del evento que la orden ya tenga, para
 * reenviarla sin cambiarlos. **Sin evento, o con el de turno automático, se
 * vuelve a calcular** (`turno: null`): es el camino del plan. Con un turno que
 * una persona eligió a mano, se conserva: reenviar con `null` lo pasaría a
 * `8-16` sin que nadie lo pidiera.
 */
async function loQueYaTieneElEvento(
  admin: SupabaseClient,
  ordenId: string
): Promise<{ ok: true; turno: Turno | null; invitadosExtra: string[] } | { ok: false; error: string }> {
  const { data: evento, error } = await admin
    .from("agenda_eventos")
    .select("id, turno")
    .eq("ot_id", ordenId)
    .maybeSingle();
  if (error) return { ok: false, error: `No se pudo leer el evento de la orden: ${error.message}` };
  if (!evento) return { ok: true, turno: null, invitadosExtra: [] };

  const { data: invitados, error: errorDeInvitados } = await admin
    .from("agenda_invitados")
    .select("email")
    .eq("evento_id", evento.id);
  if (errorDeInvitados) {
    return { ok: false, error: `No se pudieron leer los invitados del evento: ${errorDeInvitados.message}` };
  }

  const turno = evento.turno && evento.turno !== TURNO_AUTOMATICO ? (evento.turno as Turno) : null;
  return {
    ok: true,
    turno,
    invitadosExtra: invitadosExtraDeLaOT((invitados ?? []).map((i: { email: string }) => i.email)),
  };
}
