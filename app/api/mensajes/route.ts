import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { urlBase } from "@/lib/core/auth-links";
import { enviarCorreo, estaConfigurado } from "@/lib/core/correo";
import { correoPorMencion, tituloDelHilo, type Destinatario } from "@/lib/core/mensajes";
import { traerTodo } from "@/lib/core/paginado";
import { errorDeValidacion, validar } from "@/lib/core/validar";
import {
  MOTIVO_EL_SERVICIO_FALLO, MOTIVO_SIN_CONFIGURAR, nombreCompleto, repartirAvisos,
} from "@/lib/mensajes/avisos";
import { ENTIDADES, queEs } from "@/lib/mensajes/entidades";
import { darFormaAlMensaje, type FilaDeMensaje } from "@/lib/mensajes/forma";
import { esquemaDelHilo, esquemaDelMensaje, parametrosDeLaUrl } from "@/lib/mensajes/pedidos";

/**
 * Los hilos de mensajes pegados a un registro.
 *
 * Diseño y motivos: `docs/superpowers/specs/2026-11-11-mensajeria-interna-design.md`.
 * La migración es `20261111110717_mensajes_pegados_a_su_registro.sql`.
 *
 * ## Quién puede ver y escribir: el que puede ver el registro
 *
 * Las dos cosas son lo mismo, y «ver el registro» lo contesta
 * `ENTIDADES[tipo].puedeVerlo` —que no siempre es el módulo: un requerimiento
 * lo ven los catorce—. **La comprobación es de esta ruta**: se lee con el
 * cliente admin, donde RLS no corre, y la policy de la migración sólo acota
 * por tipo porque `entidad_id` no tiene foreign key y desde la base no hay a
 * qué tabla mirar.
 *
 * ## Por qué el cliente admin
 *
 * El mismo motivo que la ruta de notas de una OT: con el cliente de la
 * sesión, `usuarios` sólo deja leer la fila propia, así que el nombre del autor
 * —y el de cada mencionado— volvería `null` para todos menos uno mismo, y un
 * mensaje sin autor no sirve.
 *
 * ## Si no se pudo averiguar el permiso es un 503, pero **sólo en un tipo de los tres**
 *
 * La intención es la de siempre: una caída de la base contestada con un 403 le
 * diría a alguien que no puede ver algo que sí puede. Lo cumple **Seguridad e
 * Higiene y nadie más**, porque `nivelSyhDe` devuelve `{ ok, error }` y su
 * adaptador de `lib/mensajes/entidades.ts` lanza, y la ruta lo convierte en 503.
 *
 * `nivelMantenimientoDe` (`lib/mantenimiento/auth.ts`) **descarta el `error` de
 * sus dos lecturas**, así que una caída de la base le da `null` → `puedeVerlo`
 * falso → **403**, no 503. El `requerimiento` ni siquiera pregunta: es `true`
 * fijo. Está escrito acá en vez de arreglado a propósito: esa función es de otro
 * módulo y la llaman decenas de rutas, y cambiarle la firma desde la mensajería
 * es tocar código con tráfico por un caso de borde. Lo que no se puede es que el
 * docstring prometa un 503 que no va a salir: quien lea esto y crea que ya está
 * no lo va a mirar nunca más.
 */

// El correo sale en un `after()`, después de la respuesta, y cada uno espera al
// Apps Script hasta cinco segundos. Salen todos juntos, pero la función tiene
// que seguir viva mientras tanto.
export const maxDuration = 60;

const SIN_PERMISO = "No se pudieron comprobar tus permisos. Probá de nuevo en un momento.";

/**
 * GET ?tipo=…&id=… — el hilo, del mensaje más nuevo al más viejo.
 *
 * Si el registro ya no existe el hilo se contesta igual, con la marca que usa
 * `tituloDelHilo`. Ahí el permiso sigue siendo el `puedeVerlo` del tipo: no se
 * puede preguntar por un registro que no está, y las otras salidas eran peores
 * (ver el spec).
 *
 * **Este GET no marca nada como leído.** Un GET que escribe se dispara con
 * cualquier precarga del navegador: eso es el `PATCH /api/mensajes/mios`, que
 * llama la pantalla cuando efectivamente muestra el hilo.
 *
 * **Sí dice cuántas menciones sin leer tiene acá quien pregunta**
 * (`mis_menciones_sin_leer`), para la barra del hilo plegado. Contar no es
 * marcar, y es gratis: sale de las mismas filas.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const pedido = validar(esquemaDelHilo, parametrosDeLaUrl(request.url, ["tipo", "id"]));
  if (!pedido.ok) return errorDeValidacion(pedido.problemas);
  const { tipo, id } = pedido.datos;
  const entidad = ENTIDADES[tipo];

  const admin = createAdminClient();

  // Dos `try` y no uno, y no es estilo: con uno solo, cualquier fallo de la
  // consulta salía con el texto de `SIN_PERMISO` —«No se pudieron comprobar tus
  // permisos»— y la pantalla acusaba a los permisos de un problema de la base.
  // Un diagnóstico que no se distingue de otro no es un diagnóstico.
  try {
    if (!(await entidad.puedeVerlo(admin, user.id))) {
      return NextResponse.json({ error: "Sin permisos para ver este registro" }, { status: 403 });
    }
  } catch (e) {
    console.error("mensajes: no se pudieron comprobar los permisos", (e as Error).message);
    return NextResponse.json({ error: SIN_PERMISO }, { status: 503 });
  }

  try {
    const [filas, numeros] = await Promise.all([
      traerTodo<FilaDeMensaje>((desde, hasta) =>
        admin
          .from("mensajes")
          // La cadena va literal, en una sola línea: partida con `+` o armada
          // en una variable, Supabase pierde la inferencia de tipos.
          //
          // **El `autor` nombra su foreign key y tiene que seguir nombrándola.**
          // `mensajes_menciones` abre un segundo camino de `mensajes` a
          // `usuarios` —el muchos-a-muchos—, así que `autor:usuarios(...)` a
          // secas es ambiguo y PostgREST contesta 300 PGRST201. El `usuario:`
          // de adentro de `menciones` no lleva FK porque desde
          // `mensajes_menciones` hay uno solo.
          .select("id, texto, creado_en, creado_por, autor:usuarios!mensajes_creado_por_fkey(nombre, apellido), menciones:mensajes_menciones(usuario_id, leido_en, avisado_en, aviso_fallo, usuario:usuarios(nombre, apellido))")
          .eq("entidad_tipo", tipo)
          .eq("entidad_id", id)
          .order("creado_en", { ascending: false })
          .order("id")
          .range(desde, hasta)
          // Sin esquema generado, Supabase infiere los embebidos como listas aunque
          // PostgREST devuelva un objeto cuando el vínculo es de uno a uno.
          .returns<FilaDeMensaje[]>()
      ),
      entidad.numeros(admin, [id]),
    ]);

    const existe = numeros.has(id);
    return NextResponse.json({
      titulo: tituloDelHilo(queEs(tipo, numeros.get(id) ?? null), existe),
      existe_el_registro: existe,
      // Para la barra del hilo plegado, que dice si hay algo propio esperando.
      // Sale de las filas que ya se leyeron: no cuesta ni una consulta más.
      // Lo cuenta esta ruta porque **es la única que sabe quién pregunta**: la
      // pantalla recibe `usuario_id` y `leido` de cada mención pero no conoce su
      // propio id, y por eso antes pedía la bandeja entera —todas las menciones
      // del sistema, con su texto— sólo para contar las de un hilo.
      mis_menciones_sin_leer: filas.reduce(
        (n, f) =>
          n + (f.menciones ?? []).filter((m) => m.usuario_id === user.id && m.leido_en === null).length,
        0
      ),
      data: filas.map((f) => darFormaAlMensaje(f, user.id)),
    });
  } catch (e) {
    console.error("mensajes: no se pudo leer el hilo", (e as Error).message);
    // Lo que dijo la base, detrás del texto en castellano: es lo mismo que hace
    // el 503 del insert de acá abajo, y es lo que distingue una caída de una
    // consulta mal armada.
    return NextResponse.json(
      {
        error:
          "No se pudo leer el hilo: la base no contestó bien. Probá de nuevo en un momento. " +
          (e as Error).message,
      },
      { status: 503 }
    );
  }
}

/**
 * POST { tipo, id, texto, menciones } — escribir en un hilo.
 *
 * El orden es el que importa: **primero se guarda el mensaje, después las
 * menciones, y recién entonces se manda ningún correo**. Un fallo del correo no
 * puede impedir que el mensaje quede.
 *
 * Los correos salen en un `after()`, que corre después de la respuesta: no le
 * suma los segundos del Apps Script a quien aprieta «Enviar». Eso tiene un
 * costo y está resuelto en la mención: la respuesta no puede decir si el correo
 * llegó, así que el `after()` anota en cada una `avisado_en` o `aviso_fallo`, y
 * la pantalla lo lee al releer el hilo.
 *
 * **Cada mención debería terminar con una de las dos anotadas, y hay dos casos
 * en que no.** Uno: el `after()` no llegó a correr. Otro: corrió, mandó el
 * correo y el `update` que lo anota falló dos veces seguidas (se reintenta
 * una); entonces la mención queda «pendiente» aunque el correo haya salido o
 * fallado, y lo único que queda es un `console.error` del servidor con el
 * `mensaje_id`, la persona y lo que había que anotar. Es un agujero chico y
 * conocido, no cerrado: `pendiente` quiere decir «no se sabe», no «no salió».
 * A las que se sabe de antemano que no se van a intentar —no hay correo
 * configurado, la persona no tiene correo— se les escribe el motivo al
 * guardarlas y no en el `after()`: así no hay una ventana en la que «no
 * correspondía» se parezca a «todavía no salió».
 *
 * **El autor no se menciona a sí mismo**: si viene en la lista se descarta sin
 * guardarlo, y no es un error. Su bandeja se llenaría con todo lo que escribe.
 *
 * **Los mencionados se vuelven a comprobar acá** y no se confía en la lista
 * que armó el navegador, que puede estar vieja. Alguien que ya no está activo,
 * o que ya no puede ver el registro, **rechaza el pedido entero**, antes de
 * guardar nada: guardar el mensaje sin esa mención dejaría a quien escribe
 * creyendo que avisó, que es justo lo que esta feature no puede permitir.
 *
 * **Y por eso ese 400 no afirma que el otro no puede ver el registro.** Por lo
 * que dice el encabezado de arriba, `puedeVerlo` de una OT devuelve `false`
 * tanto cuando la persona no tiene el módulo como cuando la base tuvo un hipo:
 * desde acá los dos casos se ven igual. Decir «Fulano no puede ver este
 * registro» sería una afirmación falsa sobre los permisos de un compañero, que
 * además queda en la pantalla de un tercero. El texto dice lo que sí se sabe:
 * que no se pudo confirmar.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const cuerpo = await request.json().catch(() => null);
  const pedido = validar(esquemaDelMensaje, cuerpo);
  if (!pedido.ok) return errorDeValidacion(pedido.problemas);
  const { tipo, id, texto, menciones } = pedido.datos;
  const entidad = ENTIDADES[tipo];

  const admin = createAdminClient();

  // Los mencionados que se van a guardar: sin repetidos y sin el autor.
  const idsMencionados = [...new Set(menciones)].filter((m) => m !== user.id);

  let destinatarios: Destinatario[] = [];
  // Los nombres de los mencionados, para la respuesta: ya se leyeron al
  // comprobarlos y no hace falta preguntar otra vez.
  const nombres = new Map<string, string>();
  let numero: number | null;
  let autor: string;
  try {
    // Ver y escribir son lo mismo.
    if (!(await entidad.puedeVerlo(admin, user.id))) {
      return NextResponse.json(
        { error: "No podés escribir en un registro que no podés ver" },
        { status: 403 }
      );
    }

    // El registro tiene que existir: un hilo huérfano es lo que queda cuando se
    // borra el registro, no algo que se pueda empezar. Mismo criterio que la
    // ruta de notas, que no inserta una nota colgando de la nada.
    const numeros = await entidad.numeros(admin, [id]);
    if (!numeros.has(id)) {
      return NextResponse.json({ error: "No existe ese registro" }, { status: 404 });
    }
    numero = numeros.get(id) ?? null;

    const { data: yo } = await admin
      .from("usuarios")
      .select("nombre, apellido")
      .eq("id", user.id)
      .maybeSingle();
    autor = yo ? nombreCompleto(yo) : "Alguien";

    if (idsMencionados.length > 0) {
      // A lo sumo `MAXIMO_DE_MENCIONES` ids: cabe de sobra en un `.in()`.
      const { data: usuarios, error } = await admin
        .from("usuarios")
        .select("id, nombre, apellido, email")
        .in("id", idsMencionados)
        .eq("activo", true);
      if (error) throw new Error(error.message);

      const activos = new Map((usuarios ?? []).map((u) => [u.id as string, u]));
      for (const [uid, u] of activos) nombres.set(uid, nombreCompleto(u));
      const ausentes = idsMencionados.filter((m) => !activos.has(m));
      if (ausentes.length > 0) {
        // Ya no están entre los activos, así que `activos` no trae su nombre:
        // se lo busca aparte, sin el filtro. Si ni así aparece, se dice cuántas.
        const { data: conocidos } = await admin
          .from("usuarios")
          .select("id, nombre, apellido")
          .in("id", ausentes);
        const porId = new Map((conocidos ?? []).map((c) => [c.id as string, nombreCompleto(c)]));
        const quienes = ausentes.map((m) => porId.get(m)).filter((n): n is string => Boolean(n));
        const aQuien =
          quienes.length === ausentes.length
            ? `${quienes.join(", ")} ya no figura entre los usuarios activos`
            : `${ausentes.length} de las personas mencionadas ya no figura entre los usuarios activos`;
        return NextResponse.json(
          {
            error:
              `${aQuien}, así que no se le puede mencionar. ` +
              "Sacalo de la lista y volvé a probar: el mensaje no se guardó.",
          },
          { status: 400 }
        );
      }

      const veredictos = await Promise.all(
        idsMencionados.map((m) => entidad.puedeVerlo(admin, m))
      );
      const sinAcceso = idsMencionados.filter((_, i) => !veredictos[i]);
      if (sinAcceso.length > 0) {
        const quienes = sinAcceso.map((m) => nombreCompleto(activos.get(m)!)).join(", ");
        return NextResponse.json(
          {
            error:
              `No se pudo confirmar que ${quienes} pueda ver este registro, así que no se le ` +
              "puede mencionar: puede que no tenga el módulo, o que la base no haya contestado " +
              "bien. Sacalo de la lista, o probá de nuevo en un momento: el mensaje no se guardó.",
          },
          { status: 400 }
        );
      }

      destinatarios = idsMencionados.map((m) => ({
        usuarioId: m,
        email: (activos.get(m)!.email as string | null) ?? null,
        // Ya se comprobó arriba; sigue en el tipo porque `aQuienLeLlega` lo
        // pide y es la segunda red si alguien cambia el orden de esto.
        puedeVerElRegistro: true,
      }));
    }
  } catch (e) {
    console.error("mensajes: no se pudieron comprobar los permisos", (e as Error).message);
    return NextResponse.json({ error: SIN_PERMISO }, { status: 503 });
  }

  const configurado = estaConfigurado();
  const { aEnviar, sinAviso } = repartirAvisos(destinatarios, user.id, configurado);

  // 1. El mensaje. Si esto falla no hay nada más que hacer.
  const { data: guardado, error: errorDelMensaje } = await admin
    .from("mensajes")
    .insert({ entidad_tipo: tipo, entidad_id: id, texto, creado_por: user.id })
    .select("id, texto, creado_en, creado_por")
    .single();
  if (errorDelMensaje || !guardado) {
    // 503 y no 400: para cuando se llega acá ya pasaron el esquema, el permiso
    // y la existencia del registro, así que lo único que puede fallar es la
    // base, y eso es pasajero. Un 400 es de los que `clasificarFallo` de
    // `public/cola/colaOffline.js` trata como definitivos —«no reintentes»— y
    // sería decirle a quien escribió que su mensaje está mal cuando no lo está
    // (la misma familia del 403 contra 503 de `lib/seguridadHigiene/auth.ts`).
    return NextResponse.json(
      {
        error:
          "No se pudo guardar el mensaje: la base no contestó bien. Probá de nuevo en un momento. " +
          (errorDelMensaje?.message ?? ""),
      },
      { status: 503 }
    );
  }

  // 2. Las menciones, antes de mandar nada. Las que no se van a intentar ya
  // nacen con su motivo; las otras quedan en null hasta que el `after()` diga.
  const motivos = new Map(sinAviso.map((s) => [s.usuarioId, s.motivo]));
  const filasDeMenciones = destinatarios.map((d) => ({
    mensaje_id: guardado.id,
    usuario_id: d.usuarioId,
    aviso_fallo: motivos.get(d.usuarioId) ?? null,
  }));
  if (filasDeMenciones.length > 0) {
    const { error: errorDeMenciones } = await admin
      .from("mensajes_menciones")
      .insert(filasDeMenciones);
    if (errorDeMenciones) {
      // El mensaje queda —no se borra nada de este hilo— pero nadie fue
      // avisado, y eso hay que decirlo: no es un éxito.
      return NextResponse.json(
        {
          error:
            "El mensaje se guardó, pero no se pudieron guardar las menciones: " +
            `a nadie se le avisó. ${errorDeMenciones.message}`,
          mensaje_guardado: true,
          id_del_mensaje: guardado.id,
        },
        { status: 500 }
      );
    }
  }

  // 3. Los correos, después de responder.
  if (aEnviar.length > 0) {
    const mensajeId = guardado.id as string;
    // `urlBase` y no `process.env` a mano: lo que lleva el correo es un enlace,
    // y uno relativo no lleva a ningún lado.
    const dondeVerlo = `${urlBase(request)}${entidad.ruta(id, numero)}`;
    const quienes = aEnviar;
    after(async () => {
      await Promise.all(
        quienes.map(async (d) => {
          let cambio: { avisado_en: string } | { aviso_fallo: string };
          try {
            const correo = correoPorMencion({
              autor,
              queEs: queEs(tipo, numero),
              texto,
              dondeVerlo,
              hiloId: `${tipo}:${id}`,
            });
            const { estado, detalle } = await enviarCorreo({ para: d.email as string, ...correo });
            cambio =
              estado === "enviado" ? { avisado_en: new Date().toISOString() }
              // Entre la comprobación de arriba y este momento pudo cambiar.
              : estado === "sin-configurar" ? { aviso_fallo: MOTIVO_SIN_CONFIGURAR }
              // Lo que dijo el servicio, sin traducir: es lo que distingue un
              // dominio rechazado de un cupo agotado. El texto fijo es sólo
              // para cuando no dijo nada.
              : { aviso_fallo: detalle?.trim() || MOTIVO_EL_SERVICIO_FALLO };
          } catch (e) {
            // `enviarCorreo` no lanza, pero armar el correo sí podría. Si esto
            // saliera sin anotar nada, la mención quedaría «pendiente» para
            // siempre y quien escribió creería que el aviso está en camino.
            cambio = { aviso_fallo: `No se pudo armar el correo: ${(e as Error).message}` };
          }

          // Anotar es lo que le da sentido a la columna, así que se reintenta
          // una vez: si el correo ya salió y este `update` falla, la mención
          // queda «pendiente» y quien escribió no se entera de nada.
          let ultimoError = "";
          for (let intento = 0; intento < 2; intento++) {
            try {
              const { error } = await admin
                .from("mensajes_menciones")
                .update(cambio)
                .eq("mensaje_id", mensajeId)
                .eq("usuario_id", d.usuarioId);
              if (!error) return;
              ultimoError = error.message;
            } catch (e) {
              ultimoError = (e as Error).message;
            }
          }
          // Sin salida: después de los dos intentos sólo queda el registro del
          // servidor. Está dicho en el docstring del POST.
          console.error(
            "mensajes: no se pudo anotar el aviso (la mención queda pendiente)",
            mensajeId, d.usuarioId, JSON.stringify(cambio), ultimoError
          );
        })
      );
    });
  }

  // Lo que se devuelve sale de la misma función que arma el GET, así el mensaje
  // que uno acaba de escribir se ve igual que al recargar el hilo.
  const mensaje = darFormaAlMensaje(
    {
      ...guardado,
      autor: { nombre: autor },
      menciones: destinatarios.map((d) => ({
        usuario_id: d.usuarioId,
        leido_en: null,
        avisado_en: null,
        aviso_fallo: motivos.get(d.usuarioId) ?? null,
        usuario: { nombre: nombres.get(d.usuarioId) ?? "" },
      })),
    },
    user.id
  );

  return NextResponse.json({
    data: mensaje,
    // Para que la pantalla no afirme lo que no pasó: cuántos correos se van a
    // intentar y a quiénes no se les va a mandar, con el motivo.
    correo_configurado: configurado,
    avisos: {
      se_intentan: aEnviar.length,
      sin_aviso: sinAviso.map((s) => ({
        usuario_id: s.usuarioId,
        nombre: nombres.get(s.usuarioId) ?? null,
        motivo: s.motivo,
      })),
    },
  });
}
