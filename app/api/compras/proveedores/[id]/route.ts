import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarCompras } from "@/lib/compras/auth";
import { empresaParaGuardar } from "@/lib/compras/altaDeProveedor";

const CAMPOS = [
  "nombre", "cuit", "rubro", "contacto", "telefono",
  "email", "notas", "es_contratista", "activo",
] as const;

/*
 * `empresa_id` y `trabaja_con_ambas` no entran por `CAMPOS`: van juntas y hay
 * un check que prohíbe las dos cargadas a la vez, así que pasan por
 * `empresaParaGuardar()`, que decide cuál gana. Y entran sólo si el cuerpo las
 * nombra: sin eso, un PATCH de otro campo le borraría la empresa al proveedor.
 */
function deQueEmpresa(body: Record<string, unknown>): Record<string, unknown> {
  if (!("empresa_id" in body) && !("trabaja_con_ambas" in body)) return {};
  return empresaParaGuardar(body);
}

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
  Object.assign(cambios, deQueEmpresa(body));

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
