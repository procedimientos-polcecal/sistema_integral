import { NextResponse, after } from "next/server";
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
import {
  COLUMNA_OT_ASIGNADA, fechaDeLaCarga, type FechaDeLaCarga,
} from "@/lib/mantenimiento/avisos";
import {
  reservarClave, anotarLaClave, respuestaDeLaReserva,
} from "@/lib/mantenimiento/claveDeCarga";
import { ESTA_PENDIENTE, prioridadParaLaPlanilla } from "@/lib/mantenimiento/prioridad";
import { estadoSegunElCierre, loQueHayQueExportar } from "@/lib/mantenimiento/cierreDeOT";
import { loQueFaltaParaCrear } from "@/lib/mantenimiento/altaDeOT";
import {
  reintentarHastaQueSalga, hacePocoQueSeDreno,
} from "@/lib/mantenimiento/reintentoDePendientes";
import { exportarLoPendiente } from "@/lib/mantenimiento/sincronizar";
import { avisarDeLaCarga } from "@/lib/mantenimiento/avisarDeLaCarga";
import { paginaPedida } from "@/lib/core/paginado";
import { columnaDeFecha } from "@/lib/mantenimiento/filtrosOt";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { repuestosDelCuerpo, filasParaLaBase } from "@/lib/mantenimiento/repuestosDeLaOT";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { esquemaGut } from "@/lib/mantenimiento/gut";
import { validar, errorDeValidacion } from "@/lib/core/validar";

/**
 * Cinco minutos, que es lo que necesita el reintento del alta.
 *
 * El `after()` del POST insiste cuatro minutos esperando que la fila del master
 * aparezca. Sin esto, Vercel cortaría la función antes y el reintento no
 * serviría de nada — el test de `ESPERAS_DEL_REINTENTO` fija que las esperas
 * sumen menos que esto.
 */
export const maxDuration = 300;

/**
 * Cuándo drenó la cola esta instancia, para no hacerlo seis veces por visita.
 *
 * Vive en el módulo y no en la base porque es un freno de ráfaga y no un dato:
 * si la instancia se recicla, lo peor que pasa es un drenaje de más. Ver
 * `hacePocoQueSeDreno`.
 */
let ultimoDrenaje: number | null = null;

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
    // El orden es del servidor y no del cliente: son 2.227 filas paginadas de a
    // 50, y ordenar en el cliente ordenaría sólo la página que se está mirando —
    // la orden más urgente podría estar en la página 40 y no aparecer nunca.
    // `gut_orden` ya sube las abiertas por encima de las cerradas; el número de
    // OT desempata para que el orden sea siempre el mismo.
    .order("gut_orden", { ascending: false })
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
      // `ot_number` es `integer`: un `ilike` sobre él no existe, y buscar un
      // número con texto de por medio no es una OT. Sólo si lo escrito es un
      // número entero se suma la igualdad. «OT #1989» de Mis avisos llega acá
      // con `?q=1989`, y sin esto caía en una lista de ~2.200 sin forma de
      // encontrarla. Se acota a 9 dígitos para no desbordar el `integer`.
      const porNumero = /^\d{1,9}$/.test(safe) ? `,ot_number.eq.${safe}` : "";
      query = query.or(
        `descripcion.ilike.%${safe}%,equipo_raw.ilike.%${safe}%,sector_raw.ilike.%${safe}%${porNumero}`
      );
    }
  }

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ── Abrir Órdenes termina lo que quedó a medias ────────────
  //
  // De la K en adelante —cierre, estado, contratista, horas, operarios— las
  // columnas son literales del master, y el alta no las puede escribir porque
  // la fila todavía no existe. Quedan en `sheets_pendiente`, y hasta el
  // 21/10/2026 lo único que vaciaba esa cola era la sincronización: en la
  // práctica cada 3 a 5 horas, no cada quince minutos como dice su workflow.
  //
  // Esta pantalla la abre todo el día la gente de Mantenimiento, así que es el
  // reloj más confiable que hay — y corre con `after()`, después de contestar,
  // de modo que no le agrega ni un milisegundo a quien está mirando. El freno
  // de arriba evita que las seis consultas de una misma visita drenen seis
  // veces; `conFreno` evita insistir con una orden que se intentó recién.
  if (!hacePocoQueSeDreno(ultimoDrenaje, Date.now())) {
    ultimoDrenaje = Date.now();
    // Sin `catch`: lo que falla por orden ya queda anotado en su
    // `sheets_pendiente`, y una excepción acá es un problema de verdad que
    // tiene que verse en los logs y no morir en un `catch` vacío.
    after(() => exportarLoPendiente(createAdminClient(), { conFreno: true }));
  }

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

  // El cuerpo se lee **antes** del chequeo de permisos, y eso no cambia el
  // orden de los chequeos ni ninguna respuesta: `cuerpoJson` no tiene efectos.
  // Hace falta acá porque para avisarle por correo a quien cargó sin señal hay
  // que saber qué cargó, y el 403 llega antes que todo lo demás.
  const body = await cuerpoJson(request);
  const {
    equipment_id, sector_id, sector_raw, equipo_raw, equipo_code,
    especialidad, tipo, quien, descripcion,
    fecha, fecha_ejecucion, fecha_cierre,
    estado, contratista, horas, operario_1, operario_2, operario_3, prioridad,
    schedule_id, aviso_id,
  } = body;

  /** Lo que comparten las llamadas de abajo. Ver `avisarDeLaCarga`. */
  const deEstaCarga = {
    tipo: "orden" as const,
    descripcion: String(descripcion ?? ""),
    sector: typeof sector_raw === "string" && sector_raw.trim() ? sector_raw.trim() : null,
    fecha: typeof fecha === "string" ? fecha : "",
  };

  // El chequeo de permisos **en el mismo lugar del orden que siempre**: antes
  // que la descripción y que todo lo demás. Lo único que cambió es que ahora
  // el cuerpo ya está leído, así que el correo puede decir qué carga era.
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    avisarDeLaCarga(request, user.id, {
      ...deEstaCarga,
      status: 403,
      error: "Sin permisos",
      enDuda: false,
    });
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  if (!descripcion?.trim()) {
    const error = "La descripción es requerida";
    avisarDeLaCarga(request, user.id, {
      ...deEstaCarga, status: 400, error, enDuda: false,
    });
    return NextResponse.json({ error }, { status: 400 });
  }

  // Los repuestos vienen por renglones (`repuestos`) o como el texto suelto de
  // siempre (`repuesto`). Las dos formas conviven porque la carga sin señal
  // manda el cuerpo que armó días atrás: un teléfono sin actualizar sigue
  // mandando el texto, y tratarlo como ausente le borraría el repuesto a esa
  // OT sin que nadie se entere. El texto es lo que va a la planilla —tiene una
  // sola celda— y los renglones, a `ordenes_trabajo_repuestos`.
  const losRepuestos = repuestosDelCuerpo(body);

  // El POST no validaba el estado y el PATCH sí: cualquier texto entraba a la
  // base y de ahí a la planilla, donde `EN_LA_PLANILLA[v] ?? v` lo escribía tal
  // cual. Sin estado la OT nace por hacer, que es de donde se parte.
  if (estado !== undefined && estado !== null && estado !== "" && !esEstadoDeOT(estado)) {
    // Éste **sí es alcanzable desde la cola**: un teléfono con la app vieja
    // manda un estado que dejó de valer, y sin este aviso esa carga queda
    // parada para siempre sin que nadie se entere — el agujero exacto que todo
    // esto vino a cerrar.
    const error = mensajeDeEstadoInvalido(estado);
    avisarDeLaCarga(request, user.id, { ...deEstaCarga, status: 400, error, enDuda: false });
    return NextResponse.json({ error }, { status: 400 });
  }

  // Las tres notas GUT son opcionales y van juntas o no van —ver gut.ts—: no
  // se exige ninguna, así que `loQueFaltaParaCrear` no las mira. Lo que no
  // puede pasar es que un vacío se guarde como otra cosa que null: el
  // formulario manda `""` en un desplegable sin elegir, y un `0` o un `""` en
  // la base serían una nota que nadie puso. Lo que sí vino tiene que ser un
  // entero de 1 a 5.
  const vacioANull = (v: unknown) => (v === "" || v === undefined ? null : v);
  const gut = validar(esquemaGut, {
    gut_gravedad:  vacioANull(body.gut_gravedad),
    gut_urgencia:  vacioANull(body.gut_urgencia),
    gut_tendencia: vacioANull(body.gut_tendencia),
  });
  if (!gut.ok) {
    avisarDeLaCarga(request, user.id, {
      ...deEstaCarga, status: 400, error: gut.problemas.join(" "), enDuda: false,
    });
    return errorDeValidacion(gut.problemas);
  }

  const admin = createAdminClient();

  // Antes de la planilla, para no consumir un número por una orden incompleta.
  // La regla está acá y no sólo en el formulario porque el formulario no es el
  // único que puede llamar a esta ruta.
  const falta = loQueFaltaParaCrear({
    sector_id, equipment_id, descripcion, especialidad, tipo, quien, fecha_ejecucion,
    fecha_cierre, horas, contratista, operario_1, operario_2, operario_3,
  });
  if (falta.length > 0) {
    const error = `Falta cargar ${falta.join(", ")}.`;
    avisarDeLaCarga(request, user.id, { ...deEstaCarga, status: 400, error, enDuda: false });
    return NextResponse.json({ error }, { status: 400 });
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
  //
  // **Y POR QUÉ ACÁ NO SE SUELTA LA CLAVE, SI LA RUTA DE AVISOS SÍ LO HACE.**
  // Allá el 502 sale de `leerValores`, que sólo lee, así que el servidor sabe
  // con certeza que no escribió nada. Acá sale de `altaEnLaPlanilla`, y esa
  // función devuelve `ok:false` **también después de haber escrito la fila**:
  // cuando relee la celda y el número que quedó no es el que esperaba. O sea
  // que un 502 de abajo no distingue "no escribí" de "escribí y no sé con qué
  // número", y soltar la clave en el segundo caso dejaría al reintento escribir
  // la segunda OT —el duplicado irreversible en la fuente de verdad del
  // módulo, que es el anti-objetivo que esta tabla existe para cerrar—. Entre
  // un 409 que hace mirar de más y una OT duplicada, el 409.
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
  // como estaba —`fecha || hoy`—, porque con señal no cambia nada: queda en
  // `null`, que es lo que más abajo deja pasar la fecha del cuerpo sin mirar.
  let laFecha: FechaDeLaCarga | null = null;

  if (clave) {
    // La fecha primero: un 400 tiene que salir antes de reservar la clave, o
    // esa clave queda en duda para siempre por un cuerpo que nunca se cargó.
    laFecha = fechaDeLaCarga(fecha, hoyEnArgentina());
    if (laFecha.estado === "no-sirve") {
      avisarDeLaCarga(request, user.id, {
        ...deEstaCarga, status: 400, error: laFecha.motivo, enDuda: false,
      });
      return NextResponse.json({ error: laFecha.motivo }, { status: 400 });
    }

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

    // Qué contesta cada veredicto lo decide `respuestaDeLaReserva`, que es pura
    // y tiene los cinco fijados con tests. `null` es "seguir": la única que
    // deja crear la orden.
    const respuesta = respuestaDeLaReserva(
      reserva.decision, reserva.fila, "orden", { avisoId: aviso_id }
    );
    if (respuesta) {
      // `en-duda` es el único de los cinco veredictos donde la fila **puede**
      // estar escrita en la planilla, y por eso lleva su propio texto: decirle
      // a alguien que no se cargó cuando quizás sí termina en dos órdenes, que
      // es el anti-objetivo de toda esta función.
      avisarDeLaCarga(request, user.id, {
        ...deEstaCarga,
        status: respuesta.status,
        error: String((respuesta.cuerpo as { error?: unknown }).error ?? ""),
        enDuda: reserva.decision === "en-duda",
      });
      return NextResponse.json(respuesta.cuerpo, { status: respuesta.status });
    }
  }

  // Una sola vez, y antes de los dos usos: la misma forma va a la planilla y a
  // la base. Si se tradujera sólo al escribir, la base quedaría con las dos y
  // el filtro del listado —un `.in()` liso— seguiría sin encontrarla.
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
  //
  // ESTO NO LO CONTRADICE LA RESERVA DE LA CLAVE, que sí escribe en la base
  // antes: una fila de `cargas_offline` **no es la orden**, es la anotación de
  // que alguien la está creando. Lo que no puede existir antes que la fila de
  // la planilla es la orden, y no existe.
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
    repuesto: losRepuestos.texto,
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
  let clave_error: string | null = null;
  if (clave) {
    clave_error = await anotarLaClave(admin, clave, "orden", { numero: String(ot_number) });
  }

  const record = {
    ot_number,
    // Sin `clave`, `fecha || hoyEnArgentina()` letra por letra como estaba, y
    // llamado **acá**, que es donde se llamaba: un pedido que cruza la
    // medianoche mientras habla con Google se sigue fechando igual.
    fecha:           laFecha?.estado === "sirve" ? laFecha.fecha : fecha || hoyEnArgentina(),
    sector_id:       sector_id || null,
    sector_raw:      sector_raw || null,
    equipo_raw:      equipo_raw || null,
    equipo_code:     equipo_code || null,
    equipment_id:    equipment_id || null,
    especialidad:    especialidad || null,
    tipo:            tipo || null,
    quien:           quien || null,
    descripcion:     descripcion.trim(),
    repuesto:        losRepuestos.texto,
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
    gut_gravedad:    gut.datos.gut_gravedad ?? null,
    gut_urgencia:    gut.datos.gut_urgencia ?? null,
    gut_tendencia:   gut.datos.gut_tendencia ?? null,
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

  // ── Los repuestos, renglón por renglón ─────────────────────
  //
  // Va después del insert porque recién acá hay un id al que colgarlos, y el
  // fallo **no tumba la orden**: la OT ya existe en la planilla y en la base, y
  // su texto de repuestos —el que va a la celda— ya quedó guardado en las dos.
  // Lo que se pierde es el detalle por renglón, que se puede volver a cargar
  // desde el modal de repuestos de la orden. Reventar acá sería tirar una OT
  // buena por una lista accesoria.
  let repuestos_error: string | null = null;
  const filasDeRepuestos = filasParaLaBase(inserted.id, losRepuestos.lineas);
  if (filasDeRepuestos.length > 0) {
    const { error: errorRepuestos } = await admin
      .from("ordenes_trabajo_repuestos")
      .insert(filasDeRepuestos);
    if (errorRepuestos) {
      repuestos_error =
        `La OT se creó, pero los ${filasDeRepuestos.length} repuestos no se guardaron ` +
        `uno por uno: ${errorRepuestos.message}. En la planilla están, en el texto de la ` +
        "orden; se pueden volver a cargar desde el detalle.";
    }
  }

  // Segunda pasada, ahora con el id: completa lo que la de arriba no podía
  // saber. `resolverClave` no borra el número al reescribir.
  // El `?? clave_error` es para no borrar el fallo de la primera pasada con el
  // null de una segunda que sí anduvo.
  if (clave) {
    clave_error =
      (await anotarLaClave(
        admin, clave, "orden", { numero: String(ot_number), entidadId: inserted.id }
      )) ?? clave_error;
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
  let planilla_reintentando = false;
  const paraLaPlanilla = loQueHayQueExportar(inserted);

  if (paraLaPlanilla) {
    const celdas = celdasParaRegistrar(paraLaPlanilla);
    planilla_error = await escribirEnLaFilaDeLaOT(inserted, celdas);

    await admin
      .from("ordenes_trabajo")
      .update({
        sheets_pendiente: planilla_error,
        sheets_intentado_en: new Date().toISOString(),
      })
      .eq("id", inserted.id);

    // ── Y SI NO SALIÓ, SE INSISTE ─────────────────────────────
    //
    // Este intento **nunca salió ni una vez**: medido el 21/10/2026 sobre las
    // cinco órdenes que tenían algo que exportar, las cinco fallaron acá, a los
    // 0,6 segundos del alta. No podía ser de otra forma: la fila del master
    // llega por `IMPORTRANGE` y no existe todavía.
    //
    // Lo que seguía era la cola, y la cola la vaciaba sólo la sincronización,
    // que corre cada 3 a 5 horas. Resultado: de la K en adelante —cierre,
    // estado, contratista, horas, operarios— la planilla quedaba incompleta
    // entre 3 horas y 53. La 2796 esperó 53 horas.
    //
    // `after()` corre **después de haberle contestado a la persona**, así que
    // los cuatro minutos de espera no los paga nadie mirando una pantalla. Y no
    // reemplaza a la cola: si tampoco sale, la orden queda anotada con el
    // último error y la terminan el drenaje de la pantalla o la sincronización.
    if (planilla_error) {
      planilla_reintentando = true;
      after(async () => {
        const r = await reintentarHastaQueSalga({
          intentar: () => escribirEnLaFilaDeLaOT(inserted, celdas),
        });
        await admin
          .from("ordenes_trabajo")
          .update({
            sheets_pendiente: r.error,
            sheets_intentado_en: new Date().toISOString(),
          })
          .eq("id", inserted.id);
      });
    }
  }

  // Si nace de un aviso, el aviso queda apuntando a ella: es lo que evita que
  // alguien genere dos órdenes para el mismo problema.
  let aviso_error: string | null = null;
  if (aviso_id) {
    aviso_error = await marcarElAviso(admin, aviso_id, inserted.id, ot_number);
  }

  return NextResponse.json({
    data: inserted, ot_number, aviso_error, planilla_error, planilla_reintentando,
    clave_error, repuestos_error,
  });
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
