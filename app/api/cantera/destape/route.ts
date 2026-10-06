import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarCantera, tieneAccesoCantera } from "@/lib/cantera/auth";
import { traerDestape } from "@/lib/cantera/consultas";
import { esTipoDeCamionValido, esTipoDeRecursoValido, ETIQUETA_TIPO_CAMION, type TipoDeCamion } from "@/lib/cantera/destape";

/**
 * Un recurso (máquina propia + operario, o fletero + camión) usado un día
 * para destapar. No hay una clave natural para upsert —el mismo fletero
 * puede aparecer varias veces el mismo día con horarios distintos, como ya
 * pasa en la planilla real—, así que `POST` siempre inserta una fila nueva;
 * para corregir una ya cargada está `PATCH` (por `id`).
 *
 * Pivote del 01/10/2026: un registro de `fletero_externo` ya no pide el
 * fletero ni las horas a mano — se eligen de una carga de "horas_destape"
 * de Acarreo (`acarreo_id`), y de ahí salen el fletero, las horas y la
 * fecha, pisando lo que venga en el cuerpo para esos tres campos. Es la
 * misma idea que ya tenía la pantalla de Destape como referencia cruzada
 * ("Horas de destape en Acarreo"), llevada al dato real en vez de quedarse
 * en un cartel al lado. Ver la migración 20261001100930.
 *
 * Los registros de `fletero_externo` cargados ANTES de este cambio no
 * tienen `acarreo_id` (se tipeó el fletero a mano) y se siguen pudiendo
 * editar como antes — no se les fuerza un link a una carga de Acarreo que
 * puede no existir más.
 */

function tipoCamionOError(b: Record<string, unknown>): TipoDeCamion | { error: string } {
  if (!esTipoDeCamionValido(b.tipo_camion)) return { error: "Elegí el tipo de camión" };
  return b.tipo_camion;
}

type CuerpoResuelto = {
  fecha: string;
  yacimiento_codigo: string | null;
  frente: string | null;
  tipo_recurso: string;
  operario_id: string | null;
  fletero_id: string | null;
  recurso_raw: string;
  equipo_id: string | null;
  equipo_o_vehiculo_raw: string;
  tipo_camion: string | null;
  horas: number;
  viajes: number | null;
  observaciones: string | null;
  acarreo_id: string | null;
};

/**
 * Valida y arma el cuerpo final a insertar/actualizar, según el tipo de
 * recurso. Para `fletero_externo` resuelve fletero/horas/fecha desde
 * `acarreo_id` cuando viene uno — es la fuente de verdad, no lo que haya
 * mandado el cliente para esos tres campos — salvo que se esté editando un
 * registro viejo sin `acarreo_id` (`existente`), donde se preserva el modo
 * manual de siempre.
 */
async function resolverCuerpoDestape(
  supabase: SupabaseClient,
  b: Record<string, unknown>,
  existente: { tipo_recurso: string; acarreo_id: string | null } | null
): Promise<CuerpoResuelto | { error: string }> {
  if (!esTipoDeRecursoValido(b.tipo_recurso)) return { error: "Tipo de recurso inválido" };

  const comunes = {
    yacimiento_codigo: (b.yacimiento_codigo as string) || null,
    frente: (b.frente as string) || null,
    observaciones: (b.observaciones as string) || null,
  };

  if (b.tipo_recurso === "operario_propio") {
    if (typeof b.fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.fecha)) return { error: "La fecha va como YYYY-MM-DD" };
    if (!b.recurso_raw || typeof b.recurso_raw !== "string") return { error: "Falta el operario" };
    if (!b.equipo_o_vehiculo_raw || typeof b.equipo_o_vehiculo_raw !== "string") return { error: "Falta el equipo" };
    const horas = Number(b.horas);
    if (!isFinite(horas) || horas <= 0) return { error: "Las horas tienen que ser un número mayor a cero" };
    return {
      ...comunes,
      fecha: b.fecha,
      tipo_recurso: "operario_propio",
      operario_id: (b.operario_id as string) || null,
      fletero_id: null,
      recurso_raw: b.recurso_raw,
      equipo_id: (b.equipo_id as string) || null,
      equipo_o_vehiculo_raw: b.equipo_o_vehiculo_raw,
      tipo_camion: null,
      horas,
      viajes: null,
      acarreo_id: null,
    };
  }

  // fletero_externo
  const acarreoId = b.acarreo_id ? String(b.acarreo_id) : null;
  const viajes = b.viajes === "" || b.viajes == null ? null : Number(b.viajes);

  if (acarreoId) {
    const { data: acarreo, error: errAcarreo } = await supabase
      .from("cantera_acarreos")
      .select("id, fletero_id, fecha, cantidad, tipo")
      .eq("id", acarreoId)
      .maybeSingle();
    if (errAcarreo) return { error: errAcarreo.message };
    if (!acarreo) return { error: "No se encontró esa carga de Acarreo" };
    if (acarreo.tipo !== "horas_destape") return { error: "Esa carga de Acarreo no es de horas de destape" };
    if (!acarreo.fletero_id) return { error: "Esa carga de Acarreo no tiene fletero" };

    const tipoCamion = tipoCamionOError(b);
    if (typeof tipoCamion !== "string") return tipoCamion;

    const { data: fletero } = await supabase.from("cantera_fleteros").select("nombre").eq("id", acarreo.fletero_id).maybeSingle();

    return {
      ...comunes,
      fecha: acarreo.fecha,
      tipo_recurso: "fletero_externo",
      operario_id: null,
      fletero_id: acarreo.fletero_id,
      recurso_raw: fletero?.nombre ?? "(fletero desconocido)",
      equipo_id: null,
      equipo_o_vehiculo_raw: ETIQUETA_TIPO_CAMION[tipoCamion],
      tipo_camion: tipoCamion,
      horas: acarreo.cantidad,
      viajes,
      acarreo_id: acarreo.id,
    };
  }

  // Sin acarreo_id: sólo se admite para editar un registro viejo que ya era
  // así (fletero tipeado a mano, de antes del 01/10/2026) — nunca para uno
  // nuevo ni para uno que ya estaba vinculado a una carga de Acarreo.
  const puedeUsarCargaManual = existente !== null && existente.tipo_recurso === "fletero_externo" && existente.acarreo_id === null;
  if (!puedeUsarCargaManual) return { error: "Elegí de qué carga de Acarreo vienen las horas" };

  if (typeof b.fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.fecha)) return { error: "La fecha va como YYYY-MM-DD" };
  if (!b.recurso_raw || typeof b.recurso_raw !== "string") return { error: "Falta el fletero" };
  if (!b.equipo_o_vehiculo_raw || typeof b.equipo_o_vehiculo_raw !== "string") return { error: "Falta el tipo de camión" };
  if (b.tipo_camion && !esTipoDeCamionValido(b.tipo_camion)) return { error: "Tipo de camión inválido" };
  const horas = Number(b.horas);
  if (!isFinite(horas) || horas <= 0) return { error: "Las horas tienen que ser un número mayor a cero" };
  return {
    ...comunes,
    fecha: b.fecha,
    tipo_recurso: "fletero_externo",
    operario_id: null,
    fletero_id: (b.fletero_id as string) || null,
    recurso_raw: b.recurso_raw,
    equipo_id: null,
    equipo_o_vehiculo_raw: b.equipo_o_vehiculo_raw,
    tipo_camion: (b.tipo_camion as string) || null,
    horas,
    viajes,
    acarreo_id: null,
  };
}

const COLUMNAS =
  "id, fecha, yacimiento_codigo, frente, tipo_recurso, operario_id, fletero_id, recurso_raw, equipo_id, equipo_o_vehiculo_raw, tipo_camion, horas, viajes, observaciones, sheets_pendiente, acarreo_id";

/** El error de Postgres por violar `cantera_destape_acarreo_id_unq` — ese link ya lo usó otro registro. */
function esErrorDeAcarreoYaUsado(error: { code?: string; message: string }): boolean {
  return error.code === "23505" && error.message.includes("acarreo_id");
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Cantera" }, { status: 403 });
  }

  const url = new URL(request.url);
  const desde = url.searchParams.get("desde") ?? undefined;
  const hasta = url.searchParams.get("hasta") ?? undefined;
  const yacimientoCodigo = url.searchParams.get("yacimiento") ?? undefined;

  return NextResponse.json({ data: await traerDestape(supabase, { desde, hasta, yacimientoCodigo }) });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para cargar destape" }, { status: 403 });
  }

  const b = await cuerpoJson(request);
  const resuelto = await resolverCuerpoDestape(supabase, b, null);
  if ("error" in resuelto) return NextResponse.json({ error: resuelto.error }, { status: 400 });

  const { data, error } = await supabase
    .from("cantera_destape")
    .insert({ ...resuelto, cargado_por: user.id })
    .select(COLUMNAS)
    .single();

  if (error) {
    if (esErrorDeAcarreoYaUsado(error)) {
      return NextResponse.json({ error: "Esas horas de Acarreo ya están clasificadas en otro registro de Destape" }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ data });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para editar destape" }, { status: 403 });
  }

  const b = await cuerpoJson(request);
  const id = String(b?.id ?? "");
  if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });

  const { data: existente, error: errExistente } = await supabase
    .from("cantera_destape")
    .select("tipo_recurso, acarreo_id")
    .eq("id", id)
    .maybeSingle();
  if (errExistente) return NextResponse.json({ error: errExistente.message }, { status: 400 });
  if (!existente) return NextResponse.json({ error: "No se encontró el registro" }, { status: 404 });

  const resuelto = await resolverCuerpoDestape(supabase, b, existente);
  if ("error" in resuelto) return NextResponse.json({ error: resuelto.error }, { status: 400 });

  const { data, error } = await supabase
    .from("cantera_destape")
    .update({ ...resuelto, actualizado_por: user.id, actualizado_en: new Date().toISOString() })
    .eq("id", id)
    .select(COLUMNAS)
    .single();

  if (error) {
    if (esErrorDeAcarreoYaUsado(error)) {
      return NextResponse.json({ error: "Esas horas de Acarreo ya están clasificadas en otro registro de Destape" }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para editar destape" }, { status: 403 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });

  const { error } = await supabase.from("cantera_destape").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
