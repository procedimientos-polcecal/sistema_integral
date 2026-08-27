import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esAdminMantenimiento } from "@/lib/mantenimiento/auth";
import { COLUMNAS_TIPO } from "@/lib/mantenimiento/ficha";

/**
 * El catálogo de tipos de equipo.
 *
 * Dice qué lleva cada clase de máquina —qué rodamiento, qué lubricante, cada
 * cuánto— y de ahí sale lo que hay que tener a mano antes de abrir una. Se
 * carga importando el libro BD Equipos, pero lo que se aprende reparando no
 * vuelve al libro: por eso también se edita acá.
 */

/** GET — todos los tipos. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data, error } = await supabase
    .from("equipos_tipos")
    .select("*")
    .order("categoria")
    .order("nombre_tipo");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

/**
 * PATCH — cambiar un tipo.
 *
 * Sólo las columnas que el libro trae: el resto del body se ignora, así un
 * campo de más en la pantalla no puede escribir donde no debe.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await esAdminMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Editar el catálogo de tipos requiere ser admin de Mantenimiento" },
      { status: 403 }
    );
  }

  const b = await request.json().catch(() => null);
  const tipo_id = String(b?.tipo_id ?? "").trim();
  if (!tipo_id) return NextResponse.json({ error: "Falta el tipo" }, { status: 400 });

  const campos: Record<string, string | null> = {};
  for (const columna of COLUMNAS_TIPO) {
    if (!(columna in (b ?? {}))) continue;
    campos[columna] = String(b[columna] ?? "").trim() || null;
  }

  if (Object.keys(campos).length === 0) {
    return NextResponse.json({ error: "No hay nada para cambiar" }, { status: 400 });
  }

  const { data, error } = await createAdminClient()
    .from("equipos_tipos")
    .update(campos)
    .eq("tipo_id", tipo_id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}

/**
 * POST — un tipo nuevo.
 *
 * El identificador lo pone quien lo crea y es el que va a usar el libro: si no
 * coincide, la próxima importación crea otro al lado.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await esAdminMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Crear un tipo requiere ser admin de Mantenimiento" },
      { status: 403 }
    );
  }

  const b = await request.json().catch(() => null);
  const tipo_id = String(b?.tipo_id ?? "").trim().toUpperCase();
  const nombre_tipo = String(b?.nombre_tipo ?? "").trim();

  if (!tipo_id) return NextResponse.json({ error: "Falta el código del tipo" }, { status: 400 });
  if (!nombre_tipo) return NextResponse.json({ error: "Falta el nombre del tipo" }, { status: 400 });

  const campos: Record<string, string | null> = { tipo_id, nombre_tipo };
  for (const columna of COLUMNAS_TIPO) {
    if (columna === "nombre_tipo" || !(columna in (b ?? {}))) continue;
    campos[columna] = String(b[columna] ?? "").trim() || null;
  }

  const { data, error } = await createAdminClient()
    .from("equipos_tipos")
    .insert(campos)
    .select()
    .single();

  if (error) {
    const yaEsta = error.code === "23505";
    return NextResponse.json(
      { error: yaEsta ? `Ya existe un tipo con el código "${tipo_id}"` : error.message },
      { status: 400 }
    );
  }
  return NextResponse.json({ data });
}
