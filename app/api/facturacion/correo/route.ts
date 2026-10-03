import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarFacturacion, tieneAccesoFacturacion } from "@/lib/facturacion/auth";

/**
 * La bandeja del correo: lo que llegó por mail y espera que alguien lo cargue.
 *
 * - `GET`   → los pendientes, con un link firmado para bajar cada archivo.
 * - `PATCH` → marcar uno como cargado (con su factura) o descartarlo.
 *
 * El link va **firmado y corto**: el bucket es privado, y el navegador necesita
 * el archivo para leerle el QR — que es donde sigue corriendo el lector, igual
 * que cuando alguien arrastra el PDF a mano.
 */

const BUCKET = "facturas-proveedor";
/** Cinco minutos: lo que tarda alguien en abrir el buzón y apretar. */
const VIGENCIA = 300;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await tieneAccesoFacturacion(supabase, user.id))) {
    return NextResponse.json({ error: "No tenés acceso a Facturación" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("facturacion_correo")
    .select("id, mensaje_id, adjunto, remitente, asunto, recibido_en, archivo_url, tamano_bytes, tipo, sin_confirmar")
    .eq("estado", "pendiente")
    .order("recibido_en", { ascending: false, nullsFirst: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  /*
   * Los links se firman de a uno porque `createSignedUrls` devuelve los
   * errores mezclados con los aciertos y acá conviene que un archivo que no
   * está no se lleve puesta la lista entera: esa fila se muestra sin link y se
   * puede descartar.
   */
  const pendientes = await Promise.all(
    (data ?? []).map(async (f) => {
      const { data: firmado } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(f.archivo_url as string, VIGENCIA);
      return { ...f, url: firmado?.signedUrl ?? null };
    })
  );

  return NextResponse.json({ pendientes });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarFacturacion(supabase, user.id))) {
    return NextResponse.json({ error: "No podés editar Facturación" }, { status: 403 });
  }

  const cuerpo = await cuerpoJson<{
    id?: string;
    estado?: string;
    factura_id?: string | null;
    motivo?: string | null;
  }>(request);

  if (!cuerpo?.id) return NextResponse.json({ error: "Falta el id." }, { status: 400 });

  if (cuerpo.estado !== "cargada" && cuerpo.estado !== "descartada") {
    return NextResponse.json(
      { error: "El estado sólo puede pasar a cargada o descartada." },
      { status: 400 }
    );
  }

  /*
   * Descartar deja quién y cuándo, no sólo el estado. Es lo que permite
   * preguntar después por qué una factura que el proveedor dice haber mandado
   * no está cargada — y la respuesta "alguien la descartó el martes" es muy
   * distinta de "nunca llegó".
   */
  const cambios =
    cuerpo.estado === "descartada"
      ? {
          estado: "descartada",
          descartado_por: user.id,
          descartado_en: new Date().toISOString(),
          motivo: cuerpo.motivo ?? null,
        }
      : { estado: "cargada", factura_id: cuerpo.factura_id ?? null };

  const { data, error } = await createAdminClient()
    .from("facturacion_correo")
    .update(cambios)
    .eq("id", cuerpo.id)
    .select("id, estado")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "No existe esa entrada." }, { status: 404 });

  return NextResponse.json(data);
}
