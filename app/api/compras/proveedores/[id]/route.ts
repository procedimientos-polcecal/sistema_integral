import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarCompras } from "@/lib/compras/auth";

const CAMPOS = [
  "nombre", "cuit", "rubro", "contacto", "telefono",
  "email", "notas", "es_contratista", "activo",
] as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenes permiso para administrar proveedores" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Cuerpo invalido" }, { status: 400 });

  const cambios: Record<string, unknown> = {};
  for (const campo of CAMPOS) if (campo in body) cambios[campo] = body[campo];

  if ("nombre" in cambios) {
    const nombre = String(cambios.nombre ?? "").trim();
    if (!nombre) return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
    cambios.nombre = nombre;
  }

  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: "No se envio ningun cambio" }, { status: 400 });
  }

  const { data, error } = await createAdminClient()
    .from("proveedores").update(cambios).eq("id", id).select("*").single();

  if (error) {
    const mensaje = error.code === "23505" ? "Ya existe un proveedor con ese nombre" : error.message;
    return NextResponse.json({ error: mensaje }, { status: 400 });
  }
  return NextResponse.json(data);
}
