import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puedeEditarSyh } from "@/lib/seguridadHigiene/auth";
import { traerTodo } from "@/lib/core/paginado";

/**
 * El glosario de peligros, para el desplegable del formulario de carga.
 *
 * **Exige poder cargar (`edicion` o más), y el 403 es parte del contrato.**
 * `/cargar` vive fuera del grupo `(app)` y no puede preguntar permisos: la
 * pantalla llama a esta ruta para saber si al teléfono hay que mostrarle la
 * tarjeta de condición, y un 403 **es** la respuesta de «esta persona no puede
 * cargar». Por eso no hace falta un endpoint de permisos aparte, y por eso
 * devuelve `puedeCargar: true` junto a la lista: lo que el teléfono guarda es
 * esa respuesta entera.
 *
 * Sólo los peligros activos, que son los que se pueden elegir.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarSyh(supabase, user.id))) {
    return NextResponse.json(
      { error: "No tenés permiso para cargar condiciones inseguras" },
      { status: 403 }
    );
  }

  try {
    const peligros = await traerTodo((desde, hasta) =>
      supabase
        .from("syh_peligros")
        .select("id, nombre")
        .eq("activo", true)
        .order("nombre")
        .range(desde, hasta)
    );
    return NextResponse.json({ data: peligros, puedeCargar: true });
  } catch (e) {
    return NextResponse.json(
      { error: `No se pudo leer el glosario: ${e instanceof Error ? e.message : e}` },
      { status: 500 }
    );
  }
}
