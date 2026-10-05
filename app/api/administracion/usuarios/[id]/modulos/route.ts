import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { es_admin_check } from "@/lib/core/route-utils";
import { MODULOS_ORDEN } from "@/lib/core/access";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { auditar, nombreParaAuditoria } from "@/lib/core/auditoria";

// Misma fuente que la navegación y el panel: una lista propia acá ya dejó
// afuera a Compras una vez.
const MODULOS: readonly string[] = MODULOS_ORDEN;
const NIVELES = ["lectura", "edicion", "admin"] as const;

/**
 * Reemplaza el set completo de grants (usuario_modulos) de un usuario.
 * Body: { grants: { modulo: "rrhh"|"remises"|"mantenimiento", nivel: "lectura"|"edicion"|"admin" }[] }
 * (un módulo ausente del array = sin acceso a ese módulo)
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const body = await cuerpoJson(request);
  const grants = Array.isArray(body.grants) ? body.grants : [];
  for (const g of grants) {
    if (!MODULOS.includes(g.modulo) || !NIVELES.includes(g.nivel)) {
      return NextResponse.json({ error: "Grant inválido" }, { status: 400 });
    }
  }

  const admin = createAdminClient();

  // Lo que había antes, para poder decir qué cambió. `usuario_modulos` no tiene
  // historial propio —son 72 filas con `usuario_id, modulo, nivel` y ni una
  // columna de cuándo ni de quién— así que sin leerlo acá el antes se pierde.
  const { data: antes } = await admin
    .from("usuario_modulos")
    .select("modulo, nivel")
    .eq("usuario_id", id);

  const { error: errorDelete } = await admin.from("usuario_modulos").delete().eq("usuario_id", id);
  if (errorDelete) return NextResponse.json({ error: errorDelete.message }, { status: 500 });

  if (grants.length > 0) {
    const { error: errorInsert } = await admin
      .from("usuario_modulos")
      .insert(grants.map((g: { modulo: string; nivel: string }) => ({ usuario_id: id, modulo: g.modulo, nivel: g.nivel })));
    if (errorInsert) return NextResponse.json({ error: errorInsert.message }, { status: 500 });
  }

  /*
   * Quién le dio acceso a quién, que hasta el 05/10/2026 no quedaba en ningún
   * lado. Esta ruta reemplaza el set completo, así que la acción se decide por
   * si el usuario termina con más o con menos de lo que tenía: `conceder_acceso`
   * cuando gana algo, `quitar_acceso` cuando sólo pierde.
   *
   * El antes y el después van como texto ordenado para que la diferencia se lea
   * de un vistazo en una consulta SQL, que es como se consulta esto por ahora.
   */
  const comoTexto = (gs: { modulo: string; nivel: string }[]) =>
    gs.map((g) => `${g.modulo}:${g.nivel}`).sort().join(", ") || "(ninguno)";

  const textoAntes = comoTexto((antes ?? []) as { modulo: string; nivel: string }[]);
  const textoDespues = comoTexto(grants as { modulo: string; nivel: string }[]);

  const { data: { user } } = await supabase.auth.getUser();
  const { data: quien } = user
    ? await supabase.from("usuarios").select("nombre, apellido, email").eq("id", user.id).maybeSingle()
    : { data: null };

  const registro = await auditar(supabase, {
    modulo: "administracion",
    entidad: "usuario_modulos",
    entidadId: id,
    accion: (grants.length >= (antes ?? []).length) ? "conceder_acceso" : "quitar_acceso",
    usuario: user ? { id: user.id, nombre: nombreParaAuditoria(quien) } : null,
    valorAnterior: textoAntes,
    valorNuevo: textoDespues,
  });

  return NextResponse.json({ ok: true, auditoria_error: registro.ok ? null : registro.error });
}
