import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tieneAccesoCompras } from "@/lib/compras/auth";
import { traerTodo } from "@/lib/core/paginado";
import { escribirEnLaFilaDeLaOT } from "@/lib/mantenimiento/planillaDeOT";
import { avisarAUnaPersona } from "@/lib/core/avisoAUnaPersona";
import { validarNota, celdaDeObservacionPrevia } from "@/lib/mantenimiento/notas";
import {
  preguntasAbiertas, type NotaDeLaOT,
} from "@/lib/mantenimiento/consultaDeRepuesto";
import {
  bandejaDeConsultas, puedeResponderConsulta, aQuienAvisarDeLaRespuesta,
  avisoDeLaRespuesta, TIPOS_QUE_DECIDEN_SI_UNA_PREGUNTA_ESPERA,
  type NotaDeLaBandeja, type OrdenConsultada, type RepuestoConsultado,
} from "@/lib/compras/consultas";
import type { ResultadoDelAviso } from "@/lib/core/avisoAlInstante";

/**
 * Las preguntas que Mantenimiento le hizo a Compras por un repuesto, y la forma de
 * contestarlas.
 *
 * El diseño está en
 * docs/superpowers/specs/2026-10-26-mantenimiento-preguntar-a-compras-design.md, y
 * la decisión que explica que esta ruta exista es: **quien compra no entra a
 * Mantenimiento.** Pedirle que abra una OT para contestar es pedirle que cambie de
 * módulo para una tarea de treinta segundos, y eso es lo que hace que la respuesta
 * no llegue nunca. Así que el dato vive donde se consulta —el historial de la OT— y
 * la escritura ocurre donde está la persona.
 *
 * ── QUIÉN PUEDE, Y POR QUÉ NO ALCANZA CON LA RLS ─────────────────────────────
 *
 * Contestar pide **acceso a Compras, con cualquier nivel**, y nada de
 * Mantenimiento: la regla la nombra `puedeResponderConsulta`. Las dos lecturas y la
 * escritura van con el **cliente admin**, así que la RLS no corre y el permiso hay
 * que comprobarlo acá:
 *
 *  - `ordenes_trabajo_notas` sólo la lee quien tiene Mantenimiento, y quien contesta
 *    no lo tiene;
 *  - el nombre de quien preguntó sale de un embed a `usuarios`, cuya policy es
 *    `id = auth.uid() or es_admin()`: con el cliente de sesión volvería null para
 *    todos menos para uno mismo, y una pregunta sin autor no se puede contestar bien.
 *
 * Es el mismo camino —y el mismo cuidado— que la ruta de notas de la OT.
 */

/** De a cuántos ids se pide: un `.in()` con muchos arma una URL que PostgREST rechaza. */
const LOTE = 200;

/**
 * GET — la bandeja: las preguntas que todavía esperan respuesta.
 *
 * Trae las notas que pueden abrir o cerrar una pregunta, las órdenes de esas notas y
 * los repuestos por los que se pregunta, y deja que `bandejaDeConsultas` decida: es
 * la única que sabe juntar las notas de cada orden con **su** estado, que es donde
 * esto se equivoca en silencio.
 *
 * Las tres lecturas van paginadas con `traerTodo`. Hoy son pocas filas, pero esta
 * bandeja crece con cada pregunta que se hace y PostgREST corta en 1000 sin avisar:
 * una bandeja que se topa con el tope esconde justamente las más viejas.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await tieneAccesoCompras(supabase, user.id))) {
    return NextResponse.json(
      { error: "Las consultas de repuestos las ve quien tiene acceso a Compras" },
      { status: 403 }
    );
  }

  const admin = createAdminClient();

  try {
    /*
     * El historial entero no: sólo lo que puede abrir o cerrar una pregunta. La
     * lista es `TIPOS_QUE_DECIDEN_SI_UNA_PREGUNTA_ESPERA`, que está en `lib/` con el
     * test que sostiene la afirmación.
     *
     * **Las columnas no son decoración.** Sin `orden_id` ninguna nota se agrupa con
     * su orden; sin `tipo`, `repuesto_id` o `responde_a`, `preguntasAbiertas`
     * devuelve `[]`. En los dos casos la bandeja sale vacía **sin un solo error**, y
     * eso se lee igual que «no hay nada que contestar». El select va literal y
     * repetido —armado en una variable, Supabase pierde la inferencia de tipos— y
     * hay un test que lo mira columna por columna.
     */
    const notas = (await traerTodo((desde, hasta) =>
      admin
        .from("ordenes_trabajo_notas")
        .select("id, orden_id, tipo, texto, creado_en, creado_por, repuesto_id, responde_a, autor:usuarios(nombre)")
        .in("tipo", [...TIPOS_QUE_DECIDEN_SI_UNA_PREGUNTA_ESPERA])
        .range(desde, hasta)
    )) as unknown as NotaDeLaBandeja[];

    // Las órdenes de **todas** las notas que vinieron, no de las que parecen
    // abiertas: una nota sin su orden se descarta, y cuál sigue esperando todavía no
    // se sabe. El filtro es por id y de a lotes, que es lo que el repo hace con los
    // `.in()` grandes.
    const idsDeOrdenes = [...new Set(notas.map((n) => n.orden_id))];
    const ordenes: OrdenConsultada[] = [];
    for (let i = 0; i < idsDeOrdenes.length; i += LOTE) {
      const lote = idsDeOrdenes.slice(i, i + LOTE);
      ordenes.push(
        ...((await traerTodo((desde, hasta) =>
          admin
            .from("ordenes_trabajo")
            .select("id, ot_number, descripcion, estado")
            .in("id", lote)
            .range(desde, hasta)
        )) as unknown as OrdenConsultada[])
      );
    }

    const idsDeRepuestos = [...new Set(notas.map((n) => n.repuesto_id).filter(Boolean))];
    const repuestos: RepuestoConsultado[] = [];
    for (let i = 0; i < idsDeRepuestos.length; i += LOTE) {
      const lote = idsDeRepuestos.slice(i, i + LOTE);
      repuestos.push(
        ...((await traerTodo((desde, hasta) =>
          admin
            .from("ordenes_trabajo_repuestos")
            .select("id, nombre, codigo")
            .in("id", lote)
            .range(desde, hasta)
        )) as unknown as RepuestoConsultado[])
      );
    }

    return NextResponse.json({ data: bandejaDeConsultas(notas, ordenes, repuestos) });
  } catch (e) {
    // `traerTodo` tira cuando la base contesta un error. Se devuelve el mensaje tal
    // cual: una bandeja vacía por un fallo se lee igual que una sin pendientes.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

/** Lo mismo que contesta la ruta cuando la pregunta ya no espera: una pantalla vieja. */
const YA_NO_ESTA_ABIERTA =
  "Esa consulta ya no está abierta: la contestaron, le dieron seguimiento, la orden " +
  "ya no espera nada o sacaron el repuesto de la lista. Recargá la bandeja para verlo.";

/**
 * POST — contestar una consulta: `{ pregunta_id, texto }`.
 *
 * Devuelve `{ data, planilla_error, aviso }`. La respuesta se guarda como una fila
 * `tipo: "RESPUESTA"` del historial de **esa** orden, con `responde_a` apuntando a la
 * pregunta y sin repuesto —el repuesto es el de la pregunta—.
 *
 * Tres cosas pasan después de guardar, y en este orden:
 *
 *  1. **Se escribe la columna X de la planilla.** La respuesta de Compras **es** la
 *     justificación vigente de por qué la OT sigue abierta —«el proveedor lo entrega
 *     el jueves» es la razón—, y la regla de la casa es que toda ruta que toque un
 *     campo que se exporta tiene que exportar. El texto pasa por `textoParaLaCelda`
 *     dentro de `celdaDeObservacionPrevia`: la planilla escribe con USER_ENTERED y
 *     una respuesta que arrancara con `=` entraría como fórmula. Si falla, el motivo
 *     vuelve en `planilla_error` y la pantalla lo muestra: un fallo de escritura
 *     nunca es un `console.warn`.
 *  2. **Se le avisa a quien preguntó**, con un push a una sola persona. Las dos
 *     condiciones las resuelve `aQuienAvisarDeLaRespuesta` y la ruta **no las
 *     repite**: pide el destinatario y, si viene `null`, no avisa.
 *  3. **Nada de eso puede voltear la respuesta.** Cuando se llega ahí ya está
 *     guardada, así que el envío va en un `try/catch` que no relanza. `avisarAUnaPersona`
 *     promete no tirar, pero que esta ruta no rompa no puede depender de cómo esté
 *     escrita otra: lo único que queda de un fallo es el `motivo` que vuelve acá.
 *
 * Lo que se rechaza y por qué lo deciden `preguntasAbiertas` y
 * `puedeResponderConsulta`, con sus tests en `lib/`. Un 409 es «estuvo bien y ya no»
 * —una pantalla vieja— y la bandeja tiene que recargar; un 400 es que lo pedido está
 * mal dicho.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const accesoCompras = await tieneAccesoCompras(supabase, user.id);
  if (!accesoCompras) {
    return NextResponse.json(
      { error: "Contestar una consulta de repuestos requiere acceso a Compras" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);

  const preguntaId = typeof body?.pregunta_id === "string" ? body.pregunta_id.trim() : "";
  if (!preguntaId) {
    return NextResponse.json({ error: "Falta decir qué consulta se contesta." }, { status: 400 });
  }

  /*
   * El texto se valida con `validarNota`, que es la regla de la casa para lo que
   * termina en la celda X —el tope de 1000 caracteres es el de la celda, no el de la
   * base—. Lo único propio es el mensaje de «no escribiste nada»: el suyo dice «falta
   * decir por qué no se hizo», que es lo correcto del lado de Mantenimiento y no acá.
   * El del largo se deja como está: nombra el límite y lo que se escribió, que es la
   * información que importa.
   */
  const escrito = typeof body?.texto === "string" ? body.texto.trim() : "";
  if (!escrito) {
    return NextResponse.json({ error: "Falta escribir la respuesta." }, { status: 400 });
  }
  const texto = validarNota(escrito);
  if (!texto.ok) return NextResponse.json({ error: texto.error }, { status: 400 });

  const admin = createAdminClient();

  const { data: pregunta } = await admin
    .from("ordenes_trabajo_notas")
    .select("id, orden_id, tipo, texto, creado_en, creado_por, repuesto_id, responde_a")
    .eq("id", preguntaId)
    .maybeSingle();

  if (!pregunta) {
    return NextResponse.json({ error: "Esa consulta no existe." }, { status: 404 });
  }

  // La orden de **esa** pregunta: de su estado depende que todavía espere, y de su
  // número, la fila de la planilla y el enlace del push.
  const { data: orden } = await admin
    .from("ordenes_trabajo")
    .select("id, ot_number, estado")
    .eq("id", pregunta.orden_id)
    .maybeSingle();

  if (!orden) {
    return NextResponse.json({ error: "No existe la orden de esa consulta." }, { status: 404 });
  }

  // El historial de esa orden, que es lo que dice si la pregunta sigue abierta: su
  // respuesta y su seguimiento están en otras filas. Es de UNA orden, así que ni se
  // pagina ni crece con los años —igual que en la ruta de notas—.
  const { data: notas, error: errorNotas } = await admin
    .from("ordenes_trabajo_notas")
    .select("id, tipo, texto, creado_en, creado_por, repuesto_id, responde_a")
    .eq("orden_id", pregunta.orden_id);

  if (errorNotas) return NextResponse.json({ error: errorNotas.message }, { status: 500 });

  const abierta =
    preguntasAbiertas((notas ?? []) as NotaDeLaOT[], orden.estado as string | null)
      .find((p) => p.id === preguntaId) ?? null;

  /*
   * El portón. Hay que tener acceso a Compras —comprobado arriba, así que a quien no
   * lo tiene se le contesta 403 sin leer nada— y la pregunta tiene que seguir
   * abierta; las dos las nombra `puedeResponderConsulta`. El `abierta === null` de
   * adelante **no es una segunda comprobación**: es lo que el compilador necesita
   * para saber que abajo hay una pregunta, porque la función devuelve un boolean y
   * no estrecha el tipo.
   */
  if (abierta === null || !puedeResponderConsulta({ accesoCompras }, abierta)) {
    return NextResponse.json({ error: YA_NO_ESTA_ABIERTA }, { status: 409 });
  }

  const { data, error } = await admin
    .from("ordenes_trabajo_notas")
    .insert({
      orden_id: orden.id,
      texto: texto.texto,
      creado_por: user.id,
      tipo: "RESPUESTA",
      // El repuesto es el de la pregunta: repetirlo sería un segundo dato, y además
      // `leerNotaNueva` lo prohíbe del otro lado.
      repuesto_id: null,
      responde_a: abierta.id,
    })
    .select("id, tipo, texto, creado_en, creado_por, repuesto_id, responde_a")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // La que acaba de entrar es la última por definición, así que va derecho a la celda
  // sin volver a leer el historial.
  const planilla_error = await escribirEnLaFilaDeLaOT(orden, [celdaDeObservacionPrevia(texto.texto)]);

  const aQuien = aQuienAvisarDeLaRespuesta(abierta, { id: user.id });
  let aviso: ResultadoDelAviso | null = null;

  if (aQuien) {
    try {
      // El repuesto, sólo para nombrarlo en el push. Si no se pudo leer, el aviso
      // sale igual nombrando la orden: un push sin la pieza sirve, uno que no sale
      // no. `repuesto_id` nunca es null en una pregunta abierta —una a cuyo repuesto
      // sacaron ya no está abierta—, y el `?? ""` es por si el select no lo trajo.
      const { data: repuesto } = await admin
        .from("ordenes_trabajo_repuestos")
        .select("id, nombre, codigo")
        .eq("id", abierta.repuesto_id ?? "")
        .maybeSingle();

      aviso = await avisarAUnaPersona(admin, {
        usuarioId: aQuien,
        aviso: avisoDeLaRespuesta(orden, repuesto as { nombre: string } | null, texto.texto),
      });
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      console.error("consultas de Compras: no se pudo avisar de la respuesta", motivo);
      aviso = { enviadas: 0, personas: 0, motivo };
    }
  }

  return NextResponse.json({ data, planilla_error, aviso });
}
