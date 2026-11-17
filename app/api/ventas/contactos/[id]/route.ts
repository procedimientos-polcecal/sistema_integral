import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { esAdminVentas, noSePudoAveriguar, puedeEditarVentas } from "@/lib/ventas/auth";
import { esquemaDeContactoParcial } from "@/lib/ventas/crm/cuerpos";
import { validar, errorDeValidacion } from "@/lib/core/validar";

/**
 * Un contacto: corregirlo (PATCH) y sacarlo (DELETE).
 *
 * ── «SE FUE DE LA EMPRESA» NO ES «BORRAR» ───────────────────
 *
 * Para eso está `activo`, y es lo que la pantalla ofrece. Un contacto inactivo
 * sigue colgando de las actividades en las que participó, que es lo que permite
 * entender seis meses después con quién se había hablado. Borrarlo deja esas
 * actividades con `contacto_id` en null (`on delete set null`): el registro de
 * la conversación queda, pero ya no se sabe con quién fue.
 *
 * Por eso borrar es de `admin` y el camino normal es desactivar.
 */

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ES_UUID.test(id)) return NextResponse.json({ error: "Id inválido" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const permiso = await puedeEditarVentas(supabase, user.id);
  if (!permiso.ok) return noSePudoAveriguar(permiso);
  if (!permiso.si) {
    return NextResponse.json({ error: "No tenés permiso para corregir contactos" }, { status: 403 });
  }

  const r = validar(esquemaDeContactoParcial, await request.json().catch(() => null));
  if (!r.ok) return errorDeValidacion(r.problemas);
  const c = r.datos;

  const cambios: Record<string, unknown> = {};
  for (const campo of ["nombre", "cargo", "telefono", "notas"] as const) {
    if (campo in c) cambios[campo] = c[campo] ?? null;
  }
  if ("email" in c) cambios.email = c.email || null;
  if ("es_principal" in c) cambios.es_principal = c.es_principal;
  if ("activo" in c) cambios.activo = c.activo;

  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: "No mandaste ningún cambio" }, { status: 400 });
  }

  // Mover el principal necesita saber de qué cliente es, y eso no viene en el
  // cuerpo: `cliente_id` no se corrige (un contacto no se muda de empresa).
  if (c.es_principal === true) {
    const { data: suyo, error: errorDelCliente } = await supabase
      .from("ventas_contactos")
      .select("cliente_id")
      .eq("id", id)
      .maybeSingle();
    if (errorDelCliente) {
      return NextResponse.json(
        { error: `No se pudo leer el contacto: ${errorDelCliente.message}` },
        { status: 503 }
      );
    }
    if (!suyo) return NextResponse.json({ error: "No existe ese contacto" }, { status: 404 });

    const { error } = await supabase
      .from("ventas_contactos")
      .update({ es_principal: false })
      .eq("cliente_id", suyo.cliente_id)
      .eq("es_principal", true)
      .neq("id", id);
    if (error) {
      return NextResponse.json(
        { error: `No se pudo mover el contacto principal: ${error.message}` },
        { status: 500 }
      );
    }
  }

  const { data, error } = await supabase
    .from("ventas_contactos")
    .update(cambios)
    .eq("id", id)
    .select("id, nombre, cargo, telefono, email, es_principal, activo, notas")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: `No se pudo guardar el cambio: ${error.message}` },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json({ error: "No existe ese contacto o no podés tocarlo" }, { status: 404 });
  }

  return NextResponse.json({ contacto: data });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ES_UUID.test(id)) return NextResponse.json({ error: "Id inválido" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const permiso = await esAdminVentas(supabase, user.id);
  if (!permiso.ok) return noSePudoAveriguar(permiso);
  if (!permiso.si) {
    return NextResponse.json(
      {
        error:
          "Borrar un contacto requiere nivel admin en Ventas. " +
          "Si se fue de la empresa, lo que corresponde es desactivarlo.",
      },
      { status: 403 }
    );
  }

  const { error } = await supabase.from("ventas_contactos").delete().eq("id", id);
  if (error) {
    return NextResponse.json(
      { error: `No se pudo borrar el contacto: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
