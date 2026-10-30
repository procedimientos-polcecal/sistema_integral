import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puedeEditarSyh, tieneAccesoSyh } from "@/lib/seguridadHigiene/auth";
import { esquemaDeCondicion, problemaDelLugar } from "@/lib/seguridadHigiene/cuerpoDeCondicion";
import { problemaDeLaFoto } from "@/lib/seguridadHigiene/fotoDeCondicion";
import { guardarLaFoto } from "@/lib/seguridadHigiene/guardarLaFoto";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { traerTodo } from "@/lib/core/paginado";
import { CAMPO_DEL_CUERPO, CAMPO_DE_LA_FOTO } from "@/public/cola/colaOffline.js";

/**
 * Condiciones inseguras: cargar una (POST) y listarlas para la gestión (GET).
 *
 * Las dos escrituras y la lectura van con el cliente del usuario y **no** con el
 * admin, a propósito: así corren las policies y el trigger
 * `syh_condiciones_proteger_gestion`, que es lo único que frena a un `edicion`
 * que manda los puntajes del riesgo. Con el cliente admin esa defensa no corre
 * (ahí `auth.uid()` es null) y habría que repetirla acá a mano.
 *
 * ── EL ALTA ACEPTA DOS FORMAS DE CUERPO, Y UNA SOLA VALIDACIÓN ──────────────
 *
 * JSON, como siempre, y `multipart/form-data` cuando la carga trae foto, que es
 * como sale de la cola sin señal. En el multipart **el cuerpo entero viene en
 * un solo campo de JSON** (`CAMPO_DEL_CUERPO`) y la foto aparte
 * (`CAMPO_DE_LA_FOTO`): así los dos caminos le dan a zod exactamente el mismo
 * objeto. Un campo por clave haría que `prioridad: 2` llegara como `"2"` y
 * `peligro_id: null` como `"null"`, y el esquema vería otra cosa según si la
 * carga trajo foto o no. Los dos nombres viven en `public/cola/colaOffline.js`
 * —el único archivo que importan la pantalla, el service worker y esta ruta— y
 * no se escriben a mano acá.
 *
 * La foto **se comprueba antes de insertar nada**: si pesa de más o no es una
 * foto, la respuesta es un 400 y no queda una condición a medias. Para la cola
 * un 400 es definitivo, así que ese texto es lo único que va a leer quien tenga
 * que decidir si vuelve a la planta a sacarla: dice cuánto pesa y cuánto entra.
 */

/** Una foto de hasta 10 MB tarda, y el peor caso es la señal de la planta. */
export const maxDuration = 120;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  // `maybeSingle` y no `single`, y un fallo de la lectura es un 503: para la
  // cola sin señal un 403 es definitivo, así que una caída pasajera de la base
  // no puede disfrazarse de «tu usuario está desactivado». Es el criterio de la
  // ruta de avisos de Mantenimiento.
  const { data: usuario, error: errorDelUsuario } = await supabase
    .from("usuarios")
    .select("activo")
    .eq("id", user.id)
    .maybeSingle();
  if (errorDelUsuario) {
    return NextResponse.json(
      { error: `No se pudo comprobar tu usuario: ${errorDelUsuario.message}` },
      { status: 503 }
    );
  }
  if (!usuario?.activo) {
    return NextResponse.json({ error: "Tu usuario está desactivado" }, { status: 403 });
  }

  if (!(await puedeEditarSyh(supabase, user.id))) {
    return NextResponse.json(
      { error: "No tenés permiso para cargar condiciones inseguras" },
      { status: 403 }
    );
  }

  const leido = await leerElCuerpo(request);
  if ("error" in leido) return NextResponse.json({ error: leido.error }, { status: 400 });
  const { cuerpo, foto } = leido;

  const r = validar(esquemaDeCondicion, cuerpo);
  if (!r.ok) return errorDeValidacion(r.problemas);
  const c = r.datos;

  // Antes de escribir nada: una foto que no entra no puede dejar una condición
  // cargada sin ella. Y el mensaje es el de `problemaDeLaFoto`, que dice cuánto
  // pesa y cuánto entra.
  if (foto) {
    const problemaDeLaSuya = problemaDeLaFoto(foto);
    if (problemaDeLaSuya) {
      return NextResponse.json({ error: problemaDeLaSuya }, { status: 400 });
    }
  }

  const sectorId = c.sector_id || null;
  const equipoId = c.equipo_id || null;

  const problema = problemaDelLugar(sectorId, equipoId);
  if (problema) return NextResponse.json({ error: problema }, { status: 400 });

  // La tabla deja el lugar vacío porque tiene que recibir las 44 del Excel, que
  // entran sin reconocer. Desde el teléfono, parado frente al problema, siempre
  // se sabe dónde se está: acá sí es obligatorio.
  if (!sectorId && !equipoId) {
    return NextResponse.json(
      { error: "Falta decir en qué sector o equipo es" },
      { status: 400 }
    );
  }

  // ── La clave de la carga ────────────────────────────────────
  //
  // La cola del teléfono repite la misma `clave` en cada reintento, y la
  // pantalla y el service worker pueden despertar a la vez: sin esto la misma
  // condición entra dos veces. **Sin `clave` no se toca nada de esto.**
  //
  // Se busca primero y se devuelve la fila que ya existe, en vez de un upsert
  // con `ON CONFLICT (clave)`: el trigger de la tabla frena a un no-admin que
  // cambia `numero` o `detectada_por`, y un `DO UPDATE` que los tocara lo haría
  // fallar con un 42501 en el reintento.
  //
  // La búsqueda no cierra del todo la ventana —dos pedidos simultáneos pueden
  // buscar los dos antes de que el primero inserte—. Lo cierra el `unique` de
  // `clave`: el segundo insert falla con 23505 y ahí se vuelve a buscar.
  //
  // **Y LA FOTO SE ENLAZA TAMBIÉN POR ACÁ**, que es la mitad que es fácil
  // olvidarse: el segundo disparo encuentra la condición en vez de crearla, y
  // si el enlace viviera sólo en el camino de alta nueva, ese disparo subiría
  // el archivo y lo perdería — el único campo de una condición que no se puede
  // volver a sacar. El caso es real: la foto sigue en IndexedDB justamente
  // porque el primer disparo no terminó.
  const clave = c.clave ?? null;
  if (clave) {
    const ya = await buscarPorClave(supabase, clave);
    if (ya.error) return errorDeLectura(ya.error);
    if (ya.fila !== null) {
      return conLaFoto(supabase, user.id, ya.fila, foto);
    }
  }

  const { data, error } = await supabase
    .from("syh_condiciones")
    .insert({
      clave,
      sector_id: sectorId,
      equipo_id: equipoId,
      // Sin fecha, la que pone la tabla (hoy).
      ...(c.detectada_el ? { detectada_el: c.detectada_el } : {}),
      // Es quien carga y se firma acá: la cola recuerda la sesión, así que
      // esto es de quien hizo la carga y no de quien tenga el teléfono después.
      detectada_por: user.id,
      descripcion: c.descripcion,
      peligro_id: c.peligro_id || null,
      accion_propuesta: c.accion_propuesta,
      prioridad: c.prioridad,
      frecuencia: c.frecuencia ?? null,
      antecedentes: c.antecedentes ?? null,
      controles: c.controles ?? null,
      magnitud_dano: c.magnitud_dano ?? null,
      legislacion: c.legislacion ?? null,
      // `numero` NO se manda: lo da la secuencia, y el trigger rechaza uno
      // explícito de un no-admin.
    })
    .select("id, numero")
    .single();

  if (error) {
    // Perdió la carrera contra otro envío de la misma clave: la condición ya
    // está, se devuelve su número como si éste hubiera sido el primero —y la
    // foto se enlaza igual, por lo mismo que en la rama de arriba.
    if (error.code === "23505" && clave) {
      const ya = await buscarPorClave(supabase, clave);
      if (ya.fila !== null) return conLaFoto(supabase, user.id, ya.fila, foto);
    }
    // Un id que no existe (23503) es un 400: para la cola un 500 se reintenta
    // para siempre y el mismo pedido nunca va a pasar.
    if (error.code === "23503") {
      return NextResponse.json(
        { error: "El sector, el equipo o el peligro elegido no existe" },
        { status: 400 }
      );
    }
    // 42501 es el trigger o RLS: es definitivo y su texto ya está en castellano.
    const status = error.code === "42501" ? 403 : 500;
    return NextResponse.json(
      { error: `No se pudo guardar la condición: ${error.message}` },
      { status }
    );
  }

  return conLaFoto(supabase, user.id, data, foto);
}

/**
 * Lo que la ruta contesta una vez que la condición existe: su número, y antes
 * la foto guardada si vino alguna.
 *
 * ── QUÉ PASA SI LA CONDICIÓN ENTRÓ Y LA FOTO NO ────────────────────────────
 *
 * Se contesta un **error**, aunque la condición esté escrita, y la carga se
 * queda en la cola del teléfono. Es a propósito y es la decisión más
 * discutible de esta ruta, así que queda escrita:
 *
 *   * La alternativa era contestar 200 con una `advertencia` —el camino de
 *     `borrar-y-avisar`, que avisa y saca la carga de la cola—. Eso **pierde
 *     la foto**, porque la carga es el único lugar donde queda: el `Blob` vive
 *     en IndexedDB y sale de ahí cuando la carga sale de la cola. La foto es
 *     el único campo de una condición que no se puede volver a conseguir: se
 *     saca parado frente al cardán sin proteger, y cuando el cardán se protege
 *     ya no hay nada que fotografiar.
 *   * Como error, el teléfono reintenta y el reintento cae en la rama de
 *     idempotencia de arriba, que enlaza la foto a la condición que ya existe.
 *     O sea: el único camino que puede terminar con la foto adentro.
 *   * Lo que cuesta es que quien mire la cola ve una carga que "no salió"
 *     cuando en realidad la condición ya está. Por eso el texto **empieza
 *     diciendo que entró y con qué número**: lo primero que esa persona tiene
 *     que saber es que esto no hay que volver a cargarlo a mano.
 *
 * Un fallo al subir es un 502 (pasajero: se reintenta solo); uno de la policy
 * es un 403 (definitivo: la carga queda parada y a la vista). Lo que no puede
 * pasar nunca es un 400 acá, porque la foto ya se comprobó antes de insertar.
 */
async function conLaFoto(
  supabase: Awaited<ReturnType<typeof createClient>>,
  usuarioId: string,
  condicion: { id: string; numero: number },
  foto: Foto | null
) {
  const numero = String(condicion.numero);
  if (!foto) return NextResponse.json({ numero });

  const guardada = await guardarLaFoto(supabase, condicion.id, usuarioId, foto);
  if (!guardada.ok) {
    return NextResponse.json(
      {
        error:
          `La condición entró con el número ${numero}, así que no hay que volver a ` +
          `cargarla. Lo que faltó es la foto, y se reintenta sola: ${guardada.error}`,
      },
      { status: guardada.status }
    );
  }

  return NextResponse.json({ numero });
}

/** La foto tal como llega en el `FormData`, con lo único que se le pide. */
type Foto = { type: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> };

/**
 * El cuerpo del pedido, venga como JSON o como `multipart/form-data`.
 *
 * Un multipart ilegible es un 400 y no un 500: lo manda el teléfono, y la cola
 * necesita saber que reintentarlo daría lo mismo. El JSON ilegible sigue
 * llegando como `null` a `validar()`, que contesta qué falta — eso no cambia.
 */
async function leerElCuerpo(
  request: Request
): Promise<{ cuerpo: unknown; foto: Foto | null } | { error: string }> {
  const tipo = request.headers.get("content-type") ?? "";
  if (!tipo.toLowerCase().includes("multipart/form-data")) {
    return { cuerpo: await request.json().catch(() => null), foto: null };
  }

  const forma = await request.formData().catch(() => null);
  if (!forma) {
    return { error: "No se pudo leer el pedido: el cuerpo no es un multipart válido." };
  }

  const crudo = forma.get(CAMPO_DEL_CUERPO);
  if (typeof crudo !== "string") {
    return { error: `El pedido no trae el campo "${CAMPO_DEL_CUERPO}" con los datos.` };
  }
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    return { error: `El campo "${CAMPO_DEL_CUERPO}" no es un JSON que se pueda leer.` };
  }

  // Sin foto el campo no viene, en vez de venir vacío: que no esté es
  // inequívoco (ver `cuerpoComoFormData`). Un string acá es un campo de texto
  // con ese nombre, que no es una foto.
  const archivo = forma.get(CAMPO_DE_LA_FOTO);
  const foto = archivo !== null && typeof archivo !== "string" ? archivo : null;
  return { cuerpo, foto };
}

/**
 * El listado para la gestión: todas, con su lugar y su peligro. Las fotos se
 * piden de a una condición, no acá. Lo ve quien tenga el módulo, con cualquier
 * nivel.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await tieneAccesoSyh(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Seguridad e Higiene" }, { status: 403 });
  }

  // `traerTodo` y no `.limit()`: PostgREST corta en 1000 filas y no avisa, y
  // esta tabla sólo crece. Se ordena por `numero` para que las páginas no se
  // pisen ni se salteen filas entre una y otra. El `select` va literal: armado
  // en una variable pierde la inferencia de tipos.
  try {
    const condiciones = await traerTodo((desde, hasta) =>
      supabase
        .from("syh_condiciones")
        .select("*, sectores(nombre), equipos(name, code), syh_peligros(nombre)")
        .order("numero", { ascending: false })
        .range(desde, hasta)
    );
    return NextResponse.json({ data: condiciones });
  } catch (e) {
    return NextResponse.json(
      { error: `No se pudieron leer las condiciones: ${e instanceof Error ? e.message : e}` },
      { status: 500 }
    );
  }
}

/**
 * La condición que ya tiene esta clave, con su `id` además de su `numero`: el
 * id es lo que necesita la foto para enlazarse, y el reintento que encuentra la
 * fila es justamente el que puede traer una foto que todavía no entró.
 */
async function buscarPorClave(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clave: string
): Promise<{ fila: { id: string; numero: number } | null; error: string | null }> {
  const { data, error } = await supabase
    .from("syh_condiciones")
    .select("id, numero")
    .eq("clave", clave)
    .maybeSingle();
  if (error) return { fila: null, error: error.message };
  return { fila: data ?? null, error: null };
}

/**
 * Un fallo al buscar no es «la clave no existe»: seguir insertando duplicaría la
 * condición si el reintento ya había entrado. 503 es lo que la cola reintenta.
 */
function errorDeLectura(mensaje: string) {
  return NextResponse.json(
    { error: `No se pudo comprobar la carga: ${mensaje}` },
    { status: 503 }
  );
}
