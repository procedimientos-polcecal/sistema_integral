/**
 * Resuelve, en cada corrida de la sincronización de avisos, a qué orden de
 * trabajo corresponde cada aviso. La regla (a quién tocar y a quién no) vive en
 * `enlaceDelAviso.ts`; acá sólo se lee, se pregunta a esa regla y se escribe.
 *
 * ── POR QUÉ SE CORRE EN CADA SINCRONIZACIÓN ────────────────────────────────
 *
 * Un script rellena de una vez los 182 avisos que traían el número como texto.
 * Pero casi todos los avisos nuevos entran por un formulario de Google, así que
 * sin esto, en un mes la pantalla volvería a decir «OT #2814» a secas para todo
 * lo nuevo y nadie se enteraría: el enlace se congelaría solo.
 *
 * ── POR QUÉ UN UPDATE APARTE Y NO DENTRO DEL UPSERT ─────────────────────────
 *
 * supabase-js arma el parámetro `columns` del upsert con la **unión de las
 * claves de todo el lote** y le manda `null` a la fila que no la trae (está en
 * `PostgrestQueryBuilder.ts` de postgrest-js). Por eso `repartirPorArea` ya
 * parte las filas en dos upserts; sumar una segunda columna opcional obligaría
 * a partirlas en cuatro grupos, y cada columna nueva duplicaría los grupos.
 *
 * ── POR QUÉ LEE `ot_asignada` DE LA TABLA Y NO DE LA FILA DE LA PLANILLA ────
 *
 * Es el motivo que importa más. El upsert saltea a los avisos con la
 * exportación pendiente (`sinExportar` en `sincronizarAvisos`; ver el
 * encabezado de `pendienteDelAviso.ts`): la planilla todavía no sabe lo que el
 * sistema sabe, y leerla ahora le pisaría lo que acaba de cargar una persona.
 * Si esta función mirara la fila de la planilla, pisaría justo lo que esa cola
 * protege. Leyendo la tabla, esos avisos conservan el `ot_asignada` que el
 * sistema escribió y se respetan solos, sin que esta función sepa de la cola.
 *
 * ── LAS GUARDAS DEL WHERE ───────────────────────────────────────────────────
 *
 * Entre la lectura y la escritura alguien puede apretar «Ya tiene OT». Por eso
 * cada update repite en el `where` las condiciones de `loQueHayQueReenlazar`
 * (`ot_enlazada_en is null`, y sin enlace o con el sello propio): si el aviso
 * cambió en el medio, el update no lo toca.
 *
 * Nunca tira: cualquier fallo vuelve en `error` y la corrida sigue. El enlace se
 * recalcula entero en la próxima, así que lo único que se pierde es el tiempo.
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import { traerTodo } from "@/lib/core/paginado";
import {
  loQueHayQueReenlazar,
  numeroDeOtDelTexto,
  type AvisoAResolver,
} from "@/lib/mantenimiento/enlaceDelAviso";

/** Lo que se escribió, o el motivo por el que no se pudo. */
export interface EnlacesResueltos {
  enlazados: number;
  vaciados: number;
  error?: string;
}

/** Un `.in()` largo arma una URL que PostgREST rechaza con un 400 mudo. */
const LOTE = 200;

function lotes<T>(lista: readonly T[]): T[][] {
  const salida: T[][] = [];
  for (let i = 0; i < lista.length; i += LOTE) salida.push(lista.slice(i, i + LOTE));
  return salida;
}

export async function resolverLosEnlacesDeAvisos(
  admin: ReturnType<typeof createAdminClient>
): Promise<EnlacesResueltos> {
  let enlazados = 0;
  let vaciados = 0;

  try {
    const avisos = (await traerTodo((desde, hasta) =>
      admin
        .from("avisos")
        .select("id, ot_asignada, work_order_id, ot_enlazada_en, ot_resuelta_en")
        .is("ot_enlazada_en", null)
        .order("id")
        .range(desde, hasta)
    )) as AvisoAResolver[];

    // Sólo las OT cuyo número aparece en algún aviso: la tabla tiene miles.
    const numeros = [
      ...new Set(
        avisos
          .map((a) => numeroDeOtDelTexto(a.ot_asignada))
          .filter((n): n is number => n !== null)
      ),
    ];

    const idPorNumero = new Map<number, string>();
    for (const lote of lotes(numeros)) {
      const { data, error } = await admin
        .from("ordenes_trabajo")
        .select("id, ot_number")
        .in("ot_number", lote);
      if (error) return { enlazados, vaciados, error: error.message };
      for (const ot of data ?? []) idPorNumero.set(Number(ot.ot_number), ot.id as string);
    }

    const { aEnlazar, aVaciar } = loQueHayQueReenlazar(avisos, idPorNumero);
    const cuando = new Date().toISOString();

    for (const { otId, avisoIds } of aEnlazar) {
      for (const lote of lotes(avisoIds)) {
        const { error } = await admin
          .from("avisos")
          .update({ work_order_id: otId, ot_resuelta_en: cuando })
          .in("id", lote)
          .is("ot_enlazada_en", null)
          .or("work_order_id.is.null,ot_resuelta_en.not.is.null");
        if (error) return { enlazados, vaciados, error: error.message };
        enlazados += lote.length;
      }
    }

    for (const lote of lotes(aVaciar)) {
      const { error } = await admin
        .from("avisos")
        .update({ work_order_id: null, ot_resuelta_en: null })
        .in("id", lote)
        .is("ot_enlazada_en", null)
        .not("ot_resuelta_en", "is", null);
      if (error) return { enlazados, vaciados, error: error.message };
      vaciados += lote.length;
    }

    return { enlazados, vaciados };
  } catch (e) {
    return { enlazados, vaciados, error: e instanceof Error ? e.message : String(e) };
  }
}
