import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { leerValores, agregarFila } from "@/lib/core/sheets";
import { cargarEnlaces, resolver } from "@/lib/mantenimiento/enlaces";
import { codigoDeEquipo } from "@/lib/mantenimiento/planilla";
import { proximoNumeroDeAviso, filaParaLaPlanilla, fechaDelAviso } from "@/lib/mantenimiento/avisos";
import { reservarClave, anotarLaClave } from "@/lib/mantenimiento/claveDeCarga";
import { hoyEnArgentina } from "@/lib/core/fechas";

const PLANILLA = () => process.env.GOOGLE_SHEETS_AVISOS_ID ?? "";
const PESTANA = () => process.env.GOOGLE_SHEETS_AVISOS_TAB ?? "AVISOS";

/**
 * Cargar un aviso: alguien vio que algo anda mal.
 *
 * Es el primer eslabón de todo el módulo, y hasta ahora sólo se podía hacer
 * abriendo la planilla. Se escribe **primero ahí** —es la base y de ahí lo lee
 * quien no usa el sistema— y después acá.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Cargar un aviso requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const planilla = PLANILLA();
  if (!planilla) {
    return NextResponse.json(
      { error: "Falta configurar GOOGLE_SHEETS_AVISOS_ID" },
      { status: 503 }
    );
  }

  const b = await request.json().catch(() => null);
  const descripcion = String(b?.descripcion ?? "").trim();
  if (!descripcion) {
    return NextResponse.json({ error: "Contá qué pasa" }, { status: 400 });
  }

  const admin = createAdminClient();

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
  // Lo que cuesta, dicho: si la lectura de la planilla falla después de
  // reservar, la clave queda en duda aunque no se haya escrito nada, y el
  // reintento recibe un 409 que manda a mirar la planilla para nada. Se
  // acepta porque ese 409 hace mirar y no perder: la carga queda parada en el
  // teléfono, con el texto de acá, hasta que una persona decida.
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

    if (reserva.decision === "ya-esta") {
      // Este aviso ya se cargó con esta clave: se devuelve el número de
      // entonces y la planilla no se toca. `data` va en null porque lo que
      // esperaba quien reintenta es su número, no la fila.
      //
      // SIN `entidad_id` EL CASO ES OTRO y no se puede contestar igual: la
      // planilla ya tiene la fila con su número y el insert en la base nunca
      // ocurrió. El número sigue siendo el bueno —el aviso existe donde
      // manda—, pero contestar "ya está" a secas dejaría a la persona
      // creyendo que está en el sistema, y hasta la próxima sincronización no
      // lo ve nadie desde acá.
      const numero = reserva.fila?.numero ?? null;
      const soloEnLaPlanilla = !reserva.fila?.entidad_id;
      return NextResponse.json({
        data: null,
        oa_number: numero,
        ya_estaba: true,
        advertencia: soloEnLaPlanilla
          ? `El aviso ${numero} quedó escrito en la planilla y todavía no está en ` +
            `el sistema: va a entrar con la próxima sincronización. No lo cargues ` +
            `de nuevo o quedan dos.`
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
      // La misma clave ya se usó para una OT. No es falta de permiso —es el
      // mismo usuario—, así que no es un 403: es un conflicto, y va con el
      // mismo 409 que la duda porque para la cola los dos son definitivos y
      // reintentar no los cambia.
      return NextResponse.json(
        { error: "Esa clave de carga ya se usó para una orden de trabajo. Cargá el aviso de nuevo." },
        { status: 409 }
      );
    }

    if (reserva.decision === "en-duda") {
      return NextResponse.json(
        {
          error:
            "Esta carga ya había arrancado y no se sabe si llegó: el aviso puede haber " +
            "quedado escrito en la planilla. Mirala antes de cargarlo de nuevo o quedan dos.",
        },
        { status: 409 }
      );
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
    // La fecha puede venir en el cuerpo: un aviso cargado sin señal el viernes
    // entra el lunes, y fecharlo el lunes corre el historial del equipo y el
    // MTBF. Qué fecha se acepta lo decide `fechaDelAviso`, con sus tests.
    fecha: fechaDelAviso(b, hoyEnArgentina()),
    sector_raw: sectorRaw,
    equipo_raw: equipoRaw,
    descripcion,
    urgencia: String(b.urgencia ?? "").trim() || null,
    quien_aviso: String(b.quien_aviso ?? "").trim() || null,
    observaciones: String(b.observaciones ?? "").trim() || null,
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
  if (clave) await anotarLaClave(admin, clave, "aviso", { numero: oa_number });

  const enlaces = await cargarEnlaces(admin);
  const equipo_code = codigoDeEquipo(equipoRaw);
  const { equipment_id, sector_id } = resolver(enlaces, {
    equipo_code,
    equipo_raw: equipoRaw,
    sector_raw: sectorRaw,
  });

  const { data, error } = await admin
    .from("avisos")
    .insert({
      ...aviso,
      equipo_code,
      equipment_id,
      sector_id: b.sector_id || sector_id,
      app_created: true,
      sheets_row,
      synced_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Segunda pasada, ahora con el id: completa lo que la de arriba no podía
  // saber. `resolverClave` no borra el número al reescribir.
  if (clave) await anotarLaClave(admin, clave, "aviso", { numero: oa_number, entidadId: data.id });

  return NextResponse.json({ data, oa_number });
}
