import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puedeEditarSyh } from "@/lib/seguridadHigiene/auth";
import { problemaDeLaFoto } from "@/lib/seguridadHigiene/fotoDeCondicion";
import { guardarLaFoto } from "@/lib/seguridadHigiene/guardarLaFoto";

export const maxDuration = 120;

/**
 * Agregar una foto a una condición insegura que ya existe: es el camino de la
 * ficha. La foto que viaja con el alta desde la cola sin señal no pasa por acá
 * —va adentro del mismo pedido, en `/api/seguridad-higiene/condiciones`—, pero
 * **las dos guardan igual**: con `guardarLaFoto`, que sube el archivo y escribe
 * la fila de `syh_fotos` en una sola operación.
 *
 * ── QUÉ CAMBIÓ EL 30/10/2026, Y POR QUÉ IMPORTA ────────────────────────────
 *
 * Antes esta ruta subía el archivo al bucket y devolvía `{ruta, link}`, y ahí
 * terminaba: **nadie escribía en `syh_fotos`**. Una foto sin esa fila es un
 * archivo perdido — la ficha lee la tabla y no el bucket, así que no la
 * muestra, y el cron de respaldo también lee la tabla, así que no la respalda.
 * El enlace es de acá.
 *
 * Y con eso cambiaron dos cosas más, las dos a propósito:
 *
 *   * **`condicion` tiene que ser el id de una condición que exista.** Antes
 *     podía ser cualquier texto —la idea era que fuera la clave de la carga
 *     cuando la condición todavía no existía—, y ahora eso no tiene sentido:
 *     la fila necesita un `condicion_id` de verdad, y el camino de la cola lo
 *     resuelve el alta. Un id que no existe es un 400 y no un archivo huérfano.
 *   * **Se sube con el cliente del usuario y no con el admin.** El bucket
 *     tiene policies para `authenticated` (`20261029111056`) y la fila las
 *     necesita sí o sí (`syh_fotos_agregar` mira `auth.uid()`), así que el
 *     admin sólo serviría para saltearse las dos comprobaciones que queremos.
 *
 * El bucket es privado: el link es siempre firmado y dura una hora.
 *
 * Puede subir una foto quien puede cargar una condición (`edicion` o `admin`).
 * Se comprueba acá para contestar con un texto en castellano; la policy lo
 * vuelve a comprobar del otro lado.
 */

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario, error: errorDelUsuario } = await supabase
    .from("usuarios")
    .select("activo")
    .eq("id", user.id)
    .maybeSingle();
  if (errorDelUsuario) {
    return NextResponse.json(
      { error: `No se pudo comprobar tu usuario: ${errorDelUsuario.message}` },
      { status: 503 }
    );
  }
  if (!usuario?.activo) {
    return NextResponse.json({ error: "Tu usuario está desactivado" }, { status: 403 });
  }

  if (!(await puedeEditarSyh(supabase, user.id))) {
    return NextResponse.json(
      { error: "No tenés permiso para subir fotos de condiciones inseguras" },
      { status: 403 }
    );
  }

  const formulario = await request.formData().catch(() => null);
  const archivo = formulario?.get("file");
  if (!formulario || !archivo || typeof archivo === "string") {
    return NextResponse.json({ error: "Falta la foto" }, { status: 400 });
  }

  const condicionId = String(formulario.get("condicion") ?? "").trim();
  if (!ES_UUID.test(condicionId)) {
    return NextResponse.json(
      { error: "Falta decir a qué condición es esta foto" },
      { status: 400 }
    );
  }

  // Lo que está mal con la foto se dice antes de hablar con Storage, y con las
  // palabras que va a leer quien la sacó: «pesa 14 MB y el máximo son 10».
  const problema = problemaDeLaFoto(archivo);
  if (problema) return NextResponse.json({ error: problema }, { status: 400 });

  // Que la condición exista se comprueba acá y no se deja para el 23503 del
  // insert: ese fallo llegaría **después** de subir el archivo, o sea con un
  // huérfano ya en el bucket.
  const { data: condicion, error: errorDeCondicion } = await supabase
    .from("syh_condiciones")
    .select("id")
    .eq("id", condicionId)
    .maybeSingle();
  if (errorDeCondicion) {
    return NextResponse.json(
      { error: `No se pudo leer la condición: ${errorDeCondicion.message}` },
      { status: 500 }
    );
  }
  if (!condicion) {
    return NextResponse.json({ error: "No existe esa condición" }, { status: 404 });
  }

  const guardada = await guardarLaFoto(supabase, condicionId, user.id, archivo);
  if (!guardada.ok) {
    return NextResponse.json({ error: guardada.error }, { status: guardada.status });
  }

  return NextResponse.json({ ruta: guardada.ruta, link: guardada.link });
}
