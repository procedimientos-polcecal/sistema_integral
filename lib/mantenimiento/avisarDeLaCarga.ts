import type { SupabaseClient } from "@supabase/supabase-js";
import { CABECERA_DEL_DISPARO } from "@/public/cola/colaOffline.js";
import { enviarCorreo } from "@/lib/core/correo";
import { correoPorElRechazo, salioDelFondo, type RechazoDeCarga } from "./correoDeLaCarga";

/**
 * Avisarle por correo a quien cargó algo en la planta que no entró.
 *
 * ## Por qué vive acá y no adentro de cada ruta
 *
 * Son dos rutas con el mismo gesto en cuatro o cinco puntos de rechazo cada
 * una. Copiarlo es cómo una decisión termina estando en una sola de las dos: en
 * la fase anterior pasó exactamente eso con el registro de la clave, y la
 * salida fue ésta. Acá vive, además, la regla de que esto **no puede hacer
 * fallar nada**, que es lo que más caro sale olvidar.
 *
 * ## No lanza nunca, y no devuelve nada
 *
 * Quien la llama está por devolverle a alguien el rechazo de su carga. Esa
 * respuesta es sobre la carga, no sobre el correo: si el correo no sale, la
 * carga igual queda parada, visible en `/cargar` y contada por la barra del
 * layout. Por eso no hay nada que reportar hacia arriba y por eso el `catch`
 * se traga todo — ver el encabezado de `lib/core/correo.ts`, donde está
 * escrito por qué un `console.error` alcanza en este caso.
 *
 * ## Las tres razones por las que no manda nada, y son la mayoría de las veces
 *
 *   - La carga salió de la pantalla: la persona está leyendo el cartel.
 *   - El rechazo no es definitivo: se va a reintentar solo.
 *   - Quien cargó no tiene correo en `usuarios`: no hay a quién mandarle.
 */
export async function avisarDeLaCarga(
  admin: SupabaseClient,
  request: Request,
  usuarioId: string,
  rechazo: Omit<RechazoDeCarga, "delFondo">,
): Promise<void> {
  try {
    const correo = correoPorElRechazo({
      ...rechazo,
      delFondo: salioDelFondo(request.headers.get(CABECERA_DEL_DISPARO)),
    });
    if (!correo) return;

    // Con el cliente admin porque `usuarios` sólo deja leer la fila propia
    // salvo que uno sea admin —la policy es `id = auth.uid() or es_admin()`—,
    // y acá justamente es la propia. Es el mismo motivo por el que la ruta de
    // OT ya lo hace así para la planilla.
    const { data } = await admin
      .from("usuarios")
      .select("email")
      .eq("id", usuarioId)
      .maybeSingle();

    const para = typeof data?.email === "string" ? data.email.trim() : "";
    if (!para) return;

    await enviarCorreo({ para, asunto: correo.asunto, cuerpo: correo.cuerpo });
  } catch (e) {
    console.error("correo de la carga: no se pudo avisar", (e as Error)?.message ?? e);
  }
}
