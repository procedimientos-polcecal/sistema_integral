import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esAdminMantenimiento } from "@/lib/mantenimiento/auth";

/**
 * Los operarios que se pueden anotar al registrar una orden de trabajo.
 *
 * La planilla tiene tres columnas de operario y cada una tiene su propia
 * lista: quién puede ir primero no es quién puede ir tercero. Por eso el
 * `slot`, que es la posición, y no un simple listado de gente.
 */

const SLOTS = [1, 2, 3];

/** GET — la lista, para los desplegables. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data, error } = await supabase
    .from("operarios")
    .select("id, slot, nombre")
    .order("slot")
    .order("nombre");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

/** POST — sumar un operario a una posición. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await esAdminMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Administrar los operarios requiere ser admin de Mantenimiento" },
      { status: 403 }
    );
  }

  const b = await request.json().catch(() => null);
  const nombre = String(b?.nombre ?? "").trim();
  const slot = Number(b?.slot);

  if (!nombre) return NextResponse.json({ error: "Falta el nombre" }, { status: 400 });
  if (!SLOTS.includes(slot)) {
    return NextResponse.json({ error: "La posición tiene que ser 1, 2 o 3" }, { status: 400 });
  }

  const { data, error } = await createAdminClient()
    .from("operarios")
    .insert({ nombre, slot })
    .select()
    .single();

  if (error) {
    // El único conflicto posible es que ya esté en esa posición.
    const yaEsta = error.code === "23505";
    return NextResponse.json(
      { error: yaEsta ? `"${nombre}" ya está en la posición ${slot}` : error.message },
      { status: 400 }
    );
  }
  return NextResponse.json({ data });
}

/** DELETE ?id= — sacar un operario de la lista. */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await esAdminMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Administrar los operarios requiere ser admin de Mantenimiento" },
      { status: 403 }
    );
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta el operario" }, { status: 400 });

  // Sacarlo de la lista no toca las OT donde ya quedó anotado: ahí el nombre
  // es texto y es el registro de quién hizo el trabajo.
  const { error } = await createAdminClient().from("operarios").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
