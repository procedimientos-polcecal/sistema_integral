import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarPush, type Aviso, type SuscripcionPush } from "@/lib/core/webpush";
import {
  aparatosAAvisar,
  esHoraDeAvisar,
  type ResultadoDelAviso,
} from "@/lib/core/avisoAlInstante";
import { traerTodo } from "@/lib/core/paginado";

/** Una fila de `push_suscripciones`: lo que `enviarPush` necesita, y de quién es. */
type AparatoSuscripto = SuscripcionPush & { usuario_id: string };

/**
 * Un push a **una** persona, en el momento en que pasa algo que la toca a ella.
 *
 * Nació para una sola cosa: Compras contesta la pregunta que Mantenimiento hizo
 * por un repuesto, y a quien preguntó le llega el aviso
 * (`docs/superpowers/specs/2026-10-26-mantenimiento-preguntar-a-compras-design.md`).
 * Es el cuarto camino del repo que termina en `enviarPush` —los otros tres, por
 * `grep` del 30/10/2026, son el resumen diario, el aviso al instante y el de
 * Remises— y se parece a los tres sin poder ser ninguno.
 *
 * ── POR QUÉ NO ES `avisarAQuienDecide` ───────────────────────────────────────
 *
 * Esa función sirve a lo que pasa las **tres** condiciones que deja escritas el
 * encabezado de `avisoAlInstante.ts`, y una respuesta no pasa la segunda: nada
 * queda esperando que decida quien preguntó. Además está armada para otra forma
 * del problema —una **lista** de personas que deciden (`ListaDeAprobadores`) y
 * una corrida que junta varios ítems en una sola notificación—, y acá hay un
 * destinatario con nombre y un solo hecho.
 *
 * ── POR QUÉ NO VA AL RESUMEN DE LAS 8:30 ─────────────────────────────────────
 *
 * El resumen cuenta cosas **globales**. Lo dice el spec del 18/10
 * (`2026-10-18-a-quien-le-avisa-el-sdg-design.md`): «lo único que cambia por
 * persona es qué módulos ve». Por eso su foto, `avisos_fotos`, tiene por clave
 * `(fecha, notificacion_id)` —ninguna persona— y la migración `20261018184344`
 * lo deja dicho a propósito: «la foto no es de nadie».
 *
 * «Mi pregunta fue respondida y no la leí» no es global: su conteo depende de
 * quién lo mira. Habría sido el primer aviso así, con su tabla y su marca de
 * leído, y habría roto el modelo de ese mismo spec: el push dice lo que **se
 * movió** y la campana lo que hay, las dos sobre conteos que no son de nadie.
 *
 * ── ES UN EVENTO, NO UN CONTEO ───────────────────────────────────────────────
 *
 * De ahí sale que no haga falta nada de eso: se manda **una vez**, a una
 * persona, en el momento en que contesta. Esta función no recuerda qué avisó ni
 * si se leyó; que sea una vez por respuesta lo garantiza quien llama, que es la
 * ruta que guarda la respuesta.
 *
 * Lo que eso cuesta, dicho:
 *
 *   - **Fuera de 7:00–21:00 no se manda ni se guarda para después.** En
 *     `avisarAQuienDecide` eso no pierde nada, porque el resumen de las 8:30
 *     cuenta lo pendiente sin mirar cuándo entró. Acá nada cuenta una respuesta
 *     sin leer —es justo el conteo por persona que se evitó—, así que **una
 *     respuesta de las 22:00 no avisa nunca**. Quien preguntó la ve cuando abre
 *     la orden, que es donde está.
 *   - Si el envío falla no se reintenta: la respuesta ya está guardada, y el
 *     valor de este push es ser inmediato.
 *
 * ── CÓMO SE USA ──────────────────────────────────────────────────────────────
 *
 * `usuarioId` es quien preguntó, y lo decide quien llama porque es el único que
 * sabe dos cosas que esta función no puede saber:
 *
 *   - **Quién contestó.** A quien contesta no se lo excluye: el `excepto` de
 *     `aparatosAAvisar` va en `null` a propósito. Si la respuesta la escribe la
 *     misma persona que preguntó —alguien con acceso a las dos puntas—, avisarle
 *     de lo que acaba de hacer es la notificación que enseña a ignorar las
 *     demás, y quien llama no tiene que llamar.
 *   - **Si hay a quién.** `ordenes_trabajo_notas.creado_por` admite null (la
 *     columna no es `not null`), y una pregunta sin autor no tiene destinatario.
 *     Por eso `usuarioId` es `string` y no `string | null`: que no haya a quién
 *     avisarle se decide antes de llamar.
 *
 * **Nunca tira.** Cuando se llega acá la respuesta ya está guardada, y un push
 * service caído no es un fallo de la respuesta: todo va adentro de un `try` que
 * devuelve el motivo en vez de relanzarlo.
 *
 * Lo que devuelve, para quien arma el mensaje de pantalla:
 *
 *   - `motivo: "fuera de hora"`, `"sin aparatos"` o `"cuenta dada de baja"`: no
 *     se mandó, y no es un error. La respuesta está en la OT igual.
 *   - `motivo` con otro texto: algo falló —la lectura de la base, las claves
 *     VAPID—, y es el mensaje tal cual. También va al log.
 *   - `enviadas: 0` con `personas: 1` y **sin** `motivo`: se intentó y ningún
 *     aparato lo recibió (el push service caído, o suscripciones que vencieron).
 *     Es distinto de no tener aparatos, que trae motivo y `personas: 0`.
 */
export async function avisarAUnaPersona(
  admin: SupabaseClient,
  opciones: {
    /** Quien preguntó: `creado_por` de la pregunta. */
    usuarioId: string;
    aviso: Aviso;
    /** Sólo para los tests. En producción se llama sin nada. */
    ahora?: Date;
  }
): Promise<ResultadoDelAviso> {
  const { usuarioId, aviso, ahora } = opciones;

  try {
    // Lo primero, y lo único que no toca la base: fuera de hora no se lee nada.
    // Va adentro del `try` aunque hoy no pueda tirar —`horaEnArgentina` es
    // aritmética de fechas—: que esta función nunca tire no puede depender de
    // cómo esté escrita la de otro archivo.
    if (!esHoraDeAvisar(ahora)) return { enviadas: 0, personas: 0, motivo: "fuera de hora" };

    // Los aparatos de **esa** persona, y no todos los del sistema para tirar casi
    // todos. Paginado aunque una persona tenga dos o tres: PostgREST corta en
    // 1000 y no avisa, y esa excusa —«esta tabla es chica»— es la que el repo
    // no acepta.
    const suscripciones = await traerTodo<AparatoSuscripto>((desde, hasta) =>
      admin
        .from("push_suscripciones")
        .select("usuario_id, endpoint, p256dh, auth")
        .eq("usuario_id", usuarioId)
        .range(desde, hasta)
    );

    // El filtro de la consulta y éste no son lo mismo: `aparatosAAvisar` es la
    // regla de «a quién» que comparte con `avisarAQuienDecide`, y es la última
    // antes de `enviarPush`. Si alguien le saca el `.eq` de arriba, a nadie más
    // le llega nada igual.
    const aparatos = aparatosAAvisar(suscripciones, new Set([usuarioId]), null);
    if (aparatos.length === 0) return { enviadas: 0, personas: 0, motivo: "sin aparatos" };

    // Una cuenta dada de baja no recibe. Sus suscripciones siguen vivas hasta que
    // se borre la fila de `usuarios` (el `on delete cascade`), así que desactivar
    // a alguien no las limpia: mismo cuidado que `avisarAQuienDecide` y el cron
    // del resumen. Va después de los aparatos para no leer `usuarios` cuando no
    // hay a quién mandarle.
    const { data: cuenta, error: errorCuenta } = await admin
      .from("usuarios")
      .select("id")
      .eq("id", usuarioId)
      .eq("activo", true)
      .maybeSingle();
    if (errorCuenta) throw new Error(errorCuenta.message);
    if (!cuenta) return { enviadas: 0, personas: 0, motivo: "cuenta dada de baja" };

    let enviadas = 0;
    for (const aparato of aparatos) {
      const resultado = await enviarPush(aparato, aviso);
      if (resultado === "enviada") enviadas++;
      else if (resultado === "vencida") {
        // El push service dice que ese aparato ya no existe. Se borra esa fila, por
        // la clave entera: se desinstaló la app de un teléfono, no se dio de baja
        // de todo, y el mismo navegador puede estar suscripto por otra persona
        // con el mismo `endpoint`. Un `fallo`, en cambio, no borra nada: el
        // problema es del otro lado.
        //
        // El resultado del borrado no se mira, y es a propósito: es limpieza. Si no
        // salió, la próxima vez el push service vuelve a contestar 404/410 y se
        // reintenta; cortar acá dejaría sin aviso a los otros aparatos de la
        // persona por una fila que no se pudo sacar. Un aparato que falla no puede
        // callar al resto.
        await admin
          .from("push_suscripciones")
          .delete()
          .eq("usuario_id", aparato.usuario_id)
          .eq("endpoint", aparato.endpoint);
      }
    }

    return { enviadas, personas: 1 };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.error("aviso a una persona: no se pudo avisar", motivo);
    return { enviadas: 0, personas: 0, motivo };
  }
}
