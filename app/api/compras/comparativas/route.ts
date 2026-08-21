import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puedeEditarCompras } from "@/lib/compras/auth";
import { listarComparativas, carpetaConfigurada } from "@/lib/compras/drive";

/** Los archivos de la carpeta de comparativas, para elegir uno. */
export async function GET() {
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

  try {
    return NextResponse.json({ archivos: await listarComparativas() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
