import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarCompras } from "@/lib/compras/auth";

const CAMPOS = [
  "nombre", "cuit", "rubro", "contacto", "telefono",
  "email", "notas", "es_contratista", "activo",
] as const;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenes permiso para administrar proveedores" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const nombre = String(body?.nombre ?? "").trim();
  if (!nombre) return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });

  const registro: Record<string, unknown> = { nombre };
  for (const campo of CAMPOS) if (campo !== "nombre" && campo in body) registro[campo] = body[campo];

  const { data, error } = await createAdminClient()
    .from("proveedores").insert(registro).select("*").single();

  if (error) {
    // 23505 = ya existe un proveedor con ese nombre
    const mensaje = error.code === "23505" ? "Ya existe un proveedor con ese nombre" : error.message;
    return NextResponse.json({ error: mensaje }, { status: 400 });
  }
  return NextResponse.json(data, { status: 201 });
}
