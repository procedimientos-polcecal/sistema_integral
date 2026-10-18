// La clave de una carga hecha sin señal, del lado del servidor.
//
// El teléfono genera una clave al cargar un aviso o una OT y la manda en cada
// reintento. Reintentar es lo normal, no el accidente: la respuesta se pierde
// con el túnel y el teléfono vuelve a mandar lo que el servidor ya había
// creado. Sin esta clave, ese segundo envío escribe otra fila en la planilla
// con otro número.
//
// EL INSERT VA ANTES DE TOCAR LA PLANILLA, y ése es el punto entero del
// archivo. `reservarClave` anota la clave cuando todavía no existe nada más; si
// se la dejara para después del alta, el reintento que llega en la ventana
// entre la planilla y la base no encontraría nada y duplicaría la fila.
//
// QUÉ SIGNIFICA "en-duda", y por qué no se resuelve solo: entre reservar la
// clave y escribir la fila en la planilla hay una ventana. Si el proceso muere
// ahí, la fila puede estar en la planilla sin estar en la base (la planilla es
// donde manda Mantenimiento), y desde el servidor no hay forma de saberlo sin
// leer la planilla entera. Una clave reservada y sin `resuelto_en` es
// exactamente eso: una carga que arrancó y no se sabe si llegó. Darla por
// perdida y cargar de nuevo arriesga duplicar; darla por hecha arriesga
// perderla. Decidir qué hacer con esa duda le toca a quien llama a
// `reservarClave`: este archivo sólo la reconoce y la nombra.
//
// El número puede guardarse antes de que se conozca el id. En la ruta de OT el
// número existe apenas la planilla confirma, antes del insert en la base. La
// ruta de OT va a llamar a `resolverClave` en ese punto, con `entidadId`
// todavía desconocido, y una segunda vez cuando tenga el id para completarlo.
// Así un reintento que cae entre las dos recibe el número de verdad en vez de
// un 409, y es cierto: esa OT ya existe donde manda, que es la planilla.
//
// Tests: sólo `decidirPorClave`, que es donde está la decisión. `reservarClave`
// y `resolverClave` son dos llamadas a PostgREST sin decisiones adentro, y en
// este repo lo que sólo habla con la base no se mockea: un mock probaría el
// mock. La tabla es `cargas_offline`
// (supabase/migrations/20261018165613_claves_de_las_cargas_offline.sql).

import type { createAdminClient } from "@/lib/supabase/admin";

type ClienteAdmin = ReturnType<typeof createAdminClient>;

// Los dos valores los fija el `check` de la migración: si se agrega un tercer
// tipo hay que tocar los dos lados. Se declara acá y no se importa del módulo
// del navegador (`public/cola/colaOffline.js`) porque una ruta de servidor no
// debe depender de código de cliente.
export type TipoDeCarga = "aviso" | "orden";

// Una fila de `cargas_offline`, tal como la devuelve PostgREST. `tipo` es
// string y no `TipoDeCarga` porque es lo que la base entrega; el check de la
// tabla es quien garantiza los valores.
export type FilaDeClave = {
  clave: string;
  usuario_id: string;
  tipo: string;
  resuelto_en: string | null;
  numero: string | null;
  entidad_id: string | null;
};

export type DecisionDeClave = "seguir" | "ya-esta" | "en-duda" | "ajena";

// El código de Postgres para una violación de unicidad: la primaria chocó.
const VIOLACION_DE_UNICIDAD = "23505";

/**
 * Qué hacer con una carga según lo que había guardado para su clave.
 *
 * - `seguir`: no hay fila, es una carga nueva.
 * - `ya-esta`: ya se resolvió; hay que devolver lo de antes, no cargar de nuevo.
 * - `en-duda`: la clave se reservó y no se resolvió; la fila pudo escribirse en
 *   la planilla (ver el encabezado).
 * - `ajena`: la clave es de otro usuario. Se mira primero y gana sobre las
 *   demás: devolverle a uno el número de otro filtraría una carga ajena.
 */
export function decidirPorClave(fila: FilaDeClave | null, usuarioId: string): DecisionDeClave {
  if (!fila) return "seguir";
  if (fila.usuario_id !== usuarioId) return "ajena";
  if (fila.resuelto_en) return "ya-esta";
  return "en-duda";
}

/**
 * Reserva la clave antes de tocar la planilla. Si la clave ya existe lee la fila
 * y la decisión dice qué hacer; `fila` viene en null sólo cuando la reserva
 * fue nueva (`seguir`).
 */
export async function reservarClave(
  admin: ClienteAdmin,
  datos: { clave: string; usuarioId: string; tipo: TipoDeCarga },
): Promise<{ decision: DecisionDeClave; fila: FilaDeClave | null }> {
  const { error } = await admin
    .from("cargas_offline")
    .insert({ clave: datos.clave, usuario_id: datos.usuarioId, tipo: datos.tipo });

  if (!error) return { decision: "seguir", fila: null };

  // Cualquier error que no sea la primaria chocando (una caída, un tipo fuera
  // del check) no es un reintento: se propaga tal como lo dijo la base.
  if (error.code !== VIOLACION_DE_UNICIDAD) {
    throw new Error(`No se pudo reservar la clave de la carga: ${error.message}`);
  }

  const { data: fila, error: errorDeLectura } = await admin
    .from("cargas_offline")
    .select("clave, usuario_id, tipo, resuelto_en, numero, entidad_id")
    .eq("clave", datos.clave)
    .maybeSingle();

  if (errorDeLectura) {
    throw new Error(`No se pudo leer la clave de la carga: ${errorDeLectura.message}`);
  }
  // Chocó la primaria y un instante después la fila no está: se borró en el
  // medio (el usuario, en cascada). No hay forma segura de seguir.
  if (!fila) {
    throw new Error("La clave de la carga chocó con otra y ya no está: reintentá.");
  }

  const existente = fila as FilaDeClave;
  return { decision: decidirPorClave(existente, datos.usuarioId), fila: existente };
}

/**
 * Anota cómo terminó la carga: el número que se le dio y, cuando se conoce, el
 * id de lo creado. Se puede llamar dos veces: una con el número y sin id (la
 * planilla ya confirmó, la base todavía no) y otra con el id, que lo completa.
 * Sin `entidadId` no toca la columna, así que la segunda llamada no se pisa con
 * la primera ni al revés.
 *
 * Falla si la clave no existe: significaría que se resolvió una carga que
 * nunca se reservó, y un silencio acá escondería el orden mal hecho.
 */
export async function resolverClave(
  admin: ClienteAdmin,
  clave: string,
  resultado: { numero: string; entidadId?: string | null },
): Promise<void> {
  const cambios: { resuelto_en: string; numero: string; entidad_id?: string } = {
    resuelto_en: new Date().toISOString(),
    numero: resultado.numero,
  };
  if (resultado.entidadId) cambios.entidad_id = resultado.entidadId;

  const { data, error } = await admin
    .from("cargas_offline")
    .update(cambios)
    .eq("clave", clave)
    .select("clave");

  if (error) {
    throw new Error(`No se pudo resolver la clave de la carga: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error("No se pudo resolver la clave de la carga: no estaba reservada.");
  }
}
