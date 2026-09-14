import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { esAdminCantera, tieneAccesoCantera } from "@/lib/cantera/auth";
import { traerFleteros } from "@/lib/cantera/consultas";

/**
 * El catálogo de fleteros de acarreo. `GET` con acceso al módulo; alta y
 * edición sólo el admin — mismo criterio que insumos y yacimientos. No se
 * borra: `activo: false`.
 */

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Cantera" }, { status: 403 });
  }
  return NextResponse.json({ data: await traerFleteros(supabase) });
}

export async function POST(request: Request) {
  return guardar(request, "alta");
}

export async function PATCH(request: Request) {
  return guardar(request, "edicion");
}

async function guardar(request: Request, modo: "alta" | "edicion") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sólo un admin de Cantera edita el catálogo de fleteros" }, { status: 403 });
  }

  const b = await cuerpoJson(request);

  if (modo === "alta") {
    const nombre = String(b?.nombre ?? "").trim();
    if (!nombre) return NextResponse.json({ error: "Falta el nombre del fletero" }, { status: 400 });

    const { data, error } = await supabase
      .from("cantera_fleteros")
      .insert({ nombre, patente: b?.patente ? String(b.patente).trim() : null })
      .select("id, nombre, patente, activo")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ data });
  }

  if (typeof b?.id !== "string" || b.id === "") {
    return NextResponse.json({ error: "Falta el id del fletero a editar" }, { status: 400 });
  }

  const cambios: Record<string, unknown> = {};
  if (b.nombre !== undefined) cambios.nombre = String(b.nombre).trim();
  if (b.patente !== undefined) cambios.patente = b.patente ? String(b.patente).trim() : null;
  if (typeof b.activo === "boolean") cambios.activo = b.activo;

  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: "No vino ningún cambio" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("cantera_fleteros")
    .update(cambios)
    .eq("id", b.id)
    .select("id, nombre, patente, activo")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
