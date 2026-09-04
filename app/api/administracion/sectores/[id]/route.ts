import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { es_admin_check } from "@/lib/core/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { loMantieneLaImportacion, yaExisteElNombre, type SectorAdmin } from "@/lib/core/sectores";

/**
 * Renombrar un sector, o darlo de baja.
 *
 * Dos cosas que no deja hacer, y por qué:
 *
 * **Renombrar uno de planta.** Los crea y los actualiza por código la
 * importación del libro BD Equipos, que en cada corrida pisa nombre, empresa y
 * transversal. Aceptar el cambio acá lo mostraría guardado y la próxima
 * importación lo revertiría sin decir nada: peor que no dejar, porque nadie
 * vuelve a mirar.
 *
 * **Ponerle el nombre de otro.** Es como se ensució el catálogo: "Administración"
 * llegó a existir tres veces, y las búsquedas por nombre —el espejo de
 * Inventario, la importación de RRHH— se quedan con una sola de las dos sin
 * avisar del empate. La base compara el texto tal cual y por empresa; acá se
 * compara sin tildes ni mayúsculas y contra todos, incluidos los dados de baja.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const body = await cuerpoJson(request);
  const data: Record<string, unknown> = {};
  if (body.nombre !== undefined) data.nombre = String(body.nombre).trim();
  if (body.activo !== undefined) data.activo = body.activo;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });
  }

  const { data: todos } = await supabase
    .from("sectores")
    .select("id, nombre, activo, transversal, es_de_planta, codigo, empresa_id, empresas(nombre)");
  const sectores = (todos ?? []) as unknown as SectorAdmin[];
  const actual = sectores.find((s) => s.id === id);
  if (!actual) {
    return NextResponse.json({ error: "No existe ese sector" }, { status: 404 });
  }

  if (data.nombre !== undefined) {
    if (!data.nombre) {
      return NextResponse.json({ error: "El nombre no puede quedar vacío" }, { status: 400 });
    }
    if (loMantieneLaImportacion(actual)) {
      return NextResponse.json(
        {
          error:
            `"${actual.nombre}" es un sector de planta: lo mantiene la importación del ` +
            `libro BD Equipos por su código (${actual.codigo ?? "sin código"}), y cualquier ` +
            `cambio de acá se pierde en la próxima corrida. Se arregla en el libro.`,
        },
        { status: 409 }
      );
    }
    const choca = yaExisteElNombre(sectores, String(data.nombre), id);
    if (choca) {
      return NextResponse.json(
        {
          error:
            `Ya existe "${choca.nombre}"` +
            (choca.activo ? "." : ", dado de baja. Reactivalo en vez de duplicar el nombre."),
        },
        { status: 409 }
      );
    }
  }

  const { data: sector, error } = await supabase
    .from("sectores").update(data).eq("id", id).select().single();
  if (error) {
    const msg = error.code === "23505" ? "Ya existe un sector con ese nombre" : error.message;
    return NextResponse.json({ error: msg }, { status: error.code === "23505" ? 409 : 500 });
  }
  return NextResponse.json(sector);
}
