import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarInventario } from "@/lib/inventario/auth";
import { reconciliarSolicitantes } from "@/lib/inventario/catalogos";

/**
 * Agregar a alguien a la lista del pañol, o un destino nuevo.
 *
 * Pide nivel de **edición** y no admin, al revés que el ABM de artículos. Quien
 * nota que falta un nombre es quien está cargando el movimiento y no lo puede
 * terminar, y hacerlo esperar a un admin termina en que carga con otro nombre
 * parecido — que es justo lo que este catálogo viene a evitar.
 *
 * El nombre va **tal cual lo acepta la validación de la planilla**, porque es lo
 * que la app va a escribir en las columnas F y J. No se lo normaliza ni se le
 * arreglan los espacios: si allá dice "STRUPP , Bernardo Miguel", acá también.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarInventario(supabase, user.id))) {
    return NextResponse.json(
      { error: "Editar la lista requiere nivel de edición en Inventario" },
      { status: 403 }
    );
  }

  const b = await request.json().catch(() => null);
  const que = String(b?.que ?? "");
  const nombre = String(b?.nombre ?? "").trim();

  if (que !== "solicitante" && que !== "destino") {
    return NextResponse.json({ error: "Qué se agrega: solicitante o destino" }, { status: 400 });
  }
  if (!nombre) return NextResponse.json({ error: "Falta el nombre" }, { status: 400 });

  const admin = createAdminClient();
  const tabla = que === "destino" ? "inventario_destinos" : "inventario_solicitantes";

  const fila: Record<string, unknown> = { nombre };
  if (que === "destino") {
    fila.sector_id = String(b?.sector_id ?? "").trim() || null;
  } else {
    fila.destino_id = String(b?.destino_id ?? "").trim() || null;
  }

  const { data, error } = await admin.from(tabla).insert(fila).select().single();

  if (error) {
    // El nombre es único: repetirlo no es un error del sistema, es que ya está.
    const ya = error.code === "23505";
    return NextResponse.json(
      { error: ya ? `"${nombre}" ya está en la lista` : error.message },
      { status: ya ? 409 : 500 }
    );
  }

  // Un nombre recién agregado se engancha al padrón en el momento: esperar a la
  // próxima sincronización dejaría su primer movimiento sin legajo.
  if (que === "solicitante") await reconciliarSolicitantes(admin);

  return NextResponse.json({ data });
}
