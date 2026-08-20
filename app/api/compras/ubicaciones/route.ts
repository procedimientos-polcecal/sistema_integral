import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarCompras } from "@/lib/compras/auth";

const CAMPOS = ["nombre", "tipo", "sector_id", "equipo_id", "orden", "activo"] as const;

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
