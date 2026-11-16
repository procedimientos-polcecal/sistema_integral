import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { noSePudoAveriguar, puedeEditarVentas } from "@/lib/ventas/auth";
import { esquemaDeContacto } from "@/lib/ventas/crm/cuerpos";
import { validar, errorDeValidacion } from "@/lib/core/validar";

/**
 * Cargar un contacto de un cliente.
 *
 * No hay GET: los contactos se leen con la ficha del cliente, que los trae en
 * la misma respuesta. Una ruta de listado aparte sería un segundo lugar que
 * decide qué contactos se ven y en qué orden.
 *
 * ── EL «PRINCIPAL» SE MUEVE, NO SE DUPLICA ──────────────────
 *
 * Marcar un contacto como principal **desmarca al que lo era**. Se hace acá y
 * no con un unique parcial en la tabla a propósito: el unique haría fallar el
 * alta con un 23505 que no le dice nada a quien está cargando, y obligaría a la
 * pantalla a desmarcar primero y marcar después —dos pedidos, y una ventana en
 * el medio donde el cliente no tiene ninguno—.
 *
 * Que dos queden marcados igual no corrompe nada: la pantalla muestra el
 * primero. Es un error de carga, no una inconsistencia.
 */

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const permiso = await puedeEditarVentas(supabase, user.id);
  if (!permiso.ok) return noSePudoAveriguar(permiso);
  if (!permiso.si) {
    return NextResponse.json({ error: "No tenés permiso para cargar contactos" }, { status: 403 });
  }

  const r = validar(esquemaDeContacto, await request.json().catch(() => null));
  if (!r.ok) return errorDeValidacion(r.problemas);
  const c = r.datos;

  if (c.es_principal) {
    const { error } = await supabase
      .from("ventas_contactos")
      .update({ es_principal: false })
      .eq("cliente_id", c.cliente_id)
      .eq("es_principal", true);
    // Un fallo acá se corta antes de insertar: seguir dejaría dos principales
    // sin que nadie se entere, que es justo lo que este paso evita.
    if (error) {
      return NextResponse.json(
        { error: `No se pudo mover el contacto principal: ${error.message}` },
        { status: 500 }
      );
    }
  }

  const { data, error } = await supabase
    .from("ventas_contactos")
    .insert({
      cliente_id: c.cliente_id,
      nombre: c.nombre,
      cargo: c.cargo ?? null,
      telefono: c.telefono ?? null,
      email: c.email || null,
      es_principal: c.es_principal ?? false,
      activo: c.activo ?? true,
      notas: c.notas ?? null,
      creado_por: user.id,
    })
    .select("id, nombre, cargo, telefono, email, es_principal, activo, notas")
    .single();

  if (error) {
    // 23503 es la foreign key: el cliente no existe, o RLS no deja verlo.
    if (error.code === "23503") {
      return NextResponse.json({ error: "No existe ese cliente" }, { status: 404 });
    }
    return NextResponse.json(
      { error: `No se pudo guardar el contacto: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ contacto: data }, { status: 201 });
}
