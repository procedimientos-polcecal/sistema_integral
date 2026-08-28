import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esAdminMantenimiento } from "@/lib/mantenimiento/auth";

/**
 * El precio de una hora de mano de obra propia.
 *
 * Cada tarifa dice desde cuándo rige, y una hora trabajada se costea con la que
 * regía ese día. Por eso se agrega una fila en vez de actualizar un valor:
 * pisarlo reescribiría lo que costó una reparación de hace seis meses.
 */

/** GET — el histórico, de la más nueva a la más vieja. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data, error } = await supabase
    .from("mantenimiento_tarifas_hora")
    .select("id, valor, vigente_desde")
    .order("vigente_desde", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

/** POST — cargar una tarifa con su fecha de vigencia. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await esAdminMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Definir la tarifa de la hora requiere ser admin de Mantenimiento" },
      { status: 403 }
    );
  }

  const b = await request.json().catch(() => null);
  const valor = Number(b?.valor);
  const vigenteDesde = String(b?.vigente_desde ?? "").trim();

  if (!Number.isFinite(valor) || valor < 0) {
    return NextResponse.json({ error: "El valor de la hora tiene que ser un número" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vigenteDesde)) {
    return NextResponse.json({ error: "Falta desde cuándo rige" }, { status: 400 });
  }

  // Cargar una tarifa para una fecha que ya tiene otra es una corrección, no
  // una segunda tarifa del mismo día: se reemplaza.
  const { data, error } = await createAdminClient()
    .from("mantenimiento_tarifas_hora")
    .upsert(
      { valor, vigente_desde: vigenteDesde, creado_por: user.id },
      { onConflict: "vigente_desde" }
    )
    .select("id, valor, vigente_desde")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

/** DELETE — sacar una tarifa cargada por error. */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await esAdminMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Definir la tarifa de la hora requiere ser admin de Mantenimiento" },
      { status: 403 }
    );
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta cuál" }, { status: 400 });

  const { error } = await createAdminClient()
    .from("mantenimiento_tarifas_hora")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
