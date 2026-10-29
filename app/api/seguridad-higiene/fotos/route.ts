import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarSyh } from "@/lib/seguridadHigiene/auth";

export const maxDuration = 120;

/**
 * Guarda la foto de una condición insegura en Supabase Storage.
 *
 * Calcada de `app/api/mantenimiento/fotos/route.ts`, con tres diferencias que
 * son decisiones y no descuidos:
 *
 *   1. BUCKET `syh-fotos`, no `execution-photos`: ése es de Mantenimiento y
 *      tiene sus propias reglas y su propia lista de tipos.
 *
 *   2. EL BUCKET ES PRIVADO, así que el link es **siempre firmado** y nunca
 *      `getPublicUrl`. Mantenimiento lo necesita público porque su link se
 *      escribe en una planilla que mira gente sin sesión. Este módulo no tiene
 *      planilla, y no hay nadie sin sesión que deba ver una foto de una
 *      condición insegura. El link dura una hora: alcanza para mostrar la foto
 *      que se acaba de subir, y quien la vea después pide uno nuevo.
 *
 *   3. LA RUTA DENTRO DEL BUCKET es `condiciones/<id>/<timestamp>.<ext>`, donde
 *      `<id>` es lo que mande el formulario en `condicion` (el id de la
 *      condición, o la clave de la carga si todavía no existe). Se limpia igual
 *      que allá: lo que llega del formulario termina siendo una ruta.
 *
 * Esta ruta sólo guarda el archivo. Devuelve la `ruta` y quien la usa se
 * ocupa de enlazarla a la condición en `syh_fotos`.
 *
 * Puede subir una foto quien puede cargar una condición (`edicion` o `admin`).
 * Se comprueba acá porque el cliente admin de Storage no pasa por las policies
 * del bucket.
 */

const BUCKET = "syh-fotos";

/**
 * Lo que una cámara de teléfono puede producir. Nada más.
 *
 * **Tiene que decir lo mismo que `allowed_mime_types` del bucket**
 * (`20261029111056_syh_bucket_de_fotos.sql`). `image/heif` no va: cuando la ruta
 * de Mantenimiento lo aceptaba y el bucket no, una foto HEIF pasaba el chequeo
 * de la ruta y la rechazaba Storage con un 502 que no explicaba nada. Si se suma
 * un tipo, va en los dos lados.
 */
const TIPOS = ["image/jpeg", "image/png", "image/webp", "image/heic"];

/** Diez megas, que es también el `file_size_limit` del bucket. */
const MAXIMO = 10 * 1024 * 1024;

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

  if (!TIPOS.includes(archivo.type)) {
    return NextResponse.json(
      { error: `"${archivo.type || "el archivo"}" no es una foto.` },
      { status: 400 }
    );
  }
  if (archivo.size > MAXIMO) {
    return NextResponse.json(
      { error: `La foto pesa ${Math.round(archivo.size / 1024 / 1024)} MB y el máximo son 10.` },
      { status: 400 }
    );
  }

  // Lo que llega en `condicion` y en el nombre del archivo termina siendo parte
  // de una ruta del bucket, así que se limpian: un archivo llamado `a./../x`
  // daría extensión `/x`.
  const limpio = (texto: string) => texto.trim().replace(/[^A-Za-z0-9_-]/g, "-");
  const condicion = limpio(String(formulario.get("condicion") ?? "")) || "sin-condicion";
  const extensionCruda = archivo.name.includes(".")
    ? (archivo.name.split(".").pop()?.toLowerCase() ?? "")
    : "";
  const extension = /^[a-z0-9]{1,5}$/.test(extensionCruda) ? extensionCruda : "jpg";
  const ruta = `condiciones/${condicion}/${Date.now()}.${extension}`;

  const admin = createAdminClient();

  const { error } = await admin.storage
    .from(BUCKET)
    .upload(ruta, new Uint8Array(await archivo.arrayBuffer()), {
      contentType: archivo.type,
      upsert: false,
    });

  if (error) {
    return NextResponse.json(
      { error: `No se pudo guardar la foto: ${error.message}` },
      { status: 502 }
    );
  }

  // Siempre firmado, nunca `getPublicUrl`: el bucket es privado. Si firmar
  // falla la foto **ya está guardada**, así que no se contesta un error —quien
  // llama reintentaría y quedarían dos—: se devuelve la ruta y sin link.
  const { data: firmado } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(ruta, 60 * 60);

  return NextResponse.json({ ruta, link: firmado?.signedUrl ?? null });
}
