import type { SupabaseClient } from "@supabase/supabase-js";
import { validarConsulta } from "./validarConsulta";

export type Resultado =
  | { ok: true; filas: Record<string, unknown>[] }
  | { ok: false; error: string };

/**
 * Cuántas filas vuelven como mucho.
 *
 * Tiene que coincidir con el default de `asistente_consulta` y con lo que dicen
 * las notas del catálogo, que le avisan al modelo que agregue en vez de traer
 * filas. El corte no avisa: un resultado truncado se ve igual que uno completo.
 */
export const TOPE_DE_FILAS = 200;

/**
 * Corre una consulta del asistente con la sesión de quien preguntó.
 *
 * Tres cosas que no son casuales:
 *
 * 1. **El cliente es el del usuario**, nunca `createAdminClient()`. Es lo único
 *    que hace que RLS decida qué ve cada uno. Si algún día alguien cambia esto
 *    por "no me devolvía nada", rompió el diseño entero.
 * 2. **`{ get: true }`**. Lo que garantiza la sólo-lectura es que
 *    `asistente_consulta` esté declarada `stable` —PostgREST corre esas
 *    funciones en transacción de sólo lectura, medido también por POST—, pero
 *    el GET va igual: es lo que hace que PostgREST la acepte por esa vía y es
 *    honesto sobre lo que la llamada hace.
 * 3. **El error vuelve tal cual lo dijo Postgres**, sin traducir. El modelo lo
 *    usa para corregir en el intento siguiente —"column does not exist" le dice
 *    exactamente qué arreglar— y la persona lo ve si no salió. Misma regla que
 *    los errores de Google: un diagnóstico que no se distingue de otro no es un
 *    diagnóstico.
 */
export async function correrConsulta(
  db: SupabaseClient,
  sql: string,
  tope: number = TOPE_DE_FILAS
): Promise<Resultado> {
  const veredicto = validarConsulta(sql);
  if (!veredicto.ok) return { ok: false, error: veredicto.motivo };

  const { data, error } = await db.rpc(
    "asistente_consulta",
    { consulta: sql, tope },
    { get: true }
  );

  if (error) return { ok: false, error: error.message };
  return { ok: true, filas: (data ?? []) as Record<string, unknown>[] };
}
