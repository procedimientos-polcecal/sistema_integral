import type { SupabaseClient } from "@supabase/supabase-js";
import type { Notificacion } from "./notificaciones";
import type { Foto } from "./movimiento";

/**
 * La foto diaria de los conteos: con qué se compara el resumen para saber qué
 * se movió.
 *
 * Por qué una foto y no un cálculo, y por qué es global, está en el encabezado
 * de la migración `20261018184344_foto_diaria_de_avisos.sql`. Acá sólo están
 * las dos operaciones, y lo que hay que saber de cada una.
 */

/** La tabla la escribe y la lee sólo el cliente admin: no tiene policies. */
const TABLA = "avisos_fotos";

/**
 * El `notificacion_id` de la fila centinela de un día sin ningún aviso.
 *
 * Existe para que **la fecha avance igual**. Sin ella, un día en que todos los
 * conteos dan cero no escribe ninguna fila, `ultimaFoto` sigue devolviendo la
 * de anteayer, y el delta del día siguiente se compara contra un número viejo
 * y más alto: un día en que se atrasan cinco OT no avisaría nada, y el silencio
 * duraría hasta superar el número viejo.
 *
 * Los paréntesis hacen que no pueda chocar con un id de `lib/home/avisos.ts`,
 * que son todos kebab-case.
 */
export const SIN_AVISOS = "(sin avisos)";

/**
 * La **última** foto que haya, con su fecha. `fecha: null` es que no hay
 * ninguna: el primer día.
 *
 * **No es «la de ayer», y eso es la mitad del valor de esta función.** El día
 * que el cron no corra —Vercel falla, el deploy está a mitad de camino—,
 * comparar contra ayer daría un delta vacío (no hay fila de ayer) o, peor, al
 * día siguiente volvería a comparar contra una foto de dos días atrás creyendo
 * que es de uno. Contra la última que exista, un día perdido se recupera solo:
 * el delta del día siguiente abarca los dos días, que es la verdad.
 *
 * Son dos consultas y no una porque PostgREST no tiene `max()` directo: primero
 * la fecha más alta, después sus filas. La tabla tiene trece filas por día, así
 * que las dos son instantáneas.
 *
 * **`error` y «no hay foto» son cosas distintas y el llamador las trata
 * distinto.** Entre el deploy y la aplicación de la migración —que la hace una
 * persona a mano— la tabla no existe, y eso devuelve error. Confundirlo con el
 * primer día dejaría al cron sin mandar nada, todos los días, sin que nadie se
 * entere: exactamente el fallo silencioso que este sistema no se puede
 * permitir.
 */
export async function ultimaFoto(
  admin: SupabaseClient
): Promise<{ fecha: string | null; foto: Foto; error?: string }> {
  const { data: ultima, error } = await admin
    .from(TABLA)
    .select("fecha")
    .order("fecha", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { fecha: null, foto: new Map(), error: error.message };

  const fecha = (ultima?.fecha as string | undefined) ?? null;
  if (!fecha) return { fecha: null, foto: new Map() };

  const { data: filas, error: errorDeLasFilas } = await admin
    .from(TABLA)
    .select("notificacion_id, cantidad")
    .eq("fecha", fecha);

  // **El error de ESTA consulta importa tanto como el de la de arriba.**
  // Devolver la fecha con el mapa vacío sería decirle al cron "hay foto y está
  // vacía", y entonces `loQueSeMovio` da por nuevo todo: a cada persona le
  // llegaría un push donde cada número es el stock entero rotulado como delta
  // —«23 más · Órdenes de trabajo atrasadas»—. Un delta que miente es peor que
  // un stock repetido, porque el stock al menos es verdad.
  if (errorDeLasFilas) return { fecha: null, foto: new Map(), error: errorDeLasFilas.message };

  return {
    fecha,
    foto: new Map(
      (filas ?? [])
        .filter((f) => f.notificacion_id !== SIN_AVISOS)
        .map((f) => [f.notificacion_id as string, f.cantidad as number])
    ),
  };
}

/**
 * Guarda la foto de un día.
 *
 * El `upsert` sobre `(fecha, notificacion_id)` es lo que hace idempotente al
 * cron sin ningún candado: si corre dos veces el mismo día, la segunda corrida
 * reescribe la misma foto, y como `ultimaFoto` ya devuelve la de hoy, el delta
 * de esa segunda corrida da cero y no se manda nada.
 *
 * Qué pasa si falla lo decide el llamador. Perder una foto no rompe nada hoy:
 * la comparación del día siguiente se hace contra la última que haya.
 */
export async function guardarFoto(
  admin: SupabaseClient,
  fecha: string,
  avisos: Notificacion[]
): Promise<{ error?: string }> {
  // Un día sin ningún aviso **igual deja marcada la fecha**, con la centinela.
  // Ver `SIN_AVISOS`: saltear la escritura dejaría la fecha quieta y el delta
  // del día siguiente se compararía contra una foto vieja.
  const filas =
    avisos.length === 0
      ? [{ fecha, notificacion_id: SIN_AVISOS, cantidad: 0 }]
      : avisos.map((a) => ({ fecha, notificacion_id: a.id, cantidad: a.cantidad }));

  const { error } = await admin.from(TABLA).upsert(filas, {
    onConflict: "fecha,notificacion_id",
  });

  return error ? { error: error.message } : {};
}
