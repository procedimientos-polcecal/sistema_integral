import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { esAdminCantera } from "@/lib/cantera/auth";

/**
 * La lista de contratistas de cantera (hoy Canobe y, cuando se cargue,
 * Voladuras Olavarría) — sin rol, cualquiera factura cualquier etapa
 * (confirmado con el usuario). El cruce con Odoo lo resuelve
 * `proveedores_odoo` por CUIT; acá sólo se administra la pertenencia a la
 * lista, igual que `cantera_finanzas`.
 */

async function guardia(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  if (!(await esAdminCantera(supabase, user.id))) {
    return {
      error: NextResponse.json(
        { error: "Administrar la lista de contratistas requiere nivel de administrador de Cantera" },
        { status: 403 }
      ),
    };
  }
  return { user };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const g = await guardia(supabase);
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const proveedorId = String(body?.proveedor_id ?? "").trim();
  if (!proveedorId) return NextResponse.json({ error: "Falta el proveedor" }, { status: 400 });

  const { data, error } = await supabase
    .from("cantera_contratistas")
    .upsert({ proveedor_id: proveedorId }, { onConflict: "proveedor_id" })
    .select("proveedor_id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const g = await guardia(supabase);
  if (g.error) return g.error;

  const proveedorId = new URL(request.url).searchParams.get("proveedor_id") ?? "";
  if (!proveedorId) return NextResponse.json({ error: "Falta el proveedor" }, { status: 400 });

  const { error } = await supabase.from("cantera_contratistas").delete().eq("proveedor_id", proveedorId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
