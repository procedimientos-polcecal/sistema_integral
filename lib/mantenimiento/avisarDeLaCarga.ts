import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CABECERA_DEL_DISPARO } from "@/public/cola/colaOffline.js";
import { enviarCorreo, estaConfigurado } from "@/lib/core/correo";
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
 * fallar nada ni demorar nada**, que es lo que más caro sale olvidar.
 *
 * ## No espera, y por eso no devuelve nada
 *
 * El envío va en un `after()`: corre **después** de que la respuesta salió. Del
 * otro lado hay un Apps Script que arranca una máquina virtual por pedido y
 * puede tardar segundos, y de este lado hay un service worker esperando el
 * rechazo para seguir con la cola. Esperarlo le sumaría esos segundos a cada
 * carga rechazada, que es justo el momento en que menos conviene.
 *
 * Que el correo no salga tampoco cambia nada: la carga igual queda parada,
 * visible en `/cargar` y contada por la barra del layout. Por eso el `catch` se
 * traga todo — en el encabezado de `lib/core/correo.ts` está escrito por qué un
 * `console.error` alcanza en este caso y en qué se diferencia de un fallo de
 * escritura de los que este repo nunca deja en un log.
 *
 * ## Las cuatro razones por las que no manda nada, y son la mayoría de las veces
 *
 *   - La carga salió de la pantalla: la persona está leyendo el cartel.
 *   - El rechazo no es definitivo: se va a reintentar solo.
 *   - El correo no está configurado todavía.
 *   - Quien cargó no tiene correo en `usuarios`: no hay a quién mandarle.
 *
 * Las dos primeras se deciden sin tocar nada, y la tercera antes de buscar a
 * nadie: un cuerpo de los que manda la pantalla de siempre —sin la cabecera—
 * no genera ni una consulta de más.
 */
export function avisarDeLaCarga(
  request: Request,
  usuarioId: string,
  rechazo: Omit<RechazoDeCarga, "delFondo">,
): void {
  // La cabecera se lee acá y no adentro del `after`: `request` es de este
  // momento, y leerla después sería depender de que siga estando.
  const correo = correoPorElRechazo({
    ...rechazo,
    delFondo: salioDelFondo(request.headers.get(CABECERA_DEL_DISPARO)),
  });
  if (!correo) return;
  if (!estaConfigurado()) return;

  after(async () => {
    try {
      // Con el cliente admin, y creado **acá adentro**: la policy de `usuarios`
      // es `id = auth.uid() or es_admin()`, así que con el cliente de la sesión
      // la fila propia se leería igual —pero este código corre después de que
      // la respuesta salió, cuando esa sesión ya no está a mano—. Crearlo
      // dentro del `after` además lo mantiene fuera del camino de cualquier
      // pedido que no manda correo.
      const { data } = await createAdminClient()
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
  });
}
