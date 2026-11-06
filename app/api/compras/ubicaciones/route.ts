import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarCompras } from "@/lib/compras/auth";

const CAMPOS = ["nombre", "tipo", "sector_id", "equipo_id", "orden", "activo"] as const;

/**
 * A qué sector o a qué equipo apunta cada ubicación.
 *
 * Lo usa el alta de un requerimiento: "dónde se necesita" **es** el sector —lo
 * mismo que pregunta el formulario de Google—, así que elegirlo ya dice de qué
 * empresa es el gasto y qué equipos ofrecer. El porqué está en
 * `lib/compras/sectorDelPedido.ts`.
 *
 * Devuelve el enlace y no la lista para mostrar: las pantallas ya reciben las
 * ubicaciones por prop y duplicar esa lista sería tener dos que pueden decir
 * cosas distintas. Acá viaja sólo lo que la prop no trae.
 *
 * Lo puede leer cualquier usuario activo, como el resto de los catálogos del
 * alta: cargar un pedido no pide el módulo Compras —son nueve áreas las que
 * piden materiales— y sin esto el formulario pierde la sugerencia en silencio.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data, error } = await supabase
    .from("compras_ubicaciones")
    .select("id, sector_id, equipo_id")
    .eq("activo", true);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ubicaciones: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenés permiso para administrar ubicaciones" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const nombre = String(body?.nombre ?? "").trim();
  if (!nombre) return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });

  const registro: Record<string, unknown> = { nombre };
  for (const c of CAMPOS) if (c !== "nombre" && c in body) registro[c] = body[c];

  const { data, error } = await createAdminClient()
    .from("compras_ubicaciones")
    .insert(registro)
    .select("*")
    .single();

  if (error) {
    const mensaje = error.code === "23505" ? "Ya existe una ubicación con ese nombre" : error.message;
    return NextResponse.json({ error: mensaje }, { status: 400 });
  }
  return NextResponse.json(data, { status: 201 });
}
