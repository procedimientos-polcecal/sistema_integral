import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

/**
 * Guarda la foto de un trabajo.
 *
 * Va a Supabase Storage y no a Drive: una cuenta de servicio de Google **no
 * tiene cuota de Drive**, así que subir ahí falla aunque la carpeta esté
 * compartida como editor. Por eso la app vieja necesitaba un Apps Script
 * desplegado aparte, que corre con la cuota de una persona.
 *
 * La puede subir cualquier usuario activo, tenga o no el módulo Mantenimiento:
 * quien ve que una máquina anda mal trabaja en Producción, en Cantera o en el
 * laboratorio, y la foto del aviso es parte de avisar. Es el mismo criterio
 * que el alta de un requerimiento en Compras. El módulo sigue decidiendo qué
 * se ve, no quién puede mandar una foto.
 *
 * El link que se devuelve sirve en el sistema siempre. Para que sirva también
 * en la planilla —que la mira gente sin sesión— el bucket tiene que ser
 * público; si no lo es, se dice y la foto queda sólo en el sistema.
 */

const BUCKET = "execution-photos";

/**
 * Lo que una cámara de teléfono puede producir. Nada más.
 *
 * Tiene que coincidir con `allowed_mime_types` del bucket (migración 006): esa
 * lista no tiene `image/heif`, y cuando esta sí lo tenía una foto HEIF pasaba
 * el chequeo de acá y la rechazaba Storage con un 502 que no explicaba nada. Se
 * sacó de acá y no se agregó al bucket porque lo primero no necesita a una
 * persona corriendo SQL. Si se suma un tipo, va en los dos lados.
 */
const TIPOS = ["image/jpeg", "image/png", "image/webp", "image/heic"];

/** Diez megas: una foto de teléfono anda por tres o cuatro. */
const MAXIMO = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  // Mismo chequeo que el alta de un requerimiento de Compras: alcanza con ser
  // un usuario activo. El 401 de arriba sigue siendo el de la falta de sesión.
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("activo")
    .eq("id", user.id)
    .single();
  if (!usuario?.activo) {
    return NextResponse.json({ error: "Tu usuario está desactivado" }, { status: 403 });
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

  // La ruta lleva de qué es la foto y cuándo: en el bucket van a convivir
  // cientos, y "imagen.jpg" no le dice nada a nadie dentro de seis meses.
  //
  // Una foto de aviso va a `avisos/<oa>/` y no a `ordenes/sin-ot/`: un aviso no
  // es una orden, y dentro de seis meses "sin-ot" no le diría nada a nadie.
  // El nombre del aviso se limpia porque esta ruta ya no la usa sólo gente de
  // Mantenimiento, y lo que llega acá termina siendo parte de una ruta del
  // bucket. Si vienen los dos campos gana `aviso`.
  const aviso = String(formulario.get("aviso") ?? "").trim().replace(/[^A-Za-z0-9_-]/g, "-");
  const ot = String(formulario.get("ot") ?? "").trim() || "sin-ot";
  const extension = archivo.name.split(".").pop()?.toLowerCase() || "jpg";
  const ruta = aviso
    ? `avisos/${aviso}/${Date.now()}.${extension}`
    : `ordenes/${ot}/${Date.now()}.${extension}`;

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
