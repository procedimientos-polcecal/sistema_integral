import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento, puedeVerMantenimiento } from "@/lib/mantenimiento/auth";
import { escribirEnLaFilaDeLaOT } from "@/lib/mantenimiento/planillaDeOT";
import { avisarAQuienDecide } from "@/lib/core/avisoAlInstante";
import {
  validarNota, laUltimaNota, celdaDeObservacionPrevia,
} from "@/lib/mantenimiento/notas";
import {
  leerNotaNueva, comprobarNotaNueva, itemDeLaConsulta, errorDeBorrarNota,
  NOMBRE_DE_LA_CONSULTA, URL_DE_LAS_CONSULTAS,
  type NotaDeLaOT, type RepuestoDeLaOT,
} from "@/lib/mantenimiento/consultaDeRepuesto";

/**
 * Por qué una orden de trabajo todavía no se hizo, y lo que Mantenimiento le
 * preguntó a Compras al respecto.
 *
 * Es un historial: cada entrada queda con quién la escribió y cuándo, y no se
 * edita. A la planilla —columna X, que tiene una celda y no una lista— va
 * siempre **la última**, **sea del tipo que sea**: lo que le sirve a quien la
 * mira es por qué está parada hoy, y «preguntamos a Compras y esperamos» es una
 * razón válida.
 *
 * Las entradas son de tres tipos (`tipo`). Una JUSTIFICACION es lo de siempre.
 * Una PREGUNTA es lo que Mantenimiento le pregunta a Compras por un repuesto de
 * la orden, e interrumpe a quien contesta con un push. Una RESPUESTA contesta
 * una PREGUNTA, y la escribe quien contesta —desde Compras— o quien preguntó,
 * cuando el repuesto ya llegó. Si una pregunta sigue esperando no se guarda: se
 * deriva de las filas, en `consultaDeRepuesto.ts`.
 *
 * La distinción que importa: la columna W es lo que se encontró **al hacer** el
 * trabajo y la escribe el registro de la ejecución. Ésta es la de antes.
 */

type Params = { params: Promise<{ id: string }> };

/** GET — el historial de la orden, de la más nueva a la más vieja. */
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
  //
  // **`tipo`, `repuesto_id` y `responde_a` no son decoración**: de ahí lee
  // `preguntasAbiertas`, en el navegador. Sin `tipo` nada se reconoce como una
  // pregunta y la función devuelve `[]` para todo —ninguna pregunta aparece
  // abierta, ningún botón ofrece seguirla, ninguna dice «sin respuesta»— **sin un
  // solo error**: es el peor modo de fallar que tiene esto, porque se ve igual
  // que una orden sin preguntas. Si alguna vez se agrega otra columna al tipo
  // `NotaDeLaOT`, se agrega acá y en el `select` del POST.
  const { data, error } = await createAdminClient()
    .from("ordenes_trabajo_notas")
    .select("id, tipo, texto, creado_en, creado_por, repuesto_id, responde_a, autor:usuarios(nombre)")
    .eq("orden_id", id)
    .order("creado_en", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

/**
 * POST — agregar una entrada al historial: `{ texto, tipo?, repuesto_id?, responde_a? }`.
 *
 * Sin `tipo` es una justificación, que es lo único que mandaba la pantalla hasta
 * ahora. Devuelve `{ data, planilla_error, aviso }`: `aviso` es lo que contestó
 * `avisarAQuienDecide` cuando la entrada es una pregunta, y `null` en cualquier
 * otro caso.
 *
 * **Preguntar pide lo mismo que justificar** —nivel de edición en Mantenimiento—
 * y no lo que pide «Pedir a Compras», que no exige nada. Es la decisión del
 * diseño: preguntar escribe en el historial de la OT e interrumpe a una persona
 * nombrada, y se acepta que quien sólo mira vea que falta la pieza y no pueda
 * preguntar, a cambio de controlar quién interrumpe.
 *
 * Lo que se comprueba de una pregunta o una respuesta está en
 * `comprobarNotaNueva`, con el porqué de cada regla y sus tests: que el repuesto y
 * la nota a la que apunta sean **de esta orden** —sin cascade, una que apuntara a
 * otra traba el borrado de esa otra, y el borrado de espejo borra OT de a 200—, y
 * que no haya dos preguntas abiertas por el mismo repuesto aunque la pantalla esté
 * vieja. Una justificación no lee nada más que la orden, como siempre.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Escribir en el historial de una OT requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const texto = validarNota(body?.texto);
  if (!texto.ok) return NextResponse.json({ error: texto.error }, { status: 400 });

  const nueva = leerNotaNueva(body);
  if (!nueva.ok) return NextResponse.json({ error: nueva.error }, { status: nueva.status });

  const admin = createAdminClient();

  // La orden primero: hace falta su fila de la planilla, y de paso un id
  // inventado no inserta una nota colgando de la nada. El estado es para saber si
  // todavía espera algo.
  const { data: orden, error: errorOrden } = await admin
    .from("ordenes_trabajo")
    .select("id, ot_number, sheets_row, estado")
    .eq("id", id)
    .single();

  if (errorOrden || !orden) {
    return NextResponse.json({ error: "No existe esa orden de trabajo" }, { status: 404 });
  }

  // Sólo una pregunta o una respuesta se refiere a algo, y sólo ellas necesitan
  // leer el resto de la orden: una justificación sigue costando lo que costaba.
  // Las dos lecturas son de UNA orden, así que ni se pagina ni crece con los años.
  let repuesto: RepuestoDeLaOT | null = null;

  if (nueva.nota.tipo !== "JUSTIFICACION") {
    const [leidasLasNotas, leidosLosRepuestos] = await Promise.all([
      admin
        .from("ordenes_trabajo_notas")
        .select("id, tipo, texto, creado_en, creado_por, repuesto_id, responde_a")
        .eq("orden_id", id),
      admin
        .from("ordenes_trabajo_repuestos")
        .select("id, nombre, codigo")
        .eq("work_order_id", id),
    ]);

    const falloLaLectura = leidasLasNotas.error ?? leidosLosRepuestos.error;
    if (falloLaLectura) {
      return NextResponse.json({ error: falloLaLectura.message }, { status: 500 });
    }

    const veredicto = comprobarNotaNueva(nueva.nota, {
      estadoDeLaOrden: orden.estado,
      notas: (leidasLasNotas.data ?? []) as NotaDeLaOT[],
      repuestos: (leidosLosRepuestos.data ?? []) as RepuestoDeLaOT[],
    });
    if (!veredicto.ok) {
      return NextResponse.json({ error: veredicto.error }, { status: veredicto.status });
    }
    repuesto = veredicto.repuesto;
  }

  const { data, error } = await admin
    .from("ordenes_trabajo_notas")
    .insert({
      orden_id: id,
      texto: texto.texto,
      creado_por: user.id,
      tipo: nueva.nota.tipo,
      repuesto_id: nueva.nota.repuesto_id,
      responde_a: nueva.nota.responde_a,
    })
    .select("id, tipo, texto, creado_en, creado_por, repuesto_id, responde_a, autor:usuarios(nombre)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // La que acaba de entrar es la última por definición, así que va derecho a la
  // celda sin volver a leer el historial. Va sea del tipo que sea: una pregunta
  // ES una razón válida de por qué la OT sigue abierta, y la respuesta de
  // Compras pasa a ser la vigente. El texto pasa por `textoParaLaCelda` dentro de
  // `celdaDeObservacionPrevia`, porque la planilla escribe con USER_ENTERED y una
  // pregunta que arrancara con `=` entraría como fórmula.
  const planilla_error = await escribirEnLaFilaDeLaOT(
    orden, [celdaDeObservacionPrevia(texto.texto)]
  );

  // El aviso va al final, con todo ya guardado y escrito: `avisarAQuienDecide` no
  // tira, así que un push service caído no voltea una pregunta que ya está en el
  // historial. Y lo que contesta **vuelve a la pantalla**: con la lista de
  // `compras_consultados` vacía la pregunta se guarda igual y no interrumpe a
  // nadie, y eso tiene que verse y no fallar en silencio.
  //
  // `excepto` es quien pregunta: si también está en la lista, no se le avisa de
  // lo que acaba de escribir.
  const aviso = nueva.nota.tipo === "PREGUNTA" && repuesto
    ? await avisarAQuienDecide(admin, {
        lista: "compras_consultados",
        items: [itemDeLaConsulta(orden, repuesto)],
        nombre: NOMBRE_DE_LA_CONSULTA,
        url: URL_DE_LAS_CONSULTAS,
        excepto: user.id,
      })
    : null;

  return NextResponse.json({ data, planilla_error, aviso });
}

/**
 * DELETE ?nota= — sacar una entrada.
 *
 * Sólo la propia, y la comprobación es del `delete` mismo —`creado_por` en el
 * filtro— y no un `if` previo: entre leer y borrar hay una ventana, y además
 * así la regla queda escrita una sola vez, igual que en la policy.
 *
 * **Una entrada a la que otra apunta no se borra**: `responde_a` no tiene
 * cascade, y es lo que impide que quien preguntó se lleve puesta la respuesta de
 * Compras borrando su pregunta. La base se niega con 23503 y acá se traduce a un
 * 409 que se entienda (`errorDeBorrarNota`). Una respuesta suelta sí se puede
 * borrar, y reabre su pregunta: «abierta» se deriva de las filas.
 *
 * Después se reescribe la celda con la que quedó siendo la última. Borrar sin
 * eso dejaría la planilla mostrando una justificación que en el sistema ya no
 * existe, que es exactamente la divergencia que no avisa.
 */
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const nota = new URL(request.url).searchParams.get("nota");
  if (!nota) return NextResponse.json({ error: "Falta la nota" }, { status: 400 });

  const admin = createAdminClient();

  const { data: borradas, error } = await admin
    .from("ordenes_trabajo_notas")
    .delete()
    .eq("id", nota)
    .eq("orden_id", id)
    .eq("creado_por", user.id)
    .select("id");

  if (error) {
    const traducido = errorDeBorrarNota(error);
    return NextResponse.json({ error: traducido.error }, { status: traducido.status });
  }

  // Cero filas es "no era tuya" o "no existe", y las dos se contestan igual:
  // decir cuál de las dos es contaría qué notas hay y de quién son.
  if (!borradas?.length) {
    return NextResponse.json(
      { error: "Sólo se puede borrar una entrada propia del historial" },
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
