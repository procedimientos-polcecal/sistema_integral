import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { avisarDeLaCarga } from "@/lib/mantenimiento/avisarDeLaCarga";
import { areaPorDefecto } from "@/lib/compras/areaDelUsuario";
import { leerValores, agregarFila } from "@/lib/core/sheets";
import { cargarEnlaces, resolver } from "@/lib/mantenimiento/enlaces";
import { codigoDeEquipo } from "@/lib/mantenimiento/planilla";
import { proximoNumeroDeAviso, filaParaLaPlanilla, fechaDeLaCarga } from "@/lib/mantenimiento/avisos";
import {
  reservarClave, anotarLaClave, respuestaDeLaReserva, soltarLaClave,
} from "@/lib/mantenimiento/claveDeCarga";
import { hoyEnArgentina } from "@/lib/core/fechas";

const PLANILLA = () => process.env.GOOGLE_SHEETS_AVISOS_ID ?? "";
const PESTANA = () => process.env.GOOGLE_SHEETS_AVISOS_TAB ?? "AVISOS";

/**
 * Cargar un aviso: alguien vio que algo anda mal.
 *
 * Es el primer eslabón de todo el módulo, y hasta ahora sólo se podía hacer
 * abriendo la planilla. Se escribe **primero ahí** —es la base y de ahí lo lee
 * quien no usa el sistema— y después acá.
 *
 * La puede cargar cualquier usuario activo, tenga o no el módulo Mantenimiento:
 * quien ve que una máquina anda mal trabaja en Producción, en Cantera o en el
 * laboratorio. Pedir nivel de edición dejaba a 4 de 14 usuarios activos en
 * condiciones de avisar, y los 184 avisos que había entraron todos por el
 * Forms. Es el mismo criterio que el alta de un requerimiento en Compras.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  // El cuerpo se lee **antes** del chequeo de permisos y eso no cambia el orden
  // de los chequeos ni ninguna respuesta: leer JSON no tiene efectos. Hace
  // falta acá porque para avisarle por correo a quien cargó sin señal hay que
  // saber qué cargó, y el 403 llega antes que todo lo demás.
  const b = await request.json().catch(() => null);
  const descripcion = String(b?.descripcion ?? "").trim();
  const sectorDelAviso = String(b?.sector_raw ?? "").trim() || null;
  const fechaCruda = typeof b?.fecha === "string" ? b.fecha : "";

  /** Lo que las dos llamadas de abajo comparten. Ver `avisarDeLaCarga`. */
  const deEstaCarga = { tipo: "aviso" as const, descripcion, sector: sectorDelAviso, fecha: fechaCruda };

  const { data: usuario, error: errorDelUsuario } = await supabase
    .from("usuarios")
    .select("activo")
    .eq("id", user.id)
    .maybeSingle();

  // `maybeSingle` y no `single`: sin fila `single` también devuelve `error`, y
  // alguien con sesión pero sin fila en `usuarios` pasaría de 403 a un 503 que
  // la cola reintentaría para siempre.
  //
  // Un fallo de la lectura no es «tu usuario está desactivado»: sin esto,
  // `usuario` queda null, `!usuario?.activo` da true y la ruta contesta un 403
  // con un motivo que nadie dijo. Para la cola sin señal un 403 es definitivo,
  // así que una caída pasajera de la base dejaría la carga parada para siempre.
  // 503 es lo que la cola reintenta. Es el mismo criterio que más abajo con la
  // consulta del área.
  if (errorDelUsuario) {
    return NextResponse.json(
      { error: `No se pudo comprobar tu usuario: ${errorDelUsuario.message}` },
      { status: 503 }
    );
  }

  if (!usuario?.activo) {
    // Este 403 no sólo contesta: a quien cargó sin señal hay que avisarle por
    // correo qué pasó con su carga, así que `avisarDeLaCarga` se llama antes
    // de devolver. Cambió el motivo del 403, no que haya que avisar.
    const error = "Tu usuario está desactivado";
    avisarDeLaCarga(request, user.id, {
      ...deEstaCarga,
      status: 403,
      error,
      enDuda: false,
    });
    return NextResponse.json({ error }, { status: 403 });
  }

  const planilla = PLANILLA();
  if (!planilla) {
    return NextResponse.json(
      { error: "Falta configurar GOOGLE_SHEETS_AVISOS_ID" },
      { status: 503 }
    );
  }

  if (!descripcion) {
    const error = "Contá qué pasa";
    avisarDeLaCarga(request, user.id, { ...deEstaCarga, status: 400, error, enDuda: false });
    return NextResponse.json({ error }, { status: 400 });
  }

  // La fecha puede venir en el cuerpo, y es el único ensanche que este plan le
  // hace a la ruta: un aviso cargado sin señal el viernes entra el lunes, y
  // fecharlo el lunes corre el historial del equipo y el MTBF. **Sin `fecha` se
  // usa hoy, igual que siempre**, que es lo que manda hoy el modal de la
  // pantalla de avisos —no manda `fecha`—, así que con señal no cambia nada.
  //
  // La que vino y no sirve es un 400 y **no se corrige a hoy**: la fecha del
  // aviso viaja a la columna B de la planilla, y corregirla en silencio la
  // dejaría diciendo un día que nadie eligió. Para la cola un 400 es
  // definitivo, así que la carga queda parada con este texto a la vista.
  //
  // Va antes de reservar la clave: una clave reservada para un cuerpo que
  // termina en 400 quedaría en duda para siempre.
  const laFecha = fechaDeLaCarga(b?.fecha, hoyEnArgentina());
  if (laFecha.estado === "no-sirve") {
    avisarDeLaCarga(request, user.id, {
      ...deEstaCarga,
      status: 400,
      error: laFecha.motivo,
      enDuda: false,
    });
    return NextResponse.json({ error: laFecha.motivo }, { status: 400 });
  }

  const admin = createAdminClient();

  // El área y las fotos que vienen en el cuerpo se validan acá, **antes** de
  // reservar la clave y de tocar la planilla, por la misma razón que la fecha:
  // un `area_id` que no existe haría fallar el insert **después** de escribir
  // la fila en la planilla, y quedaría un aviso allá que el sistema no tiene.
  //
  // `area_id` es opcional y no tiene que dejar de serlo: ver "El área" más abajo.
  const areaDelCuerpo = typeof b?.area_id === "string" ? b.area_id.trim() : "";
  if (areaDelCuerpo) {
    const { data: existe, error: errorDelArea } = await admin
      .from("compras_areas")
      .select("id")
      .eq("id", areaDelCuerpo)
      .maybeSingle();
    // Un fallo de la consulta no es "el área no existe": 503, que para la cola
    // es pasajero, en vez de un 400 definitivo por algo que no dijo nadie.
    if (errorDelArea) {
      return NextResponse.json(
        { error: `No se pudo comprobar el área: ${errorDelArea.message}` },
        { status: 503 }
      );
    }
    if (!existe) {
      const error = "El área elegida no existe";
      avisarDeLaCarga(request, user.id, { ...deEstaCarga, status: 400, error, enDuda: false });
      return NextResponse.json({ error }, { status: 400 });
    }
  }

  // Las fotos son links de `POST /api/mantenimiento/fotos`, o sea siempre una
  // URL http(s). Se exige eso y no sólo "un texto" porque `agregarFila()` escribe
  // con `USER_ENTERED`: un valor que empiece con `=` lo interpreta la planilla de
  // producción como una fórmula, y este campo lo abre cualquier usuario activo.
  // Algo que no es una lista de URLs es un 400 y no se ignora: tirar la foto en
  // silencio dejaría un aviso sin el dato que quien lo cargó creía haber mandado.
  const fotosCrudas: unknown = b?.reference_photos;
  const sonUrls =
    Array.isArray(fotosCrudas) &&
    fotosCrudas.every((f) => typeof f === "string" && /^https?:\/\/\S+$/i.test(f.trim()));
  if (fotosCrudas != null && !sonUrls) {
    const error = "Las fotos tienen que ser una lista de links http(s)";
    avisarDeLaCarga(request, user.id, { ...deEstaCarga, status: 400, error, enDuda: false });
    return NextResponse.json({ error }, { status: 400 });
  }
  const fotos = ((fotosCrudas as string[] | null | undefined) ?? []).map((f) => f.trim());

  // ── La clave de la carga ────────────────────────────────────
  //
  // Un aviso cargado sin señal llega con una `clave` que el teléfono repite en
  // cada reintento. **Sin `clave` no se toca nada de esto**: la ruta se
  // comporta exactamente como antes, y la tabla `cargas_offline` ni se
  // consulta. No es una comodidad —es lo que sostiene que con señal no cambie
  // nada, y lo que hace que esta ruta no dependa de que esa tabla exista.
  //
  // Se reserva **antes** de leer y de escribir la planilla. Ésa es la ventana
  // que importa: el reintento que llega mientras el primer envío todavía está
  // hablando con Google tiene que encontrar la clave anotada, o lee el mismo
  // "próximo número" y escribe una segunda fila.
  //
  // Y SI LA LECTURA DE LA PLANILLA FALLA DESPUÉS DE RESERVAR, LA CLAVE SE
  // SUELTA. Es el único lugar de las dos rutas donde se puede, y la razón es
  // que `leerValores` **sólo lee**: acá el servidor sabe con certeza que no
  // escribió nada, así que dejar la clave reservada no protegería de ningún
  // duplicado y en cambio haría daño — el reintento chocaría la primaria,
  // caería en `en-duda`, recibiría un 409 (definitivo para la cola) y la carga
  // quedaría parada con un texto que manda a mirar una planilla donde no hay
  // nada que mirar. Y no es un caso raro: una planilla recalculando hace cortar
  // a `leerValores` por diseño. Suelta, el reintento entra por `seguir`.
  //
  // (En la ruta de OT esto **no** se puede hacer; el porqué está en
  // `soltarLaClave`.)
  const clave = typeof b?.clave === "string" ? b.clave.trim() : "";
  // Una clave que no es un texto se dice en vez de ignorarse: tratarla como
  // ausente apagaría la protección contra el duplicado sin que nadie se entere.
  if (b?.clave !== undefined && !clave) {
    return NextResponse.json(
      { error: "La clave de la carga tiene que ser un texto" },
      { status: 400 }
    );
  }

  if (clave) {
    let reserva;
    try {
      reserva = await reservarClave(admin, { clave, usuarioId: user.id, tipo: "aviso" });
    } catch (e) {
      // No se pudo reservar: seguir sería cargar sin red de contención, y un
      // reintento duplicaría el aviso. El 503 es pasajero para la cola, así
      // que la carga queda y se vuelve a intentar.
      return NextResponse.json(
        { error: `No se pudo registrar la carga: ${e instanceof Error ? e.message : e}` },
        { status: 503 }
      );
    }

    // Qué contesta cada veredicto lo decide `respuestaDeLaReserva`, que es pura
    // y tiene los cinco fijados con tests. `null` es "seguir": la única que
    // deja crear el aviso.
    const respuesta = respuestaDeLaReserva(reserva.decision, reserva.fila, "aviso");
    if (respuesta) {
      // `en-duda` es el único de los cinco veredictos donde la fila **puede**
      // estar escrita en la planilla, y por eso lleva su propio texto: decirle
      // a alguien que no se cargó cuando quizás sí termina en dos avisos.
      avisarDeLaCarga(request, user.id, {
        ...deEstaCarga,
        status: respuesta.status,
        error: String((respuesta.cuerpo as { error?: unknown }).error ?? ""),
        enDuda: reserva.decision === "en-duda",
      });
      return NextResponse.json(respuesta.cuerpo, { status: respuesta.status });
    }
  }

  // El próximo número sale de la **planilla**, no de la base: alguien puede
  // haber cargado un aviso ahí desde la última sincronización, y repetir un
  // número dejaría dos avisos distintos llamados igual.
  let numeros: string[];
  try {
    const filas = await leerValores(planilla, PESTANA());
    numeros = filas.slice(1).map((f) => String(f[0] ?? ""));
  } catch (e) {
    // Acá no se escribió nada —`leerValores` sólo lee—, así que la clave
    // reservada se devuelve antes de contestar. Ver el bloque de la clave.
    if (clave) await soltarLaClave(admin, clave, user.id);
    return NextResponse.json(
      { error: `No se pudo leer la planilla para saber el próximo número: ${e instanceof Error ? e.message : e}` },
      { status: 502 }
    );
  }

  const oa_number = proximoNumeroDeAviso(numeros);
  const equipoRaw = String(b.equipo_raw ?? "").trim() || null;
  const sectorRaw = String(b.sector_raw ?? "").trim() || null;

  const aviso = {
    oa_number,
    // Sin `fecha` en el cuerpo, hoy. `hoyEnArgentina()` se llama **acá**, que
    // es donde se llamaba antes de este plan: un pedido que cruza la
    // medianoche mientras habla con Google se sigue fechando igual que se
    // fechaba, y eso tiene que ser literal.
    fecha: laFecha.estado === "sirve" ? laFecha.fecha : hoyEnArgentina(),
    sector_raw: sectorRaw,
    equipo_raw: equipoRaw,
    descripcion,
    urgencia: String(b.urgencia ?? "").trim() || null,
    quien_aviso: String(b.quien_aviso ?? "").trim() || null,
    observaciones: String(b.observaciones ?? "").trim() || null,
    // La planilla se escribe primero y es de donde lee quien no entra al
    // sistema, así que la foto entra en el mismo objeto que va a la fila.
    reference_photos: fotos.length > 0 ? fotos : null,
  };

  // La planilla primero: si falla, no queda un aviso en la app con un número
  // que la planilla no conoce y que el próximo se va a llevar puesto.
  let sheets_row: number;
  try {
    sheets_row = await agregarFila(planilla, PESTANA(), filaParaLaPlanilla(aviso));
  } catch (e) {
    return NextResponse.json(
      { error: `No se pudo escribir en la planilla: ${e instanceof Error ? e.message : e}` },
      { status: 502 }
    );
  }

  // La fila ya está escrita, así que el aviso existe donde manda. Se anota el
  // número ahora, antes del insert: un reintento que caiga en esta ventana
  // recibe el número de verdad en vez de un 409 que obligue a mirar la
  // planilla a mano.
  let clave_error: string | null = null;
  if (clave) clave_error = await anotarLaClave(admin, clave, "aviso", { numero: oa_number });

  const enlaces = await cargarEnlaces(admin);
  const equipo_code = codigoDeEquipo(equipoRaw);
  const { equipment_id, sector_id } = resolver(enlaces, {
    equipo_code,
    equipo_raw: equipoRaw,
    sector_raw: sectorRaw,
  });

  // ── El área ──
  //
  // **`area_id` NO es obligatorio, y no hay que volverlo obligatorio.**
  // `app/cargar/FormularioAvisoOffline.tsx` postea a esta misma ruta y no sabe
  // nada de áreas, y para la cola de cargas sin señal un 400 es definitivo: el
  // aviso quedaría parado para siempre por un campo que su propio formulario no
  // tiene. Lo mismo vale para el asistente, que arma una URL con valores
  // iniciales y tampoco lleva área.
  //
  // Si el cuerpo no la trae sale de las áreas de **quien carga**, que acá se
  // sabe por la sesión: sólo cuando tiene exactamente una (`areaPorDefecto`).
  // Con cero o con dos queda en null, que es visible y se corrige a mano; elegir
  // una de dos es adivinar, y un área equivocada no se nota nunca.
  //
  // `resolverElArea` NO se usa acá, y no es un olvido: es para los dos caminos
  // que no tienen sesión —el relleno de los avisos históricos y la
  // sincronización desde la planilla—, donde el único dato es el texto que
  // escribió el Forms y hay que reconocer un nombre. Con sesión se sabe quién
  // carga; reconocer un nombre sería ir por el camino largo, y además dejaría
  // sin área a quien deja `quien_aviso` vacío.
  const area_id = areaDelCuerpo || (await areaDeQuienCarga(admin, user.id));

  const { data, error } = await admin
    .from("avisos")
    .insert({
      ...aviso,
      area_id,
      creado_por: user.id,
      equipo_code,
      equipment_id,
      sector_id: b.sector_id || sector_id,
      app_created: true,
      sheets_row,
      synced_at: new Date().toISOString(),
    })
    .select()
    .single();

  // La fila ya está en la planilla cuando se llega acá, así que esto dejó de
  // ser "no se pudo cargar el aviso": el aviso **existe**. Devolver el error
  // de Postgres a secas hacía que quien cargó lo cargara de nuevo y quedaran
  // dos, que es justo lo que esta tarea vino a cerrar. Es el mismo trato que
  // la ruta de OT le da a su insert fallido, y un 500 para la cola es
  // pasajero, así que el teléfono reintenta.
  //
  // DÓNDE CAE ESE REINTENTO: en `ya-esta` y con el número **si `anotarLaClave`
  // anduvo**, que es el caso normal. Si esa anotación falló —y por eso la ruta
  // devuelve su motivo como `clave_error` en vez de tragárselo—, la clave sigue
  // reservada sin resolver y el reintento cae en `en-duda`: un 409, definitivo
  // para la cola, con el texto que manda a mirar la planilla. Eso es correcto
  // —el aviso **sí** está escrita allá— pero no es "recibe el número", y
  // escribirlo como si siempre pasara era prometer de más.
  if (error) {
    return NextResponse.json(
      {
        error:
          `El aviso ${oa_number} quedó escrito en la planilla pero no se pudo guardar ` +
          `en el sistema: ${error.message}. Va a entrar en la próxima sincronización; ` +
          `no lo cargues de nuevo o quedan dos.`,
      },
      { status: 500 }
    );
  }

  // Segunda pasada, ahora con el id: completa lo que la de arriba no podía
  // saber. `resolverClave` no borra el número al reescribir.
  // El `?? clave_error` es para no borrar el fallo de la primera pasada con el
  // null de una segunda que sí anduvo.
  if (clave) {
    clave_error =
      (await anotarLaClave(admin, clave, "aviso", { numero: oa_number, entidadId: data.id }))
      ?? clave_error;
  }

  return NextResponse.json({ data, oa_number, clave_error });
}

/**
 * De qué área es el aviso cuando quien lo cargó no la eligió: la única que
 * tenga asignada en `usuario_areas_compras`. `null` si no tiene o tiene más de
 * una.
 *
 * **Un fallo acá no frena el aviso.** A esta altura la fila ya está en la
 * planilla, y un error de lectura que terminara en un 500 haría que quien
 * cargó lo cargara de nuevo y quedaran dos. Sin área el aviso se guarda igual,
 * y se ve: es el caso de siempre para quien no tiene una cargada.
 */
async function areaDeQuienCarga(
  admin: ReturnType<typeof createAdminClient>,
  usuarioId: string
): Promise<string | null> {
  try {
    const { data, error } = await admin
      .from("usuario_areas_compras")
      .select("area_id")
      .eq("usuario_id", usuarioId);
    if (error) return null;

    return areaPorDefecto((data ?? []).map((a) => a.area_id as string)) || null;
  } catch {
    return null;
  }
}
