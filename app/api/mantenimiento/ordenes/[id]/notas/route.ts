import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento, puedeVerMantenimiento } from "@/lib/mantenimiento/auth";
import { escribirEnLaFilaDeLaOT } from "@/lib/mantenimiento/planillaDeOT";
import {
  validarNota, laUltimaNota, celdaDeObservacionPrevia,
} from "@/lib/mantenimiento/notas";
import { esCancelacion } from "@/lib/mantenimiento/cancelacion";

/**
 * Por qué una orden de trabajo todavía no se hizo.
 *
 * Es un historial: cada justificación queda con quién la escribió y cuándo, y
 * no se edita. A la planilla —columna X, que tiene una celda y no una lista— va
 * siempre **la última**, porque lo que le sirve a quien la mira es por qué está
 * parada hoy.
 *
 * La distinción que importa: la columna W es lo que se encontró **al hacer** el
 * trabajo y la escribe el registro de la ejecución. Ésta es la de antes.
 *
 * ── POR QUÉ ACÁ EL FALLO VA A LA PANTALLA Y NO A LA COLA ────────────────────
 *
 * Es la excepción a «toda ruta que toque un campo que se exporta tiene que
 * exportar, y si no puede, dejar el pendiente anotado», así que va escrito.
 * Revisado el 26/10/2026, cuando se buscaron las rutas con el agujero del
 * PATCH de OT.
 *
 * **No hay nada que proteger.** `sheets_pendiente` sirve para dos cosas, y la
 * que importa es que la importación saltee esa orden para no pisarla. Acá no
 * hace falta: `filaDeOrden` **no lee la columna X** —su mapa llega hasta la
 * 23 pero sólo toma hasta `proxima_fecha`—, así que ninguna sincronización
 * puede borrar una justificación. La nota vive en `ordenes_trabajo_notas` y de
 * ahí no se mueve; lo único que queda desactualizado es la celda.
 *
 * **Y la cola no la puede rehacer entera.** `exportarLoPendiente` arma el
 * registro desde la fila de `ordenes_trabajo` con `loQueHayQueExportar`, y la
 * observación previa no tiene columna ahí. Se podría ir a buscar la última
 * nota, y eso cubriría el POST — pero no el DELETE, que tiene que **vaciar**
 * la celda cuando se borró la única justificación. La cola no sabe vaciar a
 * propósito: su regla es que lo vacío no viaja, justamente para no borrar
 * celdas que nadie llenó. Hacerle una excepción a la X sólo es seguro mientras
 * nadie la escriba a mano, y nada avisaría el día que eso cambie.
 *
 * Que hoy nadie la escribe está medido, y por eso esto es una decisión y no
 * una sospecha: de las 2.291 filas del master, **13 tienen texto en la X y son
 * exactamente las 13 notas del sistema** — cero escritas a mano allá, cero sin
 * llegar desde acá.
 *
 * Así que el error va a `planilla_error`, que es quien puede hacer algo:
 * volver a guardar la justificación la reescribe.
 */

type Params = { params: Promise<{ id: string }> };

/** GET — las justificaciones de la orden, de la más nueva a la más vieja. */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeVerMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  // Con el cliente admin, y el permiso comprobado arriba. Con el de la sesión,
  // `usuarios` sólo deja leer la fila propia —la policy es `id = auth.uid() or
  // es_admin()`—, así que el nombre del autor volvía en null para todas las
  // notas menos las de uno mismo. Una justificación sin autor no sirve: lo que
  // se quiere saber es quién la dio.
  //
  // La cadena del `select` va literal y repetida en el POST: armada en una
  // variable y reusada, Supabase pierde la inferencia de tipos.
  const { data, error } = await createAdminClient()
    .from("ordenes_trabajo_notas")
    .select("id, texto, creado_en, creado_por, autor:usuarios(nombre)")
    .eq("orden_id", id)
    .order("creado_en", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

/** POST — agregar una justificación. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Justificar una OT requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const texto = validarNota(body?.texto);
  if (!texto.ok) return NextResponse.json({ error: texto.error }, { status: 400 });

  const admin = createAdminClient();

  // La orden primero: hace falta su fila de la planilla, y de paso un id
  // inventado no inserta una nota colgando de la nada.
  const { data: orden, error: errorOrden } = await admin
    .from("ordenes_trabajo")
    .select("id, ot_number, sheets_row")
    .eq("id", id)
    .single();

  if (errorOrden || !orden) {
    return NextResponse.json({ error: "No existe esa orden de trabajo" }, { status: 404 });
  }

  const { data, error } = await admin
    .from("ordenes_trabajo_notas")
    .insert({ orden_id: id, texto: texto.texto, creado_por: user.id })
    .select("id, texto, creado_en, creado_por, autor:usuarios(nombre)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // La que acaba de entrar es la última por definición, así que va derecho a la
  // celda sin volver a leer el historial.
  const planilla_error = await escribirEnLaFilaDeLaOT(
    orden, [celdaDeObservacionPrevia(texto.texto)]
  );

  return NextResponse.json({ data, planilla_error });
}

/**
 * DELETE ?nota= — sacar una justificación.
 *
 * Sólo la propia, y la comprobación es del `delete` mismo —`creado_por` en el
 * filtro— y no un `if` previo: entre leer y borrar hay una ventana, y además
 * así la regla queda escrita una sola vez, igual que en la policy.
 *
 * Después se reescribe la celda con la que quedó siendo la última. Borrar sin
 * eso dejaría la planilla mostrando una justificación que en el sistema ya no
 * existe, que es exactamente la divergencia que no avisa.
 *
 * ── LA JUSTIFICACIÓN DE UNA OT CANCELADA NO SE BORRA ────────────────────────
 *
 * Cancelar exige una justificación (PATCH de `ordenes`), y sin este corte ese
 * requisito tiene una puerta de atrás: cancelo con motivo, borro la nota, y
 * queda una orden cancelada sin razón escrita en ningún lado —con la columna X
 * mostrando, además, la justificación anterior, que habla de otra cosa—.
 *
 * Es una regla sobre la orden y no sobre el autor, así que **no va en el filtro
 * del `delete`** —ése es de `creado_por` y se queda así—: es una lectura aparte
 * que rechaza, y va **antes** del `delete` para que no se borre nada que después
 * haya que reponer. Contesta 409 y no 400: el pedido está bien formado, choca
 * con el estado de la orden.
 *
 * No se pierde nada con negarlo. Corregir una justificación sigue pudiendo: se
 * escribe otra, que pasa a ser la última y viaja a la columna X. Lo que deja de
 * poderse es borrar —cualquiera, aunque haya varias— y con eso quedar con cero;
 * el mensaje dice qué hacer en vez de sólo recibir un no.
 *
 * Por qué no las dos alternativas:
 * - **Marcar la nota de la cancelación** para proteger sólo esa contradice lo
 *   decidido para esta función, que es no marcar ninguna: las notas son un
 *   historial plano y gana la más nueva.
 * - **Auditar** la cancelación con `auditar()` pediría un décimo verbo en
 *   `ACCIONES` (`lib/core/auditoria.ts`), una lista cerrada, o sea una segunda
 *   migración para registrar algo que la nota ya dice mejor y en el lugar donde
 *   se lo busca.
 *
 * Lo que el corte no cubre: la protección es por el estado **de ahora**. Si la
 * orden sale de CANCELADA, sus notas vuelven a poderse borrar.
 */
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const nota = new URL(request.url).searchParams.get("nota");
  if (!nota) return NextResponse.json({ error: "Falta la nota" }, { status: 400 });

  const admin = createAdminClient();

  // Si no se puede leer el estado no se sigue: borrar a ciegas es justo lo que
  // este corte existe para evitar. Una orden que no existe pasa de largo y la
  // frena el `delete` de abajo, que no encuentra la nota.
  const { data: ordenActual, error: errorEstado } = await admin
    .from("ordenes_trabajo")
    .select("estado")
    .eq("id", id)
    .maybeSingle();

  if (errorEstado) return NextResponse.json({ error: errorEstado.message }, { status: 500 });

  if (esCancelacion(ordenActual?.estado)) {
    return NextResponse.json(
      {
        error:
          "La justificación de una orden cancelada no se borra: es lo único que dice por qué " +
          "no se hizo. Para corregirla, escribí otra: pasa a ser la última y es la que va a la planilla.",
      },
      { status: 409 }
    );
  }

  const { data: borradas, error } = await admin
    .from("ordenes_trabajo_notas")
    .delete()
    .eq("id", nota)
    .eq("orden_id", id)
    .eq("creado_por", user.id)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Cero filas es "no era tuya" o "no existe", y las dos se contestan igual:
  // decir cuál de las dos es contaría qué notas hay y de quién son.
  if (!borradas?.length) {
    return NextResponse.json(
      { error: "Sólo se puede borrar una justificación propia" },
      { status: 403 }
    );
  }

  const { data: orden } = await admin
    .from("ordenes_trabajo")
    .select("id, ot_number, sheets_row")
    .eq("id", id)
    .single();

  const { data: quedan } = await admin
    .from("ordenes_trabajo_notas")
    .select("id, texto, creado_en")
    .eq("orden_id", id);

  const ultima = laUltimaNota(quedan ?? []);
  const planilla_error = orden
    ? await escribirEnLaFilaDeLaOT(orden, [celdaDeObservacionPrevia(ultima?.texto ?? null)])
    : null;

  return NextResponse.json({ ok: true, planilla_error });
}
