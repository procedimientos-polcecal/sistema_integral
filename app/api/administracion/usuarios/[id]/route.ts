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
    if (!["admin_sistema", "admin", "encargado", "operario"].includes(body.rol)) {
      return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
    }
    data.rol = body.rol;
  }
  if (body.activo !== undefined) data.activo = body.activo;

  if (Object.keys(data).length > 0) {
    const { error } = await admin.from("usuarios").update(data).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: usuario } = await admin.from("usuarios").select("id, email, nombre, apellido, rol, activo").eq("id", id).single();
  return NextResponse.json(usuario);
}

// Tablas (y columna) que referencian usuarios.id sin cascade — bloquean el
// borrado si tienen alguna fila para este usuario (misma idea que el guard
// de borrado de empleados en app/api/rrhh/empleados/[id]/route.ts).
const TABLAS_CON_HISTORIAL: { tabla: string; columna: string }[] = [
  { tabla: "ausencias", columna: "cargado_por_id" },
  { tabla: "liquidaciones", columna: "generado_por_id" },
  { tabla: "calculos_diarios", columna: "validado_por_id" },
  { tabla: "rrhh_import_batches", columna: "usuario_id" },
  { tabla: "rrhh_import_staging", columna: "usuario_id" },
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
  const tieneHistorial = conteos.some((c) => (c.count ?? 0) > 0);
  if (tieneHistorial) {
    return NextResponse.json(
      { error: "No se puede eliminar: el usuario tiene registros históricos asociados. Desactivá la cuenta en su lugar." },
      { status: 409 }
    );
  }

  const { error } = await admin.from("usuarios").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.auth.admin.deleteUser(id);
  return new NextResponse(null, { status: 204 });
}
