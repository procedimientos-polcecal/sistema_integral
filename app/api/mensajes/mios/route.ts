import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tituloDelHilo, type TipoDeEntidad } from "@/lib/core/mensajes";
import { traerTodo } from "@/lib/core/paginado";
import { errorDeValidacion, validar } from "@/lib/core/validar";
import { nombreCompleto } from "@/lib/mensajes/avisos";
import { ENTIDADES, TIPOS_DE_ENTIDAD, queEs } from "@/lib/mensajes/entidades";
import { esquemaDelHilo } from "@/lib/mensajes/pedidos";

/**
 * Las menciones de quien pregunta: lo que le escribieron y todavía no leyó.
 *
 * Se leen con el cliente admin y filtrando por `usuario_id` a mano, por el mismo
 * motivo que el hilo: el nombre del autor vuelve `null` con el cliente de la
 * sesión. El permiso, entonces, es de esta ruta, y es uno solo y de sentido
 * común: **cada uno ve sus menciones y nada más**.
 *
 * ## Una mención que lleva a un hilo que no se puede abrir no se muestra
 *
 * Si a alguien lo mencionaron en una OT y después perdió Mantenimiento, la
 * mención sigue en la tabla pero acá se saltea. Mostrarla sería un aviso que
 * lleva a una pantalla que lo rebota, y el texto del mensaje saldría en la
 * bandeja de quien ya no tiene permiso de leerlo.
 */

type FilaDeMencion = {
  mensaje_id: string;
  mensajes: {
    entidad_tipo: TipoDeEntidad;
    entidad_id: string;
    texto: string;
    creado_en: string;
    autor: { nombre: string; apellido?: string | null } | null;
  };
};

/** GET — mis menciones sin leer, las más nuevas primero. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const admin = createAdminClient();

  try {
    // `traerTodo` porque la tabla crece y PostgREST corta en 1000 sin avisar. Se
    // ordena por la clave para que las páginas no se pisen, y por fecha después,
    // en memoria: la ordenación por una columna de la tabla embebida no se
    // probó, y la migración todavía no estaba aplicada para poder probarla.
    const filas = await traerTodo<FilaDeMencion>((desde, hasta) =>
      admin
        .from("mensajes_menciones")
        .select("mensaje_id, mensajes!inner(entidad_tipo, entidad_id, texto, creado_en, autor:usuarios(nombre, apellido))")
        .eq("usuario_id", user.id)
        .is("leido_en", null)
        .order("mensaje_id")
        .range(desde, hasta)
        // Sin esquema generado, Supabase infiere el embebido como lista aunque
        // PostgREST devuelva un objeto cuando el vínculo es de uno a uno.
        .returns<FilaDeMencion[]>()
    );

    // Una pregunta de permiso por tipo, no por mención.
    const tiposQueVe = new Set<TipoDeEntidad>();
    for (const tipo of TIPOS_DE_ENTIDAD) {
      if (filas.some((f) => f.mensajes.entidad_tipo === tipo) &&
          (await ENTIDADES[tipo].puedeVerlo(admin, user.id))) {
        tiposQueVe.add(tipo);
      }
    }

    const visibles = filas.filter((f) => tiposQueVe.has(f.mensajes.entidad_tipo));

    // Los números de los registros, de a un tipo por consulta.
    const numeros = new Map<TipoDeEntidad, Map<string, number>>();
    for (const tipo of tiposQueVe) {
      const ids = visibles
        .filter((f) => f.mensajes.entidad_tipo === tipo)
        .map((f) => f.mensajes.entidad_id);
      numeros.set(tipo, await ENTIDADES[tipo].numeros(admin, ids));
    }

    const data = visibles
      .map((f) => {
        const { entidad_tipo: tipo, entidad_id: id } = f.mensajes;
        const numero = numeros.get(tipo)?.get(id) ?? null;
        const existe = numero !== null;
        return {
          mensaje_id: f.mensaje_id,
          tipo,
          id,
          texto: f.mensajes.texto,
          creado_en: f.mensajes.creado_en,
          autor: f.mensajes.autor ? nombreCompleto(f.mensajes.autor) : null,
          titulo: tituloDelHilo(queEs(tipo, numero), existe),
          existe_el_registro: existe,
          ruta: ENTIDADES[tipo].ruta(id, numero),
        };
      })
      .sort((a, b) => b.creado_en.localeCompare(a.creado_en));

    return NextResponse.json({ data });
  } catch (e) {
    console.error("mensajes: no se pudieron leer las menciones", (e as Error).message);
    return NextResponse.json(
      { error: "No se pudieron leer tus menciones. Probá de nuevo en un momento." },
      { status: 503 }
    );
  }
}

/** De a 200 ids por consulta: un `.in()` más largo arma una URL que PostgREST rechaza con un 400 sin decir por qué. */
const LOTE = 200;

/**
 * PATCH { tipo, id } — marcar como leídas mis menciones de un hilo.
 *
 * La llama la pantalla **cuando muestra el hilo**. No es un efecto del GET del
 * hilo: un GET que escribe se dispara con cualquier precarga del navegador y
 * marcaría como leído algo que nadie vio.
 *
 * **Sólo escribe `leido_en`.** La policy de update de la tabla acota *qué fila*
 * se puede tocar y no *qué campo* —RLS no sabe limitar una columna sola—, así
 * que `avisado_en` y `aviso_fallo`, que son del proceso que manda el correo,
 * quedan a salvo porque esta ruta no los nombra.
 *
 * **No comprueba si todavía puede ver el registro**, a diferencia del GET del
 * hilo, y a propósito: marcar las propias menciones como leídas no muestra nada
 * de nadie, y comprobarlo dejaría para siempre en la bandeja la mención de
 * quien perdió el acceso. Lo acota el filtro por `usuario_id`.
 *
 * **Por qué el cliente admin y no el de la sesión.** Con el de la sesión, la
 * policy de lectura de `mensajes` filtraría por tipo: el `mensajes!inner` no
 * traería los hilos de un tipo que la persona ya no puede ver, y justo esas
 * menciones son las que este PATCH tiene que poder marcar para que no queden
 * para siempre en la bandeja. El permiso lo pone el filtro `usuario_id = quien
 * pregunta`, que acota cada lectura y cada `update`.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const cuerpo = await request.json().catch(() => null);
  const pedido = validar(esquemaDelHilo, cuerpo);
  if (!pedido.ok) return errorDeValidacion(pedido.problemas);
  const { tipo, id } = pedido.datos;

  const admin = createAdminClient();

  try {
    const sinLeer = await traerTodo<{ mensaje_id: string }>((desde, hasta) =>
      admin
        .from("mensajes_menciones")
        .select("mensaje_id, mensajes!inner(entidad_tipo, entidad_id)")
        .eq("usuario_id", user.id)
        .is("leido_en", null)
        .eq("mensajes.entidad_tipo", tipo)
        .eq("mensajes.entidad_id", id)
        .order("mensaje_id")
        .range(desde, hasta)
    );

    const ahora = new Date().toISOString();
    let marcadas = 0;
    for (let i = 0; i < sinLeer.length; i += LOTE) {
      const { data, error } = await admin
        .from("mensajes_menciones")
        .update({ leido_en: ahora })
        .eq("usuario_id", user.id)
        .is("leido_en", null)
        .in("mensaje_id", sinLeer.slice(i, i + LOTE).map((f) => f.mensaje_id))
        .select("mensaje_id");
      if (error) throw new Error(error.message);
      marcadas += data?.length ?? 0;
    }

    return NextResponse.json({ marcadas });
  } catch (e) {
    console.error("mensajes: no se pudieron marcar las menciones como leídas", (e as Error).message);
    return NextResponse.json(
      {
        error:
          "No se pudieron marcar tus menciones como leídas. Probá de nuevo en un momento. " +
          (e as Error).message,
      },
      { status: 500 }
    );
  }
}
