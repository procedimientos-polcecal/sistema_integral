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
 * ## Si no se pudo averiguar el permiso, es un 503
 *
 * Seguridad e Higiene distingue «no tiene permiso» de «no se pudo averiguar», y
 * esta ruta también: una caída de la base contestada con un 403 le diría a
 * alguien que no puede ver algo que sí puede.
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

  try {
    if (!(await entidad.puedeVerlo(admin, user.id))) {
      return NextResponse.json({ error: "Sin permisos para ver este registro" }, { status: 403 });
    }

    const [filas, numeros] = await Promise.all([
      traerTodo<FilaDeMensaje>((desde, hasta) =>
        admin
          .from("mensajes")
          // La cadena va literal, en una sola línea: partida con `+` o armada
          // en una variable, Supabase pierde la inferencia de tipos.
          .select("id, texto, creado_en, creado_por, autor:usuarios(nombre, apellido), menciones:mensajes_menciones(usuario_id, leido_en, avisado_en, aviso_fallo, usuario:usuarios(nombre, apellido))")
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
      data: filas.map((f) => darFormaAlMensaje(f, user.id)),
    });
  } catch (e) {
    console.error("mensajes: no se pudo leer el hilo", (e as Error).message);
    return NextResponse.json({ error: SIN_PERMISO }, { status: 503 });
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
 * **Cada mención termina con una de las dos anotadas, o con ninguna sólo si el
 * `after()` no llegó a correr.** A las que se sabe de antemano que no se van a
 * intentar —no hay correo configurado, la persona no tiene correo— se les
 * escribe el motivo al guardarlas y no en el `after()`: así no hay una ventana
 * en la que «no correspondía» se parezca a «todavía no salió».
 *
 * **El autor no se menciona a sí mismo**: si viene en la lista se descarta sin
 * guardarlo, y no es un error. Su bandeja se llenaría con todo lo que escribe.
 *
 * **Los mencionados se vuelven a comprobar acá** y no se confía en la lista
 * que armó el navegador, que puede estar vieja. Alguien que ya no está activo,
 * o que ya no puede ver el registro, **rechaza el pedido entero**, antes de
 * guardar nada: guardar el mensaje sin esa mención dejaría a quien escribe
 * creyendo que avisó, que es justo lo que esta feature no puede permitir.
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
        return NextResponse.json(
          {
            error:
              "Alguna de las personas mencionadas ya no está activa. " +
              "Actualizá la lista y volvé a probar: el mensaje no se guardó.",
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
              `${quienes} no puede ver este registro, así que no se le puede mencionar. ` +
              "Sacalo de la lista y volvé a probar: el mensaje no se guardó.",
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
    return NextResponse.json(
      { error: errorDelMensaje?.message ?? "No se pudo guardar el mensaje" },
      { status: 400 }
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

          const { error } = await admin
            .from("mensajes_menciones")
            .update(cambio)
            .eq("mensaje_id", mensajeId)
            .eq("usuario_id", d.usuarioId);
          if (error) console.error("mensajes: no se pudo anotar el aviso", error.message);
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
