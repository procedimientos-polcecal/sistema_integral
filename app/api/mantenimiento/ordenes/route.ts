import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { escribirCeldas } from "@/lib/core/sheets";
import { altaEnLaPlanilla } from "@/lib/mantenimiento/formulario";
import { escribirEnLaFilaDeLaOT, type FilaDeOT } from "@/lib/mantenimiento/planillaDeOT";
import {
  celdasParaRegistrar, repartirRegistroDeOT,
  esEstadoDeOT, ESTADOS_DE_OT, type RegistroDeOT,
} from "@/lib/mantenimiento/ordenes";
import { COLUMNA_OT_ASIGNADA, fechaDeLaCarga } from "@/lib/mantenimiento/avisos";
import { reservarClave, anotarLaClave } from "@/lib/mantenimiento/claveDeCarga";
import { ESTA_PENDIENTE, prioridadParaLaPlanilla } from "@/lib/mantenimiento/prioridad";
import {
  estadoSegunElCierre, loQueFaltaParaCerrar, loQueHayQueExportar,
} from "@/lib/mantenimiento/cierreDeOT";
import { paginaPedida } from "@/lib/core/paginado";
import { columnaDeFecha } from "@/lib/mantenimiento/filtrosOt";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { hoyEnArgentina } from "@/lib/core/fechas";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const search       = searchParams.get("q");
  const page         = paginaPedida(searchParams.get("page"));
  const limit        = 50;

  /**
   * Un filtro con varios valores, como los manda el listado.
   *
   * Se aceptan las dos formas —`?estado=A,B` y `?estado=A&estado=B`— porque son
   * las dos que la URL de la pantalla puede tener, y la ruta entiende el mismo
   * query string que la barra de direcciones a propósito: así reproducir lo que
   * alguien está viendo es pegar su enlace.
   *
   * Acá no se valida contra una lista de valores permitidos. En el listado sí
   * —`lib/mantenimiento/filtrosOt.ts`— porque un filtro que la persona no ve
   * deja una tabla vacía que se lee mal; acá, un valor inventado simplemente no
   * coincide con ninguna fila, que es la respuesta correcta.
   */
  const varios = (nombre: string): string[] => {
    const vistos = new Set<string>();
    for (const crudo of searchParams.getAll(nombre)) {
      for (const v of crudo.split(",")) if (v.trim()) vistos.add(v.trim());
    }
    return [...vistos];
  };

  const estado       = varios("estado");
  const especialidad = varios("especialidad");
  const tipo         = varios("tipo");
  const quien        = varios("quien");
  const prioridad    = varios("prioridad");
  const proveedor    = varios("proveedor");
  const sector       = varios("sector");
  const equipo       = varios("equipo");
  // `equipment_id` es el nombre viejo, con un solo valor. Lo usa la ficha del
  // equipo para traer sus órdenes; se conserva para no romperla.
  const equipment_id = searchParams.get("equipment_id");

  const campoFecha = searchParams.get("campo_fecha") ?? "";
  const desde      = searchParams.get("desde") ?? "";
  const hasta      = searchParams.get("hasta") ?? "";

  // Las que todavía esperan algo, todas juntas y sin paginar: son unas treinta
  // sobre mil ochocientas, y ordenarlas a mano no se puede hacer de a páginas.
  const pendientes = searchParams.get("pendientes") === "1";

  let query = supabase
    .from("ordenes_trabajo")
    .select("*", { count: "exact" })
    .order("ot_number", { ascending: false });

  query = pendientes
    ? query.in("estado", ESTA_PENDIENTE).limit(300)
    : query.range((page - 1) * limit, page * limit - 1);

  // Un `.in()` por filtro: los valores de un mismo desplegable suman —«atrasado
  // o en proceso»— y los de distintos desplegables se recortan entre sí.
  if (estado.length)       query = query.in("estado", estado);
  if (especialidad.length) query = query.in("especialidad", especialidad);
  if (tipo.length)         query = query.in("tipo", tipo);
  if (quien.length)        query = query.in("quien", quien);
  if (prioridad.length)    query = query.in("prioridad", prioridad);
  if (proveedor.length)    query = query.in("proveedor_id", proveedor);
  if (sector.length)       query = query.in("sector_id", sector);
  if (equipo.length)       query = query.in("equipment_id", equipo);
  if (equipment_id)        query = query.eq("equipment_id", equipment_id);

  // El rango corre sobre la fecha que se haya elegido, y los dos extremos
  // entran: quien pone "hasta el 31" espera que el 31 cuente. `columnaDeFecha`
  // trae la lista blanca puesta, así que un `?campo_fecha=` inventado cae en
  // `fecha` en vez de llegar como nombre de columna a la consulta.
  const columna = columnaDeFecha(campoFecha);
  if (desde) query = query.gte(columna, desde);
  if (hasta) query = query.lte(columna, hasta);
  if (search) {
    // Sanitizar: quitar caracteres que rompen el filtro PostgREST (,()*\)
    const safe = search.replace(/[,()*\\%]/g, "").trim();
    if (safe) {
      query = query.or(`descripcion.ilike.%${safe}%,equipo_raw.ilike.%${safe}%,sector_raw.ilike.%${safe}%`);
    }
  }

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data, count });
}

/** Qué estados valen, dicho en el error: adivinarlos es la parte lenta. */
function mensajeDeEstadoInvalido(recibido: unknown): string {
  return `"${String(recibido)}" no es un estado de OT. Los que valen son: ${ESTADOS_DE_OT.join(", ")}.`;
}

// ── POST: crear OT manualmente desde la app ─────────────────────────────────
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await cuerpoJson(request);
  const {
    equipment_id, sector_id, sector_raw, equipo_raw, equipo_code,
    especialidad, tipo, quien, descripcion, repuesto,
    fecha, fecha_ejecucion, fecha_cierre,
    estado, contratista, horas, operario_1, operario_2, operario_3, prioridad,
    schedule_id, aviso_id,
  } = body;

  if (!descripcion?.trim()) {
    return NextResponse.json({ error: "La descripción es requerida" }, { status: 400 });
  }

  // El POST no validaba el estado y el PATCH sí: cualquier texto entraba a la
  // base y de ahí a la planilla, donde `EN_LA_PLANILLA[v] ?? v` lo escribía tal
  // cual. Sin estado la OT nace por hacer, que es de donde se parte.
  if (estado !== undefined && estado !== null && estado !== "" && !esEstadoDeOT(estado)) {
    return NextResponse.json({ error: mensajeDeEstadoInvalido(estado) }, { status: 400 });
  }

  const admin = createAdminClient();

  // ── Primero la planilla, después la base ────────────────────
  //
  // **La planilla manda en Mantenimiento: una orden existe cuando tiene su
  // fila.** Acá se escribe esa fila y de ahí sale el número, de la misma
  // lectura. Si falla, no se creó nada en ningún lado y no se consumió ningún
  // número.
  //
  // Antes era al revés —insertar, y después intentar la planilla como
  // best-effort— con el argumento de que "es peor no poder crear la orden que
  // arriesgar un número repetido". El 16/10/2026 se vio lo que ese argumento
  // no medía: la OT 2796 quedó en la base con un número que la hoja de
  // respuestas todavía no había repartido, así que la siguiente respuesta del
  // formulario se lo iba a llevar también, y el `upsert` por `ot_number` de la
  // sincronización habría pisado la de la app con la del formulario. No era el
  // riesgo de un número repetido: era una pérdida garantizada y silenciosa.
  //
  // El precio, dicho: con Google caído no se puede crear una OT desde la app.
  // Es visible y se reintenta; lo otro no se veía nunca.
  // Una sola vez, y antes de los dos usos: la misma forma va a la planilla y a
  // la base. Si se tradujera sólo al escribir, la base quedaría con las dos y
  // el filtro del listado —un `.in()` liso— seguiría sin encontrarla.
  // Antes de la planilla, para no consumir un número por una orden incompleta.
  const faltaParaCerrar = loQueFaltaParaCerrar({
    fecha_cierre, horas, quien, contratista, operario_1, operario_2, operario_3,
  });
  if (faltaParaCerrar.length > 0) {
    return NextResponse.json(
      {
        error:
          `La orden tiene fecha de cierre, así que ya se hizo. Falta cargar ` +
          `${faltaParaCerrar.join(", ")}.`,
      },
      { status: 400 }
    );
  }

  // ── La clave de la carga ────────────────────────────────────
  //
  // Una OT cargada sin señal llega con una `clave` que el teléfono repite en
  // cada reintento. **Sin `clave` no se toca nada de esto**: la ruta se
  // comporta exactamente como antes y la tabla `cargas_offline` ni se
  // consulta. No es una comodidad —es lo que sostiene que con señal no cambie
  // nada, y lo que hace que esta ruta no dependa de que esa tabla exista.
  //
  // Va acá: después de todo lo que puede rechazar el pedido por su contenido
  // —reservar una clave para un cuerpo que termina en 400 la dejaría en duda
  // para siempre— y antes de la planilla, que es donde se reparte el número.
  //
  // Lo que cuesta, dicho: si la planilla no contesta después de reservar, la
  // clave queda en duda aunque no se haya repartido ningún número, y el
  // reintento recibe un 409 que manda a mirar la planilla para nada. Se
  // acepta porque ese 409 hace mirar y no perder: la carga queda parada en el
  // teléfono, con el texto de acá, hasta que una persona decida.
  const clave = typeof body?.clave === "string" ? body.clave.trim() : "";
  // Una clave que no es un texto se dice en vez de ignorarse: tratarla como
  // ausente apagaría la protección contra el duplicado sin que nadie se entere.
  if (body?.clave !== undefined && !clave) {
    return NextResponse.json(
      { error: "La clave de la carga tiene que ser un texto" },
      { status: 400 }
    );
  }

  // ── La fecha, sólo cuando la carga viene de la cola ────────
  //
  // Con `clave`, el cuerpo lo armó un teléfono que pudo pasar días sin señal:
  // la fecha la puso su reloj y no la revisó nadie, así que una futura o una
  // que no es fecha se rechazan en vez de corregirse. Corregirla en silencio
  // dejaría la orden fechada un día que nadie eligió —y de esa fecha salen el
  // historial del equipo y los filtros del listado— sin que nadie se entere.
  //
  // **Sin `clave` esto no corre**: ese cuerpo es el de alguien cargando con
  // señal desde la pantalla de siempre, donde la fecha la eligió a mano en un
  // `<input type="date">` y la está viendo. Ahí la ruta queda letra por letra
  // como estaba —`fecha || hoy`—, porque con señal no cambia nada.
  const hoy = hoyEnArgentina();
  let fechaDeLaOrden: string = fecha || hoy;

  if (clave) {
    // La fecha primero: un 400 tiene que salir antes de reservar la clave, o
    // esa clave queda en duda para siempre por un cuerpo que nunca se cargó.
    const revisada = fechaDeLaCarga(fecha, hoy);
    if (revisada.estado === "no-sirve") {
      return NextResponse.json({ error: revisada.motivo }, { status: 400 });
    }
    fechaDeLaOrden = revisada.estado === "sirve" ? revisada.fecha : hoy;

    let reserva;
    try {
      reserva = await reservarClave(admin, { clave, usuarioId: user.id, tipo: "orden" });
    } catch (e) {
      // No se pudo reservar: seguir sería repartir un número sin red de
      // contención, y un reintento crearía la segunda OT. El 503 es pasajero
      // para la cola, así que la carga queda y se vuelve a intentar.
      return NextResponse.json(
        { error: `No se pudo registrar la carga: ${e instanceof Error ? e.message : e}` },
        { status: 503 }
      );
    }

    if (reserva.decision === "ya-esta") {
      // Esta OT ya se creó con esta clave: se devuelve el número de entonces y
      // la planilla no se toca. Lo que el primer intento no haya alcanzado a
      // hacer —enlazar el aviso, exportar el cierre— no se rehace acá: no se
      // sabe qué llegó a pasar y repetirlo a ciegas pisaría la planilla.
      //
      // SIN `entidad_id` EL CASO ES OTRO y no se puede contestar igual: la
      // planilla ya tiene la fila con su número y el insert en la base nunca
      // ocurrió. Contestar "ya está" a secas dejaría a la persona creyendo que
      // la orden está en el sistema, y si venía de un aviso, ese aviso quedó
      // sin su `work_order_id` y nadie se entera. Se dice, con el mismo
      // criterio que el 500 de más abajo: el estado raro se cuenta, no se
      // tapa.
      const numero = Number(reserva.fila?.numero);
      const soloEnLaPlanilla = !reserva.fila?.entidad_id;
      return NextResponse.json({
        data: null,
        ot_number: numero,
        ya_estaba: true,
        advertencia: soloEnLaPlanilla
          ? `La OT ${numero} quedó escrita en la planilla y todavía no está en el ` +
            `sistema: va a entrar con la próxima sincronización. No la cargues de ` +
            `nuevo o quedan dos.` +
            (aviso_id
              ? ` El aviso del que salía quedó sin el enlace a esta OT: hay que ` +
                `ponérselo a mano cuando aparezca.`
              : "")
          : null,
      });
    }

    if (reserva.decision === "ajena") {
      return NextResponse.json(
        { error: "Esa clave de carga es de otra persona: no se puede mandar desde esta sesión." },
        { status: 403 }
      );
    }

    if (reserva.decision === "otro-tipo") {
      // La misma clave ya se usó para un aviso. No es falta de permiso —es el
      // mismo usuario—, así que no es un 403: es un conflicto, y va con el
      // mismo 409 que la duda porque para la cola los dos son definitivos y
      // reintentar no los cambia.
      return NextResponse.json(
        { error: "Esa clave de carga ya se usó para un aviso. Cargá la orden de nuevo." },
        { status: 409 }
      );
    }

    if (reserva.decision === "en-duda") {
      return NextResponse.json(
        {
          error:
            "Esta carga ya había arrancado y no se sabe si llegó: la orden puede haber " +
            "quedado escrita en la planilla. Mirala antes de cargarla de nuevo o quedan dos.",
        },
        { status: 409 }
      );
    }
  }

  const laPrioridad = prioridadParaLaPlanilla(prioridad);

  // Quién la pide, para que la planilla lo diga. Es lo que le falta a quien la
  // mira para saber a quién preguntarle, y sale del usuario de la sesión: el
  // formulario se lo pregunta a la persona y acá ya lo sabemos.
  //
  // Con el cliente admin porque `usuarios` sólo deja leer la fila propia salvo
  // que uno sea admin —la policy es `id = auth.uid() or es_admin()`—, y acá
  // justamente es la propia, pero el resto de la ruta ya usa `admin` y pedirlo
  // dos veces con dos clientes distintos es una incoherencia que se paga la
  // próxima vez que alguien lea esto.
  const { data: quienPide } = await admin
    .from("usuarios")
    .select("email, nombre, apellido")
    .eq("id", user.id)
    .maybeSingle();

  const alta = await altaEnLaPlanilla({
    creado: new Date(),
    email: quienPide?.email ?? null,
    nombre: quienPide?.nombre ?? null,
    apellido: quienPide?.apellido ?? null,
    sector: sector_raw || null,
    equipo: equipo_raw || null,
    especialidad: especialidad || null,
    tipo: tipo || null,
    quien: quien || null,
    descripcion: descripcion.trim(),
    repuesto: repuesto?.trim() || null,
    fecha_ejecucion: fecha_ejecucion || null,
    prioridad: laPrioridad,
  });

  if (!alta.ok) {
    return NextResponse.json(
      { error: `La orden no se creó porque no se pudo escribir en la planilla. ${alta.error}` },
      { status: 502 }
    );
  }

  const ot_number = alta.ot_number;

  // La fila ya está escrita, así que la OT existe donde manda y su número ya
  // está repartido. Se anota ahora, antes del insert: un reintento que caiga
  // en esta ventana recibe el número de verdad en vez de un 409 que obligue a
  // mirar la planilla a mano.
  if (clave) await anotarLaClave(admin, clave, "orden", { numero: String(ot_number) });

  const record = {
    ot_number,
    fecha:           fechaDeLaOrden,
    sector_id:       sector_id || null,
    sector_raw:      sector_raw || null,
    equipo_raw:      equipo_raw || null,
    equipo_code:     equipo_code || null,
    equipment_id:    equipment_id || null,
    especialidad:    especialidad || null,
    tipo:            tipo || null,
    quien:           quien || null,
    descripcion:     descripcion.trim(),
    repuesto:        repuesto?.trim() || null,
    fecha_ejecucion: fecha_ejecucion || null,
    fecha_cierre:    fecha_cierre || null,
    // Una orden con fecha de cierre ya se hizo: la fecha manda sobre el estado
    // que haya venido. La regla está acá y no sólo en el formulario porque el
    // formulario no es el único que puede llamar a esta ruta.
    estado:          estadoSegunElCierre(fecha_cierre, estado),
    contratista:     contratista?.trim() || null,
    horas:           horas ? Number(horas) : null,
    operario_1:      operario_1?.trim() || null,
    operario_2:      operario_2?.trim() || null,
    operario_3:      operario_3?.trim() || null,
    prioridad:       laPrioridad,
    schedule_id:     schedule_id || null,
    app_created:     true,
    created_by:      user.id,
    created_at_app:  new Date().toISOString(),
    requiere_parada_sector: Boolean(body.requiere_parada_sector),
    synced_at:       new Date().toISOString(),
  };

  // La fila ya está escrita, así que la orden ya existe donde manda. Si esto
  // falla queda sólo en la planilla, que es el estado normal de cualquier
  // orden cargada por el formulario: la próxima sincronización la trae. Se
  // dice igual, porque hasta entonces no se ve en el sistema.
  //
  // `sheets_row` no se escribe acá, y es a propósito: la fila de la hoja de
  // respuestas no es la del master —Forms inserta y la corre—, y la del master
  // la pone la sincronización cuando vuelve a leerla. Guardar la de acá sería
  // guardar un número que apunta a otra planilla.
  const { data: inserted, error } = await admin
    .from("ordenes_trabajo").insert(record).select().single();

  if (error) {
    return NextResponse.json(
      {
        error:
          `La OT ${ot_number} quedó escrita en la planilla pero no se pudo guardar en ` +
          `el sistema: ${error.message}. Va a entrar en la próxima sincronización; ` +
          `no la cargues de nuevo o quedan dos.`,
      },
      { status: 500 }
    );
  }

  // Segunda pasada, ahora con el id: completa lo que la de arriba no podía
  // saber. `resolverClave` no borra el número al reescribir.
  if (clave) {
    await anotarLaClave(admin, clave, "orden", { numero: String(ot_number), entidadId: inserted.id });
  }

  // ── Lo que la planilla todavía no sabe ──────────────────────
  //
  // Una OT puede nacer ya realizada, con cierre, horas y operarios. Eso vive en
  // las columnas literales del master, y **acá casi nunca se puede escribir**:
  // su fila llega por `IMPORTRANGE` y tarda. Se intenta igual —a veces ya está—
  // y si no, queda anotado para que lo termine la sincronización.
  //
  // Sin esto el cron de las 06:00 lee la `M` vacía y pisa el estado, y lee la
  // `O` vacía y pisa las horas con null. Medido: las cinco OT que hoy siguen en
  // REALIZADO lo están porque alguien escribió "Realizado" a mano.
  let planilla_error: string | null = null;
  const paraLaPlanilla = loQueHayQueExportar(inserted);

  if (paraLaPlanilla) {
    planilla_error = await escribirEnLaFilaDeLaOT(
      inserted, celdasParaRegistrar(paraLaPlanilla)
    );

    await admin
      .from("ordenes_trabajo")
      .update({
        sheets_pendiente: planilla_error,
        sheets_intentado_en: new Date().toISOString(),
      })
      .eq("id", inserted.id);
  }

  // Si nace de un aviso, el aviso queda apuntando a ella: es lo que evita que
  // alguien genere dos órdenes para el mismo problema.
  let aviso_error: string | null = null;
  if (aviso_id) {
    aviso_error = await marcarElAviso(admin, aviso_id, inserted.id, ot_number);
  }

  return NextResponse.json({ data: inserted, ot_number, aviso_error, planilla_error });
}

/**
 * Deja el aviso apuntando a la OT que se generó, de los dos lados.
 *
 * En la planilla de avisos se escribe el número en la columna "OT ASIGNADA",
 * que es donde lo busca quien no entra al sistema.
 */
async function marcarElAviso(
  admin: ReturnType<typeof createAdminClient>,
  avisoId: string,
  otId: string,
  otNumber: number
): Promise<string | null> {
  const { data: aviso, error } = await admin
    .from("avisos")
    .update({ work_order_id: otId, ot_asignada: String(otNumber) })
    .eq("id", avisoId)
    .select("sheets_row")
    .single();

  if (error) return error.message;

  const planilla = process.env.GOOGLE_SHEETS_AVISOS_ID ?? "";
  const pestana = process.env.GOOGLE_SHEETS_AVISOS_TAB ?? "AVISOS";
  if (!planilla || !aviso?.sheets_row) return null;

  try {
    await escribirCeldas(planilla, [{
      pestana,
      fila: aviso.sheets_row,
      columna: COLUMNA_OT_ASIGNADA,
      valor: String(otNumber),
    }]);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// ── PATCH: actualizar estado de una OT desde la app ─────────────────────────
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await cuerpoJson(request);
  const { id, estado, requiere_parada_sector } = body ?? {};
  if (!id) return NextResponse.json({ error: "ID requerido" }, { status: 400 });

  // Lista blanca. No se acepta el resto del body para evitar escritura
  // arbitraria de columnas (mass-assignment).
  const update: Record<string, unknown> = { synced_at: new Date().toISOString() };

  if (estado !== undefined) {
    if (!esEstadoDeOT(estado)) {
      return NextResponse.json({ error: mensajeDeEstadoInvalido(estado) }, { status: 400 });
    }
    update.estado = estado;
  }

  // Qué va a la tabla y qué a la planilla no es lo mismo: las observaciones y
  // la foto no tienen columna en `ordenes_trabajo`. El reparto vive en
  // `repartirRegistroDeOT`, con sus tests.
  const { update: campos, registro } = repartirRegistroDeOT(body);
  Object.assign(update, campos);

  // Que el trabajo obligue a parar el sector no viene de la planilla: se marca
  // acá. Y se puede marcar en cualquier momento, no sólo al crear la OT: las
  // 1728 que vinieron de la planilla llegaron todas sin la marca.
  if (requiere_parada_sector !== undefined) {
    update.requiere_parada_sector = Boolean(requiere_parada_sector);
  }

  // `update` arranca con `synced_at`, así que uno solo quiere decir que no hay
  // nada para la tabla. Igual puede haber algo para la planilla —observaciones
  // o la foto, que no tienen columna acá—, y eso también es un cambio.
  if (Object.keys(update).length === 1 && Object.keys(registro).length === 0) {
    return NextResponse.json({ error: "No se envió ningún cambio" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: updated, error } = await admin
    .from("ordenes_trabajo").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const planilla_error = await escribirEnLaPlanilla(updated, registro);
  return NextResponse.json({ data: updated, planilla_error });
}

/**
 * Escribe en la planilla lo que se registró en la app.
 *
 * Qué celdas tocar lo decide `celdasParaRegistrar`; la escritura —con la guarda
 * de que la fila siga siendo la de esta OT— vive en `planillaDeOT.ts`, porque
 * las notas escriben la columna X por el mismo camino.
 */
async function escribirEnLaPlanilla(
  orden: FilaDeOT,
  registro: RegistroDeOT
): Promise<string | null> {
  return escribirEnLaFilaDeLaOT(orden, celdasParaRegistrar(registro));
}
