import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { claveDeProveedor, indiceDeProveedores } from "@/lib/core/proveedores";
import { traerTodo } from "@/lib/core/paginado";

/**
 * Los contratistas del módulo son proveedores del SdG.
 *
 * `proveedores` es una sola lista para todo el sistema y `es_contratista`
 * distingue a quién presta un servicio de quién vende materiales. Un mismo
 * proveedor puede ser las dos cosas.
 */

/** GET — los contratistas: los proveedores que prestan servicios. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data, error } = await supabase
    .from("proveedores")
    .select("id, nombre, cuit, activo")
    .eq("es_contratista", true)
    .order("nombre");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

/**
 * POST — sumar a la lista los que aparecen en las planillas.
 *
 * Los que entran por acá quedan marcados como contratistas, y a los que ya
 * están nadie les saca la marca que tengan de Compras.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Sumar un proveedor requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const pedidos: string[] = Array.isArray(body?.nombres) ? body.nombres : [];
  if (pedidos.length === 0) {
    return NextResponse.json({ error: "No se pidió ningún proveedor" }, { status: 400 });
  }

  const admin = createAdminClient();
  const existentes = await traerTodo<{ id: string; nombre: string }>((desde, hasta) =>
    admin.from("proveedores").select("id, nombre").range(desde, hasta)
  );
  const indice = indiceDeProveedores(existentes);

  // Los que ya están se marcan como contratistas en vez de duplicarse, y los
  // que vengan repetidos en el mismo pedido se crean una sola vez.
  const aMarcar: string[] = [];
  const aCrear = new Map<string, string>();

  for (const crudo of pedidos) {
    const nombre = String(crudo ?? "").trim();
    const clave = claveDeProveedor(nombre);
    if (!clave) continue;

    const yaEsta = indice.get(clave);
    if (yaEsta) aMarcar.push(yaEsta);
    else if (!aCrear.has(clave)) aCrear.set(clave, nombre);
  }

  if (aMarcar.length > 0) {
    const { error } = await admin
      .from("proveedores")
      .update({ es_contratista: true })
      .in("id", aMarcar);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  let creados = 0;
  if (aCrear.size > 0) {
    const { data, error } = await admin
      .from("proveedores")
      .insert([...aCrear.values()].map((nombre) => ({ nombre, es_contratista: true })))
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    creados = data?.length ?? 0;
  }

  return NextResponse.json({ creados, marcados: aMarcar.length });
}

/**
 * DELETE ?id= — saca a un proveedor de la lista de contratistas.
 *
 * No lo borra: la ficha es de todo el SdG y Compras puede seguir comprándole.
 * Lo único que se saca es la marca de que también presta servicios.
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Sacar un contratista requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta el proveedor" }, { status: 400 });

  const { error } = await createAdminClient()
    .from("proveedores")
    .update({ es_contratista: false })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
