import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { esAdminCompras } from "@/lib/compras/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { CuerpoDelUmbral } from "@/lib/compras/ajustes";

/**
 * Guardar el umbral de monto alto.
 *
 * Es de quien administra el módulo, la misma regla que la lista de aprobadores
 * (`/api/compras/aprobadores`) con la que comparte pantalla, y la misma que
 * tiene la policy de escritura de `compras_ajustes`.
 *
 * Se escribe con el cliente de la sesión y no con el admin: la base es la
 * segunda llave, y si alguna vez las dos reglas se separan el que manda es
 * ella. Un UPDATE que RLS filtra afecta cero filas y no falla, así que se pide
 * la fila de vuelta: si no vuelve ninguna, no se guardó.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await esAdminCompras(supabase, user.id))) {
    return NextResponse.json(
      { error: "Cambiar el umbral de monto alto requiere nivel de administrador del módulo" },
      { status: 403 }
    );
  }

  const validado = validar(CuerpoDelUmbral, await cuerpoJson(request));
  if (!validado.ok) return errorDeValidacion(validado.problemas);

  const { data, error } = await supabase
    .from("compras_ajustes")
    .update({
      umbral_monto_alto: validado.datos.umbral_monto_alto,
      actualizado_en: new Date().toISOString(),
    })
    // Es la única fila: el `check (id)` de la tabla no deja que haya otra.
    .eq("id", true)
    .select("umbral_monto_alto, actualizado_en")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: "La base no guardó el cambio: no se encontró la fila de ajustes o no hay permiso para escribirla." },
      { status: 403 }
    );
  }

  return NextResponse.json(data);
}
