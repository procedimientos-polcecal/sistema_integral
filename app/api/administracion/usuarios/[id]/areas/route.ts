import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { es_admin_check } from "@/lib/core/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";

/**
 * Reemplaza las áreas de Compras de un usuario.
 *
 * Body: `{ areas: string[] }` — los ids de `compras_areas`. Un área que no está
 * en la lista deja de estarlo.
 *
 * No es un permiso: decide qué requerimientos ve primero en Mis pedidos, y esa
 * pantalla tiene un botón para ver todos igual. Lo escribe el administrador
 * porque el área de una persona no es una preferencia suya.
 *
 * Los ids se validan contra la tabla antes de escribir. Sin eso, un id de otra
 * cosa entraría y fallaría recién en la clave foránea, con un mensaje que no
 * dice cuál de los enviados estaba mal.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const body = await cuerpoJson(request);
  const pedidas: string[] = Array.isArray(body.areas)
    ? [...new Set<string>(
        body.areas.map((a: unknown) => String(a ?? "").trim()).filter(Boolean)
      )]
    : [];

  const admin = createAdminClient();

  if (pedidas.length > 0) {
    const { data: existen, error } = await admin
      .from("compras_areas")
      .select("id")
      .in("id", pedidas);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const conocidas = new Set((existen ?? []).map((a) => a.id as string));
    const desconocidas = pedidas.filter((a) => !conocidas.has(a));
    if (desconocidas.length > 0) {
      return NextResponse.json(
        { error: `No existe el área ${desconocidas.join(", ")}` },
        { status: 400 }
      );
    }
  }

  const { error: errorDelete } = await admin
    .from("usuario_areas_compras").delete().eq("usuario_id", id);
  if (errorDelete) return NextResponse.json({ error: errorDelete.message }, { status: 500 });

  if (pedidas.length > 0) {
    const { error: errorInsert } = await admin
      .from("usuario_areas_compras")
      .insert(pedidas.map((area_id) => ({ usuario_id: id, area_id })));
    if (errorInsert) return NextResponse.json({ error: errorInsert.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
