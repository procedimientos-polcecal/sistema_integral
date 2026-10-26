import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esAdminMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { diaDeLaSemana, esFechaIso } from "@/lib/core/fechas";
import { auditar, nombreParaAuditoria } from "@/lib/core/auditoria";
import { estaVigente, type PersonaDelTaller } from "@/lib/mantenimiento/disponibilidad";
import type { Grupo, Oficio } from "@/lib/mantenimiento/programacion";

/**
 * La semana de referencia: de dónde se cuenta todo el ciclo del taller.
 *
 * Es la escritura que más pesa de la programación. De esta fila salen **todas**
 * las semanas, hacia adelante y hacia atrás: mover el ancla cambia lo que la
 * pantalla muestra de semanas que ya pasaron, y el encargado vio ese pasado en
 * su momento. Por eso tiene ruta propia —con permiso, validación y registro— y
 * no una inserción desde el navegador, que era la única escritura de esta
 * pantalla que se saltaba todo eso.
 *
 * ── POR QUÉ HAY TRES VERBOS Y NO UNO ────────────────────────
 *
 * Hasta el 26/10/2026 esta ruta era **sólo un POST**, que además se negaba a
 * aceptar un segundo ancla para el mismo lunes. Sumado a que la pantalla sólo
 * mostraba el formulario cuando no había ninguna, el ancla se podía escribir
 * **una vez y nunca más corregir**. Y el ancla la carga una persona de memoria:
 * elige qué grupo estaba en 4 a 12 —que es cara o ceca si no se acuerda— y a
 * tres electricistas en tres turnos. Si cualquiera de esas cuatro cosas salía
 * mal, **todas las semanas quedaban mal**, hacia adelante y hacia atrás, sin un
 * solo error en pantalla: justo el primer anti-objetivo del diseño, que la
 * pantalla mienta sobre quién está.
 *
 * El `GET` existe para que la pantalla pueda **mostrar** el ancla que rige —si
 * no se ve, no se sabe que está mal— y el `PUT` para **reemplazarla**. El
 * backend ya estaba pensado para esto: `programacion/route.ts` elige a propósito
 * el ancla más nueva que no sea posterior a la semana pedida, justamente para
 * poder volver a anclar el ciclo sin reescribir el pasado.
 *
 * El `PUT` reemplaza la fila en su lugar (un `update`) en vez de borrar y
 * crear: así corregir un ancla mal cargada cuesta **un** registro de auditoría
 * y no dos, y la tabla es inmutable, así que cada registro de más es para
 * siempre.
 *
 * ── LO QUE ESTA RUTA DEFIENDE, Y LA BASE NO ─────────────────
 *
 * La tabla `mant_programacion_referencia` sólo tiene claves foráneas a
 * `empleados(id)`: nada impide anclar el ciclo a tres mecánicos, a la misma
 * persona tres veces, ni insertar dos filas el mismo lunes —el comentario de la
 * tabla dice "una sola fila" pero no hay un `unique`—. La migración
 * 20261023105615 ya está aplicada y una aplicada no se edita, así que las
 * reglas viven acá:
 *
 *   1. El lunes es un lunes.
 *   2. Los tres electricistas son tres personas distintas.
 *   3. Cada una es **electricista** en `mant_personal_taller` y está vigente ese
 *      lunes.
 *   4. No hay ya una referencia para ese mismo lunes (otra: el `PUT` puede
 *      quedarse con el lunes que la fila ya tenía).
 *
 * Quien escriba a la tabla por otro camino se las salta. Y la cuarta tiene una
 * ventana: dos pedidos simultáneos pueden pasar los dos la comprobación antes
 * de que se inserte alguno. Cerrarla del todo pide un índice único sobre
 * `lunes`, que es la migración `20261026084938` y la corre una persona.
 *
 * ── EL ORDEN: EL REGISTRO VA ANTES ──────────────────────────
 *
 * Igual que en `mantenimiento/ausencias`: `auditar()` se llama **antes** de
 * escribir, y si no entra, no se escribe. En el alta, el `id` de la fila se
 * genera acá justamente para eso: el registro tiene que nombrar la entidad
 * antes de que exista. El precio es que si la escritura falla después, queda un
 * registro de algo que no pasó —la tabla es inmutable y no se puede retirar—.
 * Las validaciones de arriba lo vuelven raro, y el registro lleva el `contexto`
 * entero para que se lea qué se intentó.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Las columnas de un ancla, literal: un `select()` en una variable pierde la inferencia. */
const COLUMNAS = "id, lunes, grupo_en_4a12, electricista_4a12_id, electricista_8a16_id, electricista_12a20_id";

/**
 * El tope de anclas que se leen de una vez.
 *
 * PostgREST corta en 1000 filas sin avisar, así que un `select` sin tope miente
 * el día que la tabla crezca. Acá no hace falta `traerTodo()` y el motivo no es
 * "esta tabla es chica" —ese razonamiento ya salió mal en Compras—, sino que
 * **las filas se piden ordenadas por `lunes desc` y la que decide es la
 * primera**: el ancla que rige una semana es la más nueva que no la supera. Un
 * corte se lleva las más viejas, que no cambian lo que se muestra ni lo que se
 * valida. Y la tabla crece de a una fila por vez que alguien vuelva a anclar el
 * ciclo: 500 son siglos.
 */
const TOPE_DE_ANCLAS = 500;

/** Una fecha que vino de la base, como `YYYY-MM-DD` pelado. */
function soloElDia(v: unknown): string {
  return String(v ?? "").slice(0, 10);
}

/** Una fila de la tabla, como la devuelve PostgREST. */
interface FilaDeAncla {
  id: string;
  lunes: string;
  grupo_en_4a12: string;
  electricista_4a12_id: string;
  electricista_8a16_id: string;
  electricista_12a20_id: string;
}

/** Quién es el admin que pide, o la respuesta de error si no lo es. */
async function admitir() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  if (!(await esAdminMantenimiento(supabase, user.id))) {
    return {
      error: NextResponse.json(
        { error: "La semana de referencia requiere ser admin de Mantenimiento" },
        { status: 403 }
      ),
    };
  }
  return { user };
}

/** Las anclas cargadas, de la más nueva a la más vieja. */
async function anclas(db: SupabaseClient): Promise<{ filas: FilaDeAncla[] } | { error: NextResponse }> {
  const { data, error } = await db
    .from("mant_programacion_referencia")
    .select(COLUMNAS)
    .order("lunes", { ascending: false })
    .limit(TOPE_DE_ANCLAS);
  if (error) return { error: NextResponse.json({ error: error.message }, { status: 500 }) };
  return { filas: (data ?? []).map((f) => ({ ...f, lunes: soloElDia(f.lunes) })) as FilaDeAncla[] };
}

/** Lo que llega en el cuerpo de un alta o de un reemplazo, ya mirado. */
interface Pedido {
  lunes: string;
  grupo: string;
  e412: string;
  e816: string;
  e1220: string;
}

/** Los problemas de forma del cuerpo. Vacío si está bien. */
function problemasDelCuerpo(p: Pedido): string[] {
  const problemas: string[] = [];
  if (!esFechaIso(p.lunes)) problemas.push("El lunes falta o no es válido, tiene que ser AAAA-MM-DD");
  else if (diaDeLaSemana(p.lunes) !== 1) problemas.push("La referencia se cuenta desde un lunes, y esa fecha no lo es");
  if (!["A", "B"].includes(p.grupo)) problemas.push("El grupo que está en 4 a 12 tiene que ser A o B");
  if (!UUID.test(p.e412)) problemas.push("Falta elegir el electricista de 4 a 12");
  if (!UUID.test(p.e816)) problemas.push("Falta elegir el electricista de 8 a 16");
  if (!UUID.test(p.e1220)) problemas.push("Falta elegir el electricista de 12 a 20");
  return problemas;
}

/** El cuerpo, sin tocar todavía la base. */
function leerPedido(b: Record<string, unknown> | null): Pedido {
  return {
    lunes: typeof b?.lunes === "string" ? b.lunes : "",
    grupo: String(b?.grupoEn4a12 ?? ""),
    e412: String(b?.electricista4a12Id ?? ""),
    e816: String(b?.electricista8a16Id ?? ""),
    e1220: String(b?.electricista12a20Id ?? ""),
  };
}

/**
 * Que los tres sean electricistas del taller, vigentes ese lunes y **en la
 * misma fila de padrón**: una persona puede tener dos vigencias seguidas, y lo
 * que importa es la que rige ese día.
 *
 * Devuelve los nombres —que el registro de auditoría usa— o la respuesta de
 * error.
 */
async function problemaDeElectricistas(
  db: SupabaseClient,
  p: Pedido
): Promise<{ nombreDe: Map<string, string> } | { error: NextResponse }> {
  const elegidos = [p.e412, p.e816, p.e1220];

  const { data: filas, error } = await db
    .from("mant_personal_taller")
    .select("empleado_id, oficio, grupo, desde, hasta, empleados(nombre, apellido)")
    .in("empleado_id", elegidos);
  if (error) return { error: NextResponse.json({ error: error.message }, { status: 500 }) };

  const nombreDe = new Map<string, string>();
  const padron: PersonaDelTaller[] = [];
  for (const f of filas ?? []) {
    const e = Array.isArray(f.empleados) ? f.empleados[0] : f.empleados;
    nombreDe.set(f.empleado_id, e ? `${e.nombre} ${e.apellido}` : f.empleado_id);
    const desde = soloElDia(f.desde);
    const hasta = f.hasta === null ? null : soloElDia(f.hasta);
    // Una fila cuyas fechas no se entienden no cuenta: ante la duda, no es del taller.
    if (!esFechaIso(desde) || (hasta !== null && !esFechaIso(hasta))) continue;
    padron.push({
      empleadoId: f.empleado_id,
      oficio: f.oficio as Oficio,
      grupo: f.grupo as Grupo | null,
      desde,
      hasta,
    });
  }

  const rotulos: [string, string][] = [
    [p.e412, "4 a 12"],
    [p.e816, "8 a 16"],
    [p.e1220, "12 a 20"],
  ];
  const noSirven = rotulos
    .filter(([id]) => !padron.some((x) => x.empleadoId === id && x.oficio === "electricista" && estaVigente(x, p.lunes)))
    .map(([, turno]) => `el de ${turno}`);
  if (noSirven.length) {
    return {
      error: NextResponse.json(
        {
          error:
            `${noSirven.join(", ")} no ${noSirven.length === 1 ? "es" : "son"} electricista del taller ese lunes. ` +
            "Los tres tienen que figurar en el padrón del taller como electricistas, vigentes ese día.",
        },
        { status: 400 }
      ),
    };
  }
  return { nombreDe };
}

/** Un ancla en una línea, para el registro: qué decía, no sólo que cambió algo. */
function comoSeLee(
  lunes: string,
  grupo: string,
  e412: string,
  e816: string,
  e1220: string,
  nombreDe: (id: string) => string
): string {
  return (
    `semana del ${lunes}: grupo ${grupo} en 4-12; electricistas ` +
    `4-12 ${nombreDe(e412)}, 8-16 ${nombreDe(e816)}, 12-20 ${nombreDe(e1220)}`
  );
}

/** Los nombres de un puñado de empleados, para que el registro no diga uuids. */
async function nombresDe(db: SupabaseClient, ids: string[]): Promise<(id: string) => string> {
  const { data } = await db.from("empleados").select("id, nombre, apellido").in("id", ids);
  return (id: string) => {
    const e = (data ?? []).find((x) => x.id === id);
    return e ? `${e.nombre} ${e.apellido}` : id;
  };
}

/**
 * El registro, **antes** de escribir. Si no entra, no se escribe.
 *
 * Devuelve la respuesta de error, o null si quedó registrado.
 */
async function problemaDeAuditoria(
  db: SupabaseClient,
  usuarioId: string,
  entidadId: string,
  valorAnterior: string,
  valorNuevo: string,
  contexto: Record<string, unknown>
): Promise<NextResponse | null> {
  const { data: quien } = await db
    .from("usuarios")
    .select("nombre, apellido, email")
    .eq("id", usuarioId)
    .maybeSingle();

  const registro = await auditar(db, {
    modulo: "mantenimiento",
    entidad: "mant_programacion_referencia",
    entidadId,
    accion: "corregir",
    usuario: { id: usuarioId, nombre: nombreParaAuditoria(quien) },
    valorAnterior,
    valorNuevo,
    contexto,
  });
  if (!registro.ok) {
    return NextResponse.json(
      { error: `No se pudo registrar el cambio en la auditoría, así que no se guardó la referencia: ${registro.error}` },
      { status: 500 }
    );
  }
  return null;
}

/**
 * GET — las anclas cargadas, de la más nueva a la más vieja, con los nombres de
 * los tres electricistas.
 *
 * Existe para que la pantalla pueda mostrar **cuál rige hoy**. Sin esto el
 * encargado no tenía forma de ver qué se cargó, y un ancla equivocada no se
 * distingue de una buena: la grilla se dibuja igual de completa.
 */
export async function GET() {
  const permiso = await admitir();
  if (permiso.error) return permiso.error;

  const db = createAdminClient();
  const leidas = await anclas(db);
  if ("error" in leidas) return leidas.error;

  const ids = leidas.filas.flatMap((f) => [f.electricista_4a12_id, f.electricista_8a16_id, f.electricista_12a20_id]);
  const nombre = ids.length ? await nombresDe(db, [...new Set(ids)]) : (id: string) => id;

  return NextResponse.json({
    data: leidas.filas.map((f) => ({
      ...f,
      nombre_4a12: nombre(f.electricista_4a12_id),
      nombre_8a16: nombre(f.electricista_8a16_id),
      nombre_12a20: nombre(f.electricista_12a20_id),
    })),
  });
}

export async function POST(request: Request) {
  const permiso = await admitir();
  if (permiso.error) return permiso.error;

  const p = leerPedido(await cuerpoJson(request));
  const problemas = problemasDelCuerpo(p);
  if (problemas.length) return NextResponse.json({ error: problemas.join(". ") }, { status: 400 });

  const elegidos = [p.e412, p.e816, p.e1220];
  if (new Set(elegidos.map((e) => e.toLowerCase())).size !== 3) {
    return NextResponse.json(
      { error: "Cada turno lleva un electricista distinto: se repite una persona" },
      { status: 400 }
    );
  }

  const db = createAdminClient();

  const delPadron = await problemaDeElectricistas(db, p);
  if ("error" in delPadron) return delPadron.error;

  // ── Una sola referencia por lunes ──
  const previas = await anclas(db);
  if ("error" in previas) return previas.error;

  if (previas.filas.some((f) => f.lunes === p.lunes)) {
    return NextResponse.json(
      {
        error:
          "Ya hay una referencia para ese lunes. Para corregirla, cambiala desde la pantalla " +
          "(“La referencia del ciclo”); para volver a anclar el ciclo, usá otro lunes.",
      },
      { status: 400 }
    );
  }

  // Lo que regía hasta ahora, para que el registro diga qué se cambió y no sólo
  // que algo cambió. El primer alta no tiene anterior.
  const anterior = previas.filas[0];
  let valorAnterior = "(no había referencia)";
  if (anterior) {
    const nombre = await nombresDe(db, [
      anterior.electricista_4a12_id,
      anterior.electricista_8a16_id,
      anterior.electricista_12a20_id,
    ]);
    valorAnterior = comoSeLee(
      anterior.lunes,
      anterior.grupo_en_4a12,
      anterior.electricista_4a12_id,
      anterior.electricista_8a16_id,
      anterior.electricista_12a20_id,
      nombre
    );
  }
  const valorNuevo = comoSeLee(p.lunes, p.grupo, p.e412, p.e816, p.e1220, (id) => delPadron.nombreDe.get(id) ?? id);

  // ── El registro, antes de escribir ──
  const id = crypto.randomUUID();
  const sinRegistro = await problemaDeAuditoria(db, permiso.user.id, id, valorAnterior, valorNuevo, {
    ruta: "mantenimiento/programacion/referencia",
    verbo: "alta",
    lunes: p.lunes,
    grupo_en_4a12: p.grupo,
    electricista_4a12_id: p.e412,
    electricista_8a16_id: p.e816,
    electricista_12a20_id: p.e1220,
  });
  if (sinRegistro) return sinRegistro;

  const { data, error } = await db
    .from("mant_programacion_referencia")
    .insert({
      id,
      lunes: p.lunes,
      grupo_en_4a12: p.grupo,
      electricista_4a12_id: p.e412,
      electricista_8a16_id: p.e816,
      electricista_12a20_id: p.e1220,
    })
    .select(COLUMNAS)
    .single();

  if (error) {
    // 23505: otro envío del mismo lunes ganó la carrera. Lo ataja el índice único
    // de `20261026084938`, que es la garantía de verdad; el chequeo de arriba
    // sólo da el mensaje cuando no hubo carrera.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Ya hay una referencia para ese lunes (se cargó justo ahora). Revisá la pantalla antes de volver a cargarla." },
        { status: 409 }
      );
    }
    return NextResponse.json(
      {
        error:
          `No se pudo guardar la referencia (${error.message}). El cambio quedó anotado en la auditoría ` +
          "aunque no se hizo: volvé a intentarlo.",
      },
      { status: 500 }
    );
  }
  return NextResponse.json({ data }, { status: 201 });
}

/**
 * PUT — reemplazar un ancla ya cargada. Lleva `id` en el cuerpo, además de los
 * mismos cinco campos que el POST.
 *
 * Es la salida para un ancla mal cargada, que hasta el 26/10/2026 no existía.
 * Pasa por **las mismas** validaciones que el alta: no hay una puerta más
 * floja para corregir que para crear.
 *
 * Puede cambiarle el lunes —volver a anclar el ciclo en otra semana es
 * exactamente para lo que `programacion/route.ts` elige el ancla más nueva que
 * no supere la semana pedida—, y en ese caso se comprueba que no haya ya otra
 * en ese lunes.
 */
export async function PUT(request: Request) {
  const permiso = await admitir();
  if (permiso.error) return permiso.error;

  const b = await cuerpoJson(request);
  const id = String(b?.id ?? "");
  if (!UUID.test(id)) return NextResponse.json({ error: "Falta qué referencia se cambia" }, { status: 400 });

  const p = leerPedido(b);
  const problemas = problemasDelCuerpo(p);
  if (problemas.length) return NextResponse.json({ error: problemas.join(". ") }, { status: 400 });

  const elegidos = [p.e412, p.e816, p.e1220];
  if (new Set(elegidos.map((e) => e.toLowerCase())).size !== 3) {
    return NextResponse.json(
      { error: "Cada turno lleva un electricista distinto: se repite una persona" },
      { status: 400 }
    );
  }

  const db = createAdminClient();

  const todas = await anclas(db);
  if ("error" in todas) return todas.error;

  const actual = todas.filas.find((f) => f.id === id);
  if (!actual) return NextResponse.json({ error: "Esa referencia ya no existe" }, { status: 404 });

  // Otra fila con el mismo lunes: el lunes propio no cuenta, que es lo que
  // permite corregir un ancla sin moverla de semana.
  if (todas.filas.some((f) => f.id !== id && f.lunes === p.lunes)) {
    return NextResponse.json(
      { error: "Ya hay otra referencia para ese lunes. Cambiá esa, o elegí otro lunes." },
      { status: 400 }
    );
  }

  const delPadron = await problemaDeElectricistas(db, p);
  if ("error" in delPadron) return delPadron.error;

  // Guardar sin haber cambiado nada escribiría una fila de auditoría por un
  // no-op, y esa tabla no se borra nunca.
  const sinCambios =
    actual.lunes === p.lunes &&
    actual.grupo_en_4a12 === p.grupo &&
    actual.electricista_4a12_id === p.e412 &&
    actual.electricista_8a16_id === p.e816 &&
    actual.electricista_12a20_id === p.e1220;
  if (sinCambios) {
    return NextResponse.json({ error: "No hay nada para cambiar: la referencia ya dice eso" }, { status: 400 });
  }

  const nombreViejo = await nombresDe(db, [
    actual.electricista_4a12_id,
    actual.electricista_8a16_id,
    actual.electricista_12a20_id,
  ]);
  const valorAnterior = comoSeLee(
    actual.lunes,
    actual.grupo_en_4a12,
    actual.electricista_4a12_id,
    actual.electricista_8a16_id,
    actual.electricista_12a20_id,
    nombreViejo
  );
  const valorNuevo = comoSeLee(p.lunes, p.grupo, p.e412, p.e816, p.e1220, (x) => delPadron.nombreDe.get(x) ?? x);

  const sinRegistro = await problemaDeAuditoria(db, permiso.user.id, id, valorAnterior, valorNuevo, {
    ruta: "mantenimiento/programacion/referencia",
    verbo: "reemplazo",
    lunes: p.lunes,
    grupo_en_4a12: p.grupo,
    electricista_4a12_id: p.e412,
    electricista_8a16_id: p.e816,
    electricista_12a20_id: p.e1220,
    anterior: {
      lunes: actual.lunes,
      grupo_en_4a12: actual.grupo_en_4a12,
      electricista_4a12_id: actual.electricista_4a12_id,
      electricista_8a16_id: actual.electricista_8a16_id,
      electricista_12a20_id: actual.electricista_12a20_id,
    },
  });
  if (sinRegistro) return sinRegistro;

  const { data, error } = await db
    .from("mant_programacion_referencia")
    .update({
      lunes: p.lunes,
      grupo_en_4a12: p.grupo,
      electricista_4a12_id: p.e412,
      electricista_8a16_id: p.e816,
      electricista_12a20_id: p.e1220,
    })
    .eq("id", id)
    .select(COLUMNAS)
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Ya hay otra referencia para ese lunes (se cargó justo ahora). Revisá la pantalla antes de volver a probar." },
        { status: 409 }
      );
    }
    return NextResponse.json(
      {
        error:
          `No se pudo guardar la referencia (${error.message}). El cambio quedó anotado en la auditoría ` +
          "aunque no se hizo: volvé a intentarlo.",
      },
      { status: 500 }
    );
  }
  // Sin fila, el ancla se fue entre la lectura y la escritura: otra pestaña la
  // cambió. Con `.single()` eso llegaba como un error interno de PostgREST.
  if (!data) return NextResponse.json({ error: "Esa referencia ya no existe" }, { status: 404 });

  return NextResponse.json({ data });
}
