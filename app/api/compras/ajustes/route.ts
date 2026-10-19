import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { esAdminDelNucleo } from "@/lib/core/access";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { CuerpoDelUmbral } from "@/lib/compras/ajustes";

/**
 * Guardar el umbral de monto alto.
 *
 * Es de **administrador del sistema** y no de administrador del módulo, aunque
 * la pantalla viva en Compras: la policy de escritura de `compras_ajustes` usa
 * `es_admin()`, que desde el 10/09/2026 es sólo `admin_sistema`. Pedir menos
 * acá dejaría pasar a un admin de módulo que la base después rechaza *sin
 * error* —un UPDATE que RLS filtra afecta cero filas y no falla—, y la
 * pantalla diría "guardado" sin que nada haya cambiado.
 *
 * Por eso se escribe con el cliente de la sesión y no con el admin: la base es
 * la segunda llave, y si alguna vez las dos reglas se separan el que manda es
 * ella. Y se pide la fila de vuelta: si no vuelve ninguna, no se guardó.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario } = await supabase.from("usuarios").select("rol").eq("id", user.id).single();
  if (!esAdminDelNucleo(usuario?.rol)) {
    return NextResponse.json(
      { error: "Sólo un administrador del sistema puede cambiar el umbral de monto alto" },
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
