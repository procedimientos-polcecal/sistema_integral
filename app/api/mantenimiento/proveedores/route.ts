import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { claveDeProveedor, indiceDeProveedores } from "@/lib/core/proveedores";
import { traerTodo } from "@/lib/core/paginado";

/**
 * Sumar a la lista de proveedores los que aparecen en las planillas.
 *
 * `proveedores` es una sola lista para todo el SdG, así que los que entran por
 * acá quedan marcados como contratistas: prestan un servicio, no venden
 * materiales. Un mismo proveedor puede ser las dos cosas y nadie le saca la
 * marca de Compras al ponerle ésta.
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
