import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { BUCKET_DE_FOTOS } from "@/lib/seguridadHigiene/guardarLaFoto";

/**
 * Sacar una foto de una condición: la otra mitad de lo que la spec le da a
 * `edicion`, y la que hace que una foto equivocada —o repetida, que es lo que
 * deja un reintento del alta cuya respuesta se perdió— se pueda arreglar.
 *
 * ── EL ORDEN ES FILA PRIMERO Y ARCHIVO DESPUÉS, Y NO AL REVÉS ──────────────
 *
 * La fila de `syh_fotos` es la que manda: la ficha y el cron de respaldo leen
 * esa tabla, no el bucket. Borrando el archivo primero, un fallo al borrar la
 * fila dejaría una foto que la ficha muestra rota para siempre. En este orden,
 * un fallo al borrar el archivo deja un huérfano en el bucket que nadie ve y
 * que no se parece a una foto que sí está — y se dice igual.
 *
 * **No hay cliente admin acá**: borrar la fila lo autoriza `syh_fotos_sacar`
 * (es de `edicion`, y sólo mientras la condición no esté cerrada) y borrar el
 * archivo, la policy del bucket. Las dos comprueban lo mismo que comprobaría
 * esta ruta a mano, y ninguna de las dos corre con el admin.
 *
 * Cero filas borradas sin error es RLS: la condición se cerró, o no hay
 * permiso. Se contesta 403 y no 404, porque la foto puede existir
 * perfectamente.
 */

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!ES_UUID.test(id)) {
    return NextResponse.json({ error: "No existe esa foto" }, { status: 404 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  // `delete().select()` devuelve lo borrado, así que la ruta del archivo sale
  // del mismo pedido que la borró: leerla antes sería una lectura de más y
  // además dejaría abierta la ventana en la que otro la borra en el medio.
  const { data: borrada, error } = await supabase
    .from("syh_fotos")
    .delete()
    .eq("id", id)
    .select("ruta")
    .maybeSingle();

  if (error) {
    if (error.code === "42501") {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: `No se pudo sacar la foto: ${error.message}` },
      { status: 500 }
    );
  }
  if (!borrada) {
    return NextResponse.json(
      {
        error:
          "No se pudo sacar la foto: o ya no está, o la condición está cerrada y " +
          "sólo un admin puede tocarla.",
      },
      { status: 403 }
    );
  }

  const { error: errorDelArchivo } = await supabase.storage
    .from(BUCKET_DE_FOTOS)
    .remove([borrada.ruta]);

  // La foto ya no está en la condición, que es lo que pidió quien apretó el
  // botón: esto no es un error, pero tampoco se calla.
  return NextResponse.json({
    ok: true,
    aviso: errorDelArchivo
      ? `La foto se sacó de la condición, pero el archivo quedó en el bucket: ${errorDelArchivo.message}`
      : null,
  });
}
