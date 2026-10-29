import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puedeEditarSyh, tieneAccesoSyh } from "@/lib/seguridadHigiene/auth";
import { esquemaDeCondicion, problemaDelLugar } from "@/lib/seguridadHigiene/cuerpoDeCondicion";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { traerTodo } from "@/lib/core/paginado";

/**
 * Condiciones inseguras: cargar una (POST) y listarlas para la gestión (GET).
 *
 * Las dos escrituras y la lectura van con el cliente del usuario y **no** con el
 * admin, a propósito: así corren las policies y el trigger
 * `syh_condiciones_proteger_gestion`, que es lo único que frena a un `edicion`
 * que manda los puntajes del riesgo. Con el cliente admin esa defensa no corre
 * (ahí `auth.uid()` es null) y habría que repetirla acá a mano.
 */

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

  const cuerpo = await request.json().catch(() => null);
  const r = validar(esquemaDeCondicion, cuerpo);
  if (!r.ok) return errorDeValidacion(r.problemas);
  const c = r.datos;

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
  const clave = c.clave ?? null;
  if (clave) {
    const ya = await buscarPorClave(supabase, clave);
    if (ya.error) return errorDeLectura(ya.error);
    if (ya.numero !== null) return NextResponse.json({ numero: String(ya.numero) });
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
    .select("numero")
    .single();

  if (error) {
    // Perdió la carrera contra otro envío de la misma clave: la condición ya
    // está, se devuelve su número como si éste hubiera sido el primero.
    if (error.code === "23505" && clave) {
      const ya = await buscarPorClave(supabase, clave);
      if (ya.numero !== null) return NextResponse.json({ numero: String(ya.numero) });
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

  return NextResponse.json({ numero: String(data.numero) });
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

async function buscarPorClave(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clave: string
): Promise<{ numero: number | null; error: string | null }> {
  const { data, error } = await supabase
    .from("syh_condiciones")
    .select("numero")
    .eq("clave", clave)
    .maybeSingle();
  if (error) return { numero: null, error: error.message };
  return { numero: data?.numero ?? null, error: null };
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
