import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { idDeDrive, traerFotoDeDrive, esProblema } from "@/lib/mantenimiento/fotoDeDrive";
import { urlsDeLasFotos } from "@/lib/mantenimiento/fotoDelAviso";

/**
 * La foto de un aviso que vive en Drive, servida desde el SdG.
 *
 * La foto que deja el formulario de Google queda en una carpeta privada, así
 * que su link no se puede dibujar en un `<img>`: hasta el 19/11/2026 la
 * pantalla mostraba un enlace y la abría sólo el dueño de la carpeta. Ese día
 * se compartió la carpeta con la cuenta de servicio, y esta ruta es la que
 * convierte eso en una foto que ve cualquiera que tenga sesión.
 *
 * ── POR QUÉ RECIBE EL AVISO Y NO EL ARCHIVO ───────────────────────────────
 *
 * Porque del otro lado hay una credencial que ve **todas** las planillas y
 * carpetas del grupo. Si el parámetro fuera el id de Drive, cualquiera con
 * sesión se bajaría la contabilidad pidiéndola por id. Lo que entra es el id
 * del **aviso** y la posición en su `reference_photos`: el id de Drive lo pone
 * la fila, nunca quien llama.
 *
 * ── QUIÉN PUEDE VERLA ─────────────────────────────────────────────────────
 *
 * El aviso se lee **con la sesión de quien pide** y no con el cliente admin, a
 * propósito: así el permiso lo pone la policy `avisos_read` y no una copia de
 * ella escrita acá, que es lo que después se desincroniza. Hoy esa policy es
 * `to authenticated using (true)` —cualquiera con sesión ve cualquier aviso—,
 * que es el mismo criterio que `POST /api/mantenimiento/fotos`: quien ve que
 * una máquina anda mal trabaja en Producción, en Cantera o en el laboratorio.
 * Si algún día la policy se cierra, esta ruta se cierra con ella sola.
 */

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("activo")
    .eq("id", user.id)
    .single();
  if (!usuario?.activo) {
    return NextResponse.json({ error: "Tu usuario está desactivado" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const aviso = (params.get("aviso") ?? "").trim();
  if (!aviso) return NextResponse.json({ error: "Falta de qué aviso es" }, { status: 400 });

  const n = Number(params.get("n") ?? "0");
  if (!Number.isInteger(n) || n < 0) {
    return NextResponse.json({ error: "La posición de la foto no es un número" }, { status: 400 });
  }

  const { data: fila } = await supabase
    .from("avisos")
    .select("reference_photos")
    .eq("id", aviso)
    .maybeSingle();
  // Sin fila puede ser que el aviso no exista o que esta persona no pueda
  // verlo. Se contesta lo mismo en los dos casos: distinguirlos le diría a
  // cualquiera qué ids de aviso existen.
  if (!fila) return NextResponse.json({ error: "No se encontró esa foto" }, { status: 404 });

  // La MISMA lista que arma la pantalla, y por eso `urlsDeLasFotos` y no un
  // índice crudo: una celda del formulario puede traer varias fotos, y si
  // cada punta contara a su manera la ruta serviría otra foto sin fallar.
  const id = idDeDrive(urlsDeLasFotos(fila.reference_photos)[n]);
  if (!id) {
    return NextResponse.json(
      { error: "Esa foto no está en Drive; se abre con su propio link" },
      { status: 404 }
    );
  }

  const traida = await traerFotoDeDrive(id);
  if (esProblema(traida)) {
    return NextResponse.json({ error: traida.error }, { status: traida.codigo });
  }

  return new NextResponse(traida.bytes, {
    headers: {
      "Content-Type": traida.tipo,
      // Privada porque detrás de esto hay una sesión: no la puede guardar un
      // proxy compartido. Una hora alcanza para mirar la lista varias veces y
      // es poco como para que una foto corregida en la planilla quede vieja.
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(traida.nombre)}`,
    },
  });
}
