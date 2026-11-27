import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarCompras } from "@/lib/compras/auth";
import { listarComparativas, carpetaConfigurada } from "@/lib/compras/drive";
import { traerTodo } from "@/lib/core/paginado";
import { sugerirComparativa, type EnlacePasado } from "@/lib/compras/sugerirComparativa";

/**
 * Los archivos de la carpeta de comparativas, para elegir uno.
 *
 * Con `?requerimiento=<id>` devuelve además hasta tres **sugerencias** para
 * ese pedido. El porqué y lo que acierta cada señal están en
 * [lib/compras/sugerirComparativa.ts](../../../../lib/compras/sugerirComparativa.ts);
 * lo que importa saber acá es que la lista completa se devuelve igual, porque
 * la sugerencia acierta 76,4% a la primera y elegir sola la planilla
 * equivocada importa a este pedido los presupuestos de otro.
 *
 * Va en esta ruta y no en una propia para que la pantalla no haga dos viajes:
 * las sugerencias se calculan **sobre la carpeta que esta misma llamada acaba
 * de leer**, así que separarlas obligaría a listar Drive dos veces o a confiar
 * en que las dos respuestas vieron la misma carpeta.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenés permiso para gestionar la compra" }, { status: 403 });
  }

  // En local no hay credenciales de Google: mejor decirlo que devolver una
  // lista vacía, que parece una carpeta vacía.
  if (!carpetaConfigurada()) {
    return NextResponse.json({
      archivos: [],
      aviso: "La carpeta de comparativas no está configurada en este entorno.",
    });
  }

  let archivos;
  try {
    archivos = await listarComparativas();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }

  const requerimientoId = new URL(request.url).searchParams.get("requerimiento");
  if (!requerimientoId) return NextResponse.json({ archivos });

  /*
   * Las sugerencias nunca rompen la respuesta.
   *
   * Si fallan, la pantalla queda exactamente como estaba antes del 27/11/2026:
   * la carpeta entera para elegir a mano. Devolver un 500 por no poder
   * sugerir sería cambiar una ayuda por una pantalla que no se abre.
   */
  try {
    const admin = createAdminClient();

    const { data: pedido } = await admin
      .from("compras_requerimientos")
      .select("descripcion, clave_articulo")
      .eq("id", requerimientoId)
      .single();

    if (!pedido) return NextResponse.json({ archivos, sugerencias: [] });

    // Todos los enlaces que ya hizo una persona: esto **es** lo que el sistema
    // aprendió. Paginado porque son 1.717 y crecen con cada comparativa que
    // alguien elige — PostgREST corta en 1.000 sin avisar.
    const pasados = await traerTodo<{
      comparativa_drive_id: string;
      comparativa_nombre: string | null;
      clave_articulo: string | null;
      descripcion: string | null;
    }>((desde, hasta) =>
      admin
        .from("compras_requerimientos")
        .select("comparativa_drive_id, comparativa_nombre, clave_articulo, descripcion")
        .not("comparativa_drive_id", "is", null)
        .neq("id", requerimientoId)
        .range(desde, hasta)
    );

    const enlaces: EnlacePasado[] = pasados.map((p) => ({
      driveId: p.comparativa_drive_id,
      nombre: p.comparativa_nombre,
      claveArticulo: p.clave_articulo,
      descripcion: p.descripcion,
    }));

    const sugerencias = sugerirComparativa(
      { descripcion: pedido.descripcion, claveArticulo: pedido.clave_articulo },
      archivos.map((a: { id: string; nombre: string }) => ({ id: a.id, nombre: a.nombre })),
      enlaces
    );

    return NextResponse.json({ archivos, sugerencias });
  } catch (e) {
    console.error("No se pudieron armar las sugerencias de comparativa:", e);
    return NextResponse.json({ archivos, sugerencias: [] });
  }
}
