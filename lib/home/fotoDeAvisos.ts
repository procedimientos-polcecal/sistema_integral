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

  const { data: filas } = await admin
    .from(TABLA)
    .select("notificacion_id, cantidad")
    .eq("fecha", fecha);

  return {
    fecha,
    foto: new Map((filas ?? []).map((f) => [f.notificacion_id as string, f.cantidad as number])),
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
  if (avisos.length === 0) return {};

  const { error } = await admin.from(TABLA).upsert(
    avisos.map((a) => ({ fecha, notificacion_id: a.id, cantidad: a.cantidad })),
    { onConflict: "fecha,notificacion_id" }
  );

  return error ? { error: error.message } : {};
}
