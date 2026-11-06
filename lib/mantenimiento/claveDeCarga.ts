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
// número existe apenas la planilla confirma, antes del insert en la base, y en
// la de avisos apenas se escribe la fila: las dos llaman ahí a `anotarLaClave`
// —que es `resolverClave` con el catch puesto— con `entidadId` todavía
// desconocido, y una segunda vez cuando tienen el id, que lo completa. Así un
// reintento que cae entre las dos recibe el número de verdad en vez de un 409,
// y es cierto: esa carga ya existe donde manda, que es la planilla.
//
// POR ESO "ya-esta" PUEDE VENIR CON `entidad_id: null`: en esa ventana
// `resuelto_en` y `numero` ya están llenos y el id todavía no. Quien reciba un
// "ya-esta" tiene que contar con que el número siempre está y el id a veces no,
// y no armar la respuesta como si el id fuera obligatorio.
//
// QUIEN RESUELVE NO PUEDE FALLAR: `resolverClave` lanza, pero las dos rutas la
// llaman cuando la fila ya está escrita en la planilla, y ahí un error
// propagado manda al teléfono a reintentar — o sea, al duplicado que este
// archivo existe para evitar. Por eso el que usan las rutas es
// `anotarLaClave`, que es `resolverClave` con el catch puesto. Vive acá y no
// en las rutas a propósito: es una decisión, y una decisión copiada en dos
// rutas un día está en una sola.
//
// Tests: lo que decide está en funciones puras —`decidirPorClave`,
// `esChoqueDeClave`, `cambiosDeResolucion`, `filaVisible` y
// `respuestaDeLaReserva`— y esas sí se prueban. Las dos que fijan propiedades y
// no sólo comportamiento son `filaVisible`, que dice qué veredictos exponen la
// fila, y `respuestaDeLaReserva`, que además de elegir status y texto es donde
// se comprueba que `ajena` y `otro-tipo` no devuelven número **ni aunque les
// llegue la fila**: entre las dos está la propiedad de seguridad del archivo.
// `reservarClave`, `resolverClave` y `soltarLaClave` quedan sin test: son el
// pegamento con PostgREST, y en este repo lo que habla con la base no se
// mockea, porque un mock probaría el mock. Lo que ahí queda sin probar son los
// cinco `throw` que propagan un fallo: reservar, leer, "ya no está" (en
// `reservarClave`), resolver y "no estaba reservada" (en `resolverClave`) —los
// dos últimos, tragados por `anotarLaClave`, que tampoco tiene test—. Ninguno
// decide nada, pero tampoco los cubre un test. La tabla es `cargas_offline`
// (supabase/migrations/20261018165613_claves_de_las_cargas_offline.sql).

import type { createAdminClient } from "@/lib/supabase/admin";

type ClienteAdmin = ReturnType<typeof createAdminClient>;

// Los dos valores los fija el `check` de la migración: si se agrega un tercer
// tipo hay que tocar los dos lados. Se declara acá y no se importa de
// `public/cola/colaOffline.js` por costumbre más que por regla, y conviene
// decirlo porque desde el 19/10/2026 **sí hay** código de servidor que importa
// de ese archivo: `lib/mantenimiento/correoDeLaCarga.ts` y
// `lib/mantenimiento/avisarDeLaCarga.ts` toman de ahí los nombres de la carga y
// la cabecera del disparo, justamente para que no haya dos definiciones. El
// archivo es JavaScript plano sin nada del navegador adentro, y `npm run build`
// confirma que no llega al bundle del cliente.
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
 * Qué fila se le puede mostrar a quien llama según el veredicto. Sólo la de
 * `ya-esta` y `en-duda`, que son de esta carga. `ajena` y `otro-tipo` dan null
 * porque su `numero` y su `entidad_id` pertenecen a otra carga: si la ruta hace
 * eco de lo que recibe, ahí se filtraría. `seguir` no tiene fila que mostrar.
 * Está separada de `reservarClave` para poder probarla: es la línea que, mal
 * reescrita, vuelve a abrir la fuga sin que falle nada.
 */
export function filaVisible(decision: DecisionDeClave, fila: FilaDeClave | null): FilaDeClave | null {
  return decision === "ya-esta" || decision === "en-duda" ? fila : null;
}

/** Lo que se le dice a quien manda una carga con la clave de otra persona. */
const CLAVE_AJENA =
  "Esa clave de carga es de otra persona: no se puede mandar desde esta sesión.";

/**
 * Cómo se nombra cada tipo de carga en lo que ve una persona.
 *
 * Los textos viven acá y no en las rutas porque son parte de lo que esta
 * función decide: cambiar uno sin mirar el otro deja a dos pantallas diciendo
 * cosas distintas del mismo problema.
 */
const TEXTOS: Record<TipoDeCarga, {
  campoDelNumero: string;
  otroTipo: string;
  enDuda: string;
  estaEnLaPlanilla: (numero: string, avisoId?: unknown) => string;
}> = {
  aviso: {
    campoDelNumero: "oa_number",
    otroTipo:
      "Esa clave de carga ya se usó para una orden de trabajo. Cargá el aviso de nuevo.",
    enDuda:
      "Esta carga ya había arrancado y no se sabe si llegó: el aviso puede haber " +
      "quedado escrito en la planilla. Mirala antes de cargarlo de nuevo o quedan dos.",
    estaEnLaPlanilla: (numero) =>
      `El aviso ${numero} está escrito en la planilla. Acá no quedó registrado si ` +
      `llegó a guardarse en el sistema: si no está, entra con la próxima ` +
      `sincronización. No lo cargues de nuevo o quedan dos.`,
  },
  orden: {
    campoDelNumero: "ot_number",
    otroTipo:
      "Esa clave de carga ya se usó para un aviso. Cargá la orden de nuevo.",
    enDuda:
      "Esta carga ya había arrancado y no se sabe si llegó: la orden puede haber " +
      "quedado escrita en la planilla. Mirala antes de cargarla de nuevo o quedan dos.",
    estaEnLaPlanilla: (numero, avisoId) =>
      `La OT ${numero} está escrita en la planilla. Acá no quedó registrado si ` +
      `llegó a guardarse en el sistema: si no está, entra con la próxima ` +
      `sincronización. No la cargues de nuevo o quedan dos.` +
      (avisoId
        ? ` El aviso del que salía puede haber quedado sin el enlace a esta OT: ` +
          `fijate y ponéselo a mano si falta.`
        : ""),
  },
};

/**
 * Qué contesta la ruta según el veredicto, o `null` para **seguir**.
 *
 * Vive acá y no en las dos rutas por el mismo motivo que `anotarLaClave`: es lo
 * que decide —qué status lleva cada veredicto, qué número se devuelve y qué se
 * dice— y copiado en dos rutas un día está en una sola. Que sea pura es lo que
 * permite fijar con tests la propiedad que importa: `ajena` y `otro-tipo` no
 * devuelven número ni aunque les llegue la fila.
 *
 * EL `switch` ES EXHAUSTIVO CONTRA `never` A PROPÓSITO. Antes esto eran cinco
 * `if` sueltos en cada ruta, así que un sexto veredicto no manejado se caía
 * para abajo y la ruta creaba la carga igual —duplicar en silencio, que es el
 * único modo de fallar que este archivo no puede tener—. Ahora no compila.
 *
 * LA ADVERTENCIA DE `ya-esta` dice lo que se sabe y no más. Sin `entidad_id` lo
 * único cierto es que la fila está en la planilla: la carga puede no haber
 * llegado nunca a la base, puede estar entrando en este mismo momento —entre el
 * insert y la segunda anotación hay una ventana— o puede estar guardada y haber
 * fallado esa anotación, que deja el `entidad_id` en null para siempre. Decir
 * "todavía no está en el sistema" era falso en dos de esos tres casos; el
 * consejo —no cargarla de nuevo— es el mismo en los tres.
 */
export function respuestaDeLaReserva(
  decision: DecisionDeClave,
  fila: FilaDeClave | null,
  tipo: TipoDeCarga,
  contexto: { avisoId?: unknown } = {},
): { status: number; cuerpo: Record<string, unknown> } | null {
  const textos = TEXTOS[tipo];

  switch (decision) {
    case "seguir":
      return null;

    case "ya-esta": {
      const numero = fila?.numero ?? null;
      const soloEnLaPlanilla = !fila?.entidad_id;
      return {
        status: 200,
        cuerpo: {
          // La fila no se devuelve: lo que esperaba quien reintenta es su
          // número, y traerla sería otra consulta para eso.
          data: null,
          // Cada ruta espera el suyo con su forma —"A139" el aviso, 2796 la
          // orden— y `null` cuando no hay, en las dos: un 0 o un NaN se leen
          // como un número de verdad.
          [textos.campoDelNumero]:
            tipo === "orden" ? (numero === null ? null : Number(numero)) : numero,
          ya_estaba: true,
          advertencia:
            soloEnLaPlanilla && numero
              ? textos.estaEnLaPlanilla(numero, contexto.avisoId)
              : null,
        },
      };
    }

    // Ni el número ni el id: son de otra carga.
    case "ajena":
      return { status: 403, cuerpo: { error: CLAVE_AJENA } };

    // No es falta de permiso —es el mismo usuario—, así que no es un 403: es un
    // conflicto. Va con el mismo 409 que la duda porque para la cola los dos
    // son definitivos y reintentar no los cambia.
    case "otro-tipo":
      return { status: 409, cuerpo: { error: textos.otroTipo } };

    case "en-duda":
      return { status: 409, cuerpo: { error: textos.enDuda } };

    default: {
      // Un veredicto que nadie contempló no sigue de largo: seguir sería crear
      // la carga sin haber decidido nada sobre la clave.
      const nunca: never = decision;
      throw new Error(`Veredicto de clave sin contestar: ${String(nunca)}`);
    }
  }
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
  return { decision, fila: filaVisible(decision, existente) };
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

/**
 * Suelta una clave que se reservó y **no llegó a tocar la planilla**.
 *
 * POR QUÉ HACE FALTA, Y CUÁNDO NO SE PUEDE USAR. La clave se reserva antes de
 * hablar con Google. Si Google no contesta, la ruta devuelve 502 —pasajero para
 * la cola, o sea que el teléfono reintenta— y ese reintento choca la primaria,
 * encuentra la fila sin `resuelto_en` y cae en `en-duda`: un 409, que para la
 * cola es **definitivo**. La carga queda parada con un texto que manda a mirar
 * la planilla **al pedo**, porque ahí no se escribió nunca nada. Y el caso no
 * es raro: una planilla recalculando hace cortar a `leerValores` por diseño.
 *
 * Soltarla devuelve la clave al estado de no usada, así que el reintento entra
 * por `seguir` y vuelve a intentar de verdad.
 *
 * **SÓLO SIRVE DONDE EL SERVIDOR SABE CON CERTEZA QUE NO ESCRIBIÓ.** Hoy eso es
 * un lugar solo: el 502 de la ruta de avisos por `leerValores`, que es una
 * lectura. En la ruta de OT no se puede, y no por prolijidad: `altaEnLaPlanilla`
 * devuelve `ok:false` **también después de haber escrito la fila** —cuando
 * relee la celda y el número que quedó no es el que esperaba—, así que un 502
 * de ahí no distingue "no escribí" de "escribí y no sé con qué número". Soltar
 * la clave en ese caso dejaría al reintento escribir la segunda OT, que es
 * exactamente lo que esta tabla existe para evitar. Ahí el 409 «en duda» es la
 * respuesta correcta: hace mirar y no perder.
 *
 * No lanza y no voltea nada: si no se puede soltar, lo que queda es el
 * comportamiento de antes —un 409 en el reintento—, que es feo y no es grave.
 * Se acota a la fila propia y sin resolver: nunca borra una carga ya hecha.
 */
export async function soltarLaClave(
  admin: ClienteAdmin,
  clave: string,
  usuarioId: string,
): Promise<void> {
  try {
    // El error de PostgREST viene en la respuesta y no como excepción, así que
    // se miran los dos: el `catch` solo dejaría pasar un fallo de la base sin
    // una línea en ningún lado.
    const { error } = await admin
      .from("cargas_offline")
      .delete()
      .eq("clave", clave)
      .eq("usuario_id", usuarioId)
      .is("resuelto_en", null);
    if (error) throw new Error(error.message);
  } catch (e) {
    console.error(
      `No se pudo soltar la clave ${clave}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** Cómo se nombra cada tipo de carga en un mensaje. */
const COMO_SE_LLAMA: Record<TipoDeCarga, string> = {
  aviso: "del aviso",
  orden: "de la orden",
};

/**
 * Anota cómo terminó la carga, sin poder voltear el pedido.
 *
 * Es lo que llaman las rutas, y la diferencia con `resolverClave` es entera: la
 * fila ya está escrita en la planilla cuando esto corre, así que devolver un
 * error haría que el teléfono reintente y que el reintento escriba la segunda
 * fila. Fallar acá es peor que no anotar.
 *
 * Lo que queda cuando falla, dicho: la clave sigue reservada y sin resolver, o
 * sea que el próximo reintento con esa clave recibe el veredicto `en-duda` y lo
 * mira una persona. Eso es correcto —la carga está en la planilla—, pero que no
 * voltee el pedido no quiere decir que no haya pasado nada: devuelve el mensaje
 * de la base **sin traducir** para que la ruta lo mande como `clave_error`,
 * igual que ya manda `planilla_error` y `aviso_error`. Un fallo que sólo sale
 * por el log no lo ve quien cargó.
 */
export async function anotarLaClave(
  admin: ClienteAdmin,
  clave: string,
  tipo: TipoDeCarga,
  resultado: { numero: string; entidadId?: string },
): Promise<string | null> {
  try {
    await resolverClave(admin, clave, resultado);
    return null;
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.error(`No se pudo anotar la clave ${clave} ${COMO_SE_LLAMA[tipo]}: ${motivo}`);
    return motivo;
  }
}
