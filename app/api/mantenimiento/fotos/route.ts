import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";

export const maxDuration = 120;

/**
 * Guarda la foto de un trabajo.
 *
 * Va a Supabase Storage y no a Drive: una cuenta de servicio de Google **no
 * tiene cuota de Drive**, así que subir ahí falla aunque la carpeta esté
 * compartida como editor. Por eso la app vieja necesitaba un Apps Script
 * desplegado aparte, que corre con la cuota de una persona.
 *
 * El link que se devuelve sirve en el sistema siempre. Para que sirva también
 * en la planilla —que la mira gente sin sesión— el bucket tiene que ser
 * público; si no lo es, se dice y la foto queda sólo en el sistema.
 */

const BUCKET = "execution-photos";

/** Lo que una cámara de teléfono puede producir. Nada más. */
const TIPOS = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

/** Diez megas: una foto de teléfono anda por tres o cuatro. */
const MAXIMO = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Subir una foto requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const formulario = await request.formData();
  const archivo = formulario.get("file") as File | null;
  if (!archivo) return NextResponse.json({ error: "Falta la foto" }, { status: 400 });

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

  // La ruta lleva de qué OT es y cuándo: en el bucket van a convivir cientos, y
  // "imagen.jpg" no le dice nada a nadie dentro de seis meses.
  const ot = String(formulario.get("ot") ?? "").trim() || "sin-ot";
  const extension = archivo.name.split(".").pop()?.toLowerCase() || "jpg";
  const ruta = `ordenes/${ot}/${Date.now()}.${extension}`;

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

  // Si el bucket es público el link sirve para siempre y en cualquier lado —eso
  // es lo que se puede escribir en la planilla—. Si no, se firma uno que dura
  // un año, que al menos sirve mientras la orden esté fresca.
  const { data: publico } = admin.storage.from(BUCKET).getPublicUrl(ruta);
  const esPublico = await bucketEsPublico(admin);

  if (esPublico) {
    return NextResponse.json({ ruta, link: publico.publicUrl, publica: true });
  }

  const { data: firmado } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(ruta, 60 * 60 * 24 * 365);

  return NextResponse.json({
    ruta,
    link: firmado?.signedUrl ?? publico.publicUrl,
    publica: false,
    aviso:
      "El link vence en un año y no se puede abrir desde la planilla. " +
      `Para que sirva ahí, el bucket "${BUCKET}" tiene que ser público.`,
  });
}

/** Si el bucket deja ver sus archivos sin sesión. */
async function bucketEsPublico(admin: ReturnType<typeof createAdminClient>): Promise<boolean> {
  const { data } = await admin.storage.getBucket(BUCKET);
  return Boolean(data?.public);
}
