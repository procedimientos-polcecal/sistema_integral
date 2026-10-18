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
// POR ESO "ya-esta" PUEDE VENIR CON `entidad_id: null`: en esa ventana
// `resuelto_en` y `numero` ya están llenos y el id todavía no. Quien reciba un
// "ya-esta" tiene que contar con que el número siempre está y el id a veces no,
// y no armar la respuesta como si el id fuera obligatorio.
//
// Tests: lo que decide está en funciones puras —`decidirPorClave`,
// `esChoqueDeClave` y `cambiosDeResolucion`— y esas sí se prueban.
// `reservarClave` y `resolverClave` quedan sin test: son el pegamento con
// PostgREST, y en este repo lo que habla con la base no se mockea, porque un
// mock probaría el mock. Lo que ahí queda sin probar son los dos `throw` que
// propagan un fallo de la base (y el de "no estaba reservada"); el resto de lo
// que deciden ya salió a las puras. La tabla es `cargas_offline`
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

export type DecisionDeClave = "seguir" | "ya-esta" | "en-duda" | "ajena" | "otro-tipo";

// El código de Postgres para una violación de unicidad: la primaria chocó.
const VIOLACION_DE_UNICIDAD = "23505";

/**
 * Si el error de PostgREST es la clave primaria repetida, o sea un reintento
 * legítimo. Es lo que separa seguir leyendo la fila de propagar un fallo de
 * verdad (una caída, un `tipo` fuera del check, una foreign key de usuario).
 */
export function esChoqueDeClave(error: { code?: string; message?: string }): boolean {
  return error.code === VIOLACION_DE_UNICIDAD;
}

/**
 * Qué columnas se escriben al resolver una carga. Sin `entidadId` no se toca
 * `entidad_id`: así la segunda llamada, con el id, lo completa, y una primera
 * llamada tardía no lo borra. `resuelto_en` se reescribe cada vez; el efecto es
 * que marca cuándo terminó de verdad, que es cuando llegó el id.
 */
export function cambiosDeResolucion(
  resultado: { numero: string; entidadId?: string | null },
  ahora: Date,
): { resuelto_en: string; numero: string; entidad_id?: string } {
  const cambios: { resuelto_en: string; numero: string; entidad_id?: string } = {
    resuelto_en: ahora.toISOString(),
    numero: resultado.numero,
  };
  if (resultado.entidadId) cambios.entidad_id = resultado.entidadId;
  return cambios;
}

/**
 * Qué hacer con una carga según lo que había guardado para su clave.
 *
 * - `seguir`: no hay fila, es una carga nueva.
 * - `ya-esta`: ya se resolvió; hay que devolver lo de antes, no cargar de
 *   nuevo. El `entidad_id` puede faltar (ver el encabezado).
 * - `en-duda`: la clave se reservó y no se resolvió; la fila pudo escribirse en
 *   la planilla (ver el encabezado).
 * - `ajena`: la clave es de otro usuario. Se mira primero y gana sobre las
 *   demás: devolverle a uno el número de otro filtraría una carga ajena.
 * - `otro-tipo`: la clave es del mismo usuario pero de otro tipo de carga (un
 *   aviso y una OT con la misma clave). No son la misma carga, y reconocerlas
 *   como tales devolvería el número de un aviso para una OT sin que nada
 *   fallara. Es casi imposible —las claves son uuid generados en el teléfono—,
 *   pero el modo de fallar es silencioso, y por eso se cierra acá.
 */
export function decidirPorClave(
  fila: FilaDeClave | null,
  usuarioId: string,
  tipo: TipoDeCarga,
): DecisionDeClave {
  if (!fila) return "seguir";
  if (fila.usuario_id !== usuarioId) return "ajena";
  if (fila.tipo !== tipo) return "otro-tipo";
  if (fila.resuelto_en) return "ya-esta";
  return "en-duda";
}

/**
 * Reserva la clave antes de tocar la planilla. Si la clave ya existe lee la
 * fila y la decisión dice qué hacer.
 *
 * `fila` viene en null cuando la reserva fue nueva (`seguir`) y también cuando
 * la decisión es `ajena` u `otro-tipo`: esa fila no es de esta carga y su
 * `numero` y `entidad_id` no se le pueden mostrar a quien llama, aunque la
 * ruta haga eco de lo que recibe. Sólo viene con datos en `ya-esta` y en
 * `en-duda`.
 */
export async function reservarClave(
  admin: ClienteAdmin,
  datos: { clave: string; usuarioId: string; tipo: TipoDeCarga },
): Promise<{ decision: DecisionDeClave; fila: FilaDeClave | null }> {
  const { error } = await admin
    .from("cargas_offline")
    .insert({ clave: datos.clave, usuario_id: datos.usuarioId, tipo: datos.tipo });

  if (!error) return { decision: "seguir", fila: null };

  // Cualquier error que no sea la primaria chocando no es un reintento: se
  // propaga tal como lo dijo la base.
  if (!esChoqueDeClave(error)) {
    throw new Error(`No se pudo reservar la clave de la carga: ${error.message}`);
  }

  const { data, error: errorDeLectura } = await admin
    .from("cargas_offline")
    .select("clave, usuario_id, tipo, resuelto_en, numero, entidad_id")
    .eq("clave", datos.clave)
    .maybeSingle();

  if (errorDeLectura) {
    throw new Error(`No se pudo leer la clave de la carga: ${errorDeLectura.message}`);
  }
  // Chocó la primaria y un instante después la fila no está: se borró en el
  // medio (el usuario, en cascada). No hay forma segura de seguir.
  if (!data) {
    throw new Error("La clave de la carga chocó con otra y ya no está: reintentá.");
  }

  const existente = data as FilaDeClave;
  const decision = decidirPorClave(existente, datos.usuarioId, datos.tipo);
  const esDeEstaCarga = decision === "ya-esta" || decision === "en-duda";
  return { decision, fila: esDeEstaCarga ? existente : null };
}

/**
 * Anota cómo terminó la carga: el número que se le dio y, cuando se conoce, el
 * id de lo creado. Se puede llamar dos veces: una con el número y sin id (la
 * planilla ya confirmó, la base todavía no) y otra con el id, que lo completa.
 *
 * Falla si la clave no existe: significaría que se resolvió una carga que
 * nunca se reservó, y un silencio acá escondería el orden mal hecho.
 */
export async function resolverClave(
  admin: ClienteAdmin,
  clave: string,
  resultado: { numero: string; entidadId?: string | null },
): Promise<void> {
  const { data, error } = await admin
    .from("cargas_offline")
    .update(cambiosDeResolucion(resultado, new Date()))
    .eq("clave", clave)
    .select("clave");

  if (error) {
    throw new Error(`No se pudo resolver la clave de la carga: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error("No se pudo resolver la clave de la carga: no estaba reservada.");
  }
}
