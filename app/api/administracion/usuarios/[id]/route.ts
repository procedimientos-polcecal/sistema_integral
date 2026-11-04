import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { es_admin_check } from "@/lib/core/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const body = await cuerpoJson(request);
  const admin = createAdminClient();

  const data: Record<string, unknown> = {};
  if (body.nombre !== undefined) data.nombre = body.nombre;
  if (body.apellido !== undefined) data.apellido = body.apellido;
  if (body.rol !== undefined) {
    if (!["admin_sistema", "encargado", "operario"].includes(body.rol)) {
      return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
    }
    data.rol = body.rol;
  }
  if (body.activo !== undefined) data.activo = body.activo;
  // Permiso de gasto, no de datos: lo que ve el asistente sale de RLS igual que
  // en las pantallas. Ver `puedeUsarAsistente` en lib/core/access.ts.
  if (body.puede_usar_asistente !== undefined) {
    data.puede_usar_asistente = Boolean(body.puede_usar_asistente);
  }

  if (Object.keys(data).length > 0) {
    const { error } = await admin.from("usuarios").update(data).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: usuario } = await admin.from("usuarios").select("id, email, nombre, apellido, rol, activo, puede_usar_asistente").eq("id", id).single();
  return NextResponse.json(usuario);
}

// Tablas (y columna) donde una persona dejó rastro: bloquean el borrado si
// tienen alguna fila para este usuario (misma idea que el guard de borrado de
// empleados en app/api/rrhh/empleados/[id]/route.ts).
//
// Esta lista **no es «las que no tienen cascade»**, aunque casi todas sean eso:
// lo que decide si una tabla entra es si borrarla en silencio perdería algo que
// nadie más puede recuperar. `agenda_eventos.dueno_id` sí tiene cascade, y entra
// **justamente por eso**: la cascada se llevaría la fila con su `google_event_id`
// y el evento quedaría vivo en los calendarios de Google sin ninguna fila que lo
// nombre, así que nadie podría sacarlo nunca más desde el sistema. Con el freno
// el borrado da 409 y la salida es desactivar la cuenta.
//
// **Mientras la migración de la Agenda (`20261102102403_agenda_schema`) no esté
// aplicada, la última entrada es un no-op silencioso**: `agenda_eventos` no
// existe, la consulta falla, `count` llega en null y el `?? 0` lo cuenta como
// cero. Es una falla abierta, que es la dirección segura para un borrado (no
// inventa un bloqueo), pero en esa ventana el freno no existe y borrar a alguien
// no mira la agenda. Nada avisa: el error de esa consulta no se mira.
const TABLAS_CON_HISTORIAL: { tabla: string; columna: string; motivo?: string }[] = [
  { tabla: "ausencias", columna: "cargado_por_id" },
  { tabla: "liquidaciones", columna: "generado_por_id" },
  { tabla: "calculos_diarios", columna: "validado_por_id" },
  { tabla: "rrhh_import_batches", columna: "usuario_id" },
  { tabla: "rrhh_import_staging", columna: "usuario_id" },
  { tabla: "rrhh_dias_corregidos", columna: "usuario_id" },
  { tabla: "empresa_status_log", columna: "changed_by" },
  { tabla: "sectores_status_log", columna: "changed_by" },
  { tabla: "equipos_checklists", columna: "created_by" },
  { tabla: "equipos_status_log", columna: "changed_by" },
  { tabla: "mantenimientos_programados", columna: "created_by" },
  { tabla: "mantenimientos_programados", columna: "assigned_to" },
  { tabla: "mantenimientos_ejecuciones", columna: "assigned_to" },
  { tabla: "mantenimientos_ejecuciones", columna: "executed_by" },
  { tabla: "ordenes_trabajo", columna: "created_by" },
  { tabla: "planificacion_diaria", columna: "created_by" },
  { tabla: "planificacion_diaria_items", columna: "assigned_to" },
  {
    tabla: "agenda_eventos",
    columna: "dueno_id",
    // No es rastro histórico: un evento futuro sigue vivo en los calendarios de
    // los invitados. Quien administra va a buscar liquidaciones y órdenes, no
    // va a encontrar nada, y no sabría qué lo frena si el mensaje fuera genérico.
    motivo:
      "el usuario es dueño de eventos de la Agenda (calendario). Borrarlo dejaría esos eventos vivos en los calendarios de Google de los invitados, sin forma de sacarlos desde el sistema",
  },
];

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const admin = createAdminClient();

  const conteos = await Promise.all(
    TABLAS_CON_HISTORIAL.map(({ tabla, columna }) =>
      admin.from(tabla).select("id", { count: "exact", head: true }).eq(columna, id)
    )
  );
  // `conteos` está indexado en paralelo con `TABLAS_CON_HISTORIAL`: el primer
  // conteo con filas dice cuál tabla frenó el borrado.
  const bloqueo = conteos.findIndex((c) => (c.count ?? 0) > 0);
  if (bloqueo !== -1) {
    const { tabla, motivo } = TABLAS_CON_HISTORIAL[bloqueo];
    return NextResponse.json(
      {
        error: `No se puede eliminar: ${motivo ?? `el usuario tiene registros históricos asociados (en «${tabla}»)`}. Desactivá la cuenta en su lugar.`,
      },
      { status: 409 }
    );
  }

  const { error } = await admin.from("usuarios").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.auth.admin.deleteUser(id);
  return new NextResponse(null, { status: 204 });
}
