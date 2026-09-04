import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { puedeAprobarOS } from "@/lib/compras/auth";
import { leerValores, escribirCeldas, letraDeColumna } from "@/lib/core/sheets";
import { ALIAS_OS, claveDeEncabezado, puedeEscribirse, pestanaDeArea } from "@/lib/mantenimiento/os";
import {
  dondeSeEscribeElEstado, esDenegacionDeOS, faltaLaJustificacion,
  seguroParaElMaestro, POR_QUE_HACE_FALTA,
} from "@/lib/mantenimiento/denegacion";
import {
  aprobarCorreriaFilas, esAprobacionDeOS, porQueNoSePuedeAprobar,
} from "@/lib/mantenimiento/aprobacion";

const PLANILLA = () => process.env.GOOGLE_SHEETS_OS_ID ?? "";

/** GET — el listado, con filtros. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const area = params.get("area");
  const estado = params.get("estado");
  const busqueda = (params.get("q") ?? "").trim();

  let query = supabase
    .from("ordenes_servicio")
    .select("*, equipos(name, code), sectores(nombre)")
    .order("os_number", { ascending: false })
    .limit(500);

  if (area) query = query.eq("area", area);
  if (estado) query = query.ilike("estado", estado);
  if (busqueda) {
    // Los comodines y las comas parten la sintaxis de `or`, así que se sacan.
    const limpio = busqueda.replace(/[,()*\\%]/g, "").trim();
    if (limpio) {
      query = query.or(
        `descripcion.ilike.%${limpio}%,equipo_raw.ilike.%${limpio}%,` +
        `sector_raw.ilike.%${limpio}%,proveedor_elegido.ilike.%${limpio}%`
      );
    }
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

/**
 * Escribe en la planilla lo que se cambió en la app.
 *
 * Best-effort a propósito: la app ya guardó: que Google esté caído o que la
 * planilla no esté compartida como editor no puede tirar abajo el cambio. Se
 * devuelve el problema para que la pantalla lo muestre.
 */
async function escribirEnPlanilla(
  orden: { os_number: number | null; sheets_tab: string | null; sheets_row: number | null },
  campos: { clave: string; valor: string }[]
): Promise<string | null> {
  const planilla = PLANILLA();
  const pestana = orden.sheets_tab;
  const fila = orden.sheets_row;
  if (!planilla || !pestana || !fila) return null;

  // SERVICIOS es todo fórmula salvo dos columnas escritas a mano, y una de
  // ellas es el estado maestro: el que lee el FILTER de cada pestaña de área y
  // por lo tanto el que decide si la OS llega a su pestaña.
  //
  // Esto importa para denegar. Una OS que todavía no se aprobó vive sólo acá
  // —son 11 hoy, justo las candidatas naturales a denegarse— y antes no se le
  // escribía nada: la denegación quedaba en el sistema y la planilla seguía
  // mostrándola por aprobar. Ahora se escribe el estado, y sólo el estado: el
  // resto de la hoja es QUERY(IMPORTRANGE(...)) y escribir ahí no cambia el
  // dato, rompe la fórmula y con ella toda la pestaña.
  //
  // Y no cualquier estado: `APROBADO` es el único que el FILTER de las pestañas
  // levanta, y levantar una fila corre las de abajo mientras el seguimiento
  // escrito a mano no se corre con ellas. Aprobar sigue siendo a mano en la
  // planilla; denegar es seguro porque la OS ya estaba afuera y sigue afuera.
  //
  // `true` en el segundo argumento no es un dato: es la postura. Esta función
  // **nunca aprueba**. Aprobar exige leer la pestaña del área para saber si la
  // fila entraría en el medio, y eso pasa antes, en el PATCH, porque si no se
  // puede escribir hay que abortar el cambio entero en vez de guardarlo igual.
  // Acá, con `true`, cualquier `APROBADO` que llegue queda descartado.
  const soloElEstado = dondeSeEscribeElEstado(pestana) === "maestro";
  const escribibles = campos.filter((c) =>
    soloElEstado
      ? c.clave === "estado" && seguroParaElMaestro(c.valor, true)
      : puedeEscribirse(c.clave)
  );

  if (soloElEstado && escribibles.length === 0) {
    return "Esta OS todavía no está aprobada, así que en la planilla sólo se le puede escribir " +
           "el estado, y aprobarla desde acá correría las filas de la pestaña de su área. " +
           "Se guardó en el sistema.";
  }

  try {
    const encabezado = (await leerValores(planilla, `${pestana}!1:1`))[0] ?? [];
    const claves = encabezado.map(claveDeEncabezado);

    // Que la fila siga siendo la de esta OS. El FILTER de la pestaña corre las
    // filas cuando una orden entra o sale, y el seguimiento escrito a mano no
    // se corre con ellas: escribir a ciegas se lo daría a otra orden.
    const columnaNumero = claves.findIndex((h) =>
      ALIAS_OS.os_number.some((a) => claveDeEncabezado(a) === h)
    );
    const enLaPlanilla = (await leerValores(
      planilla, `${pestana}!A${fila}:Z${fila}`, { sinFormato: true }
    ))[0] ?? [];

    if (Number(enLaPlanilla[columnaNumero >= 0 ? columnaNumero : 0]) !== orden.os_number) {
      return `La fila ${fila} de "${pestana}" ya no es la de la OS #${orden.os_number}. ` +
             "Sincronizá las órdenes de servicio y volvé a intentar.";
    }

    const celdas = escribibles
      .map((c) => ({
        columna: claves.findIndex((h) =>
          (ALIAS_OS[c.clave] ?? []).some((a) => claveDeEncabezado(a) === h)
        ),
        valor: c.valor,
      }))
      .filter((c) => c.columna >= 0)
      .map((c) => ({ pestana, fila, columna: c.columna, valor: c.valor }));

    // Que no se encuentre ninguna columna no puede terminar en un no-op mudo.
    //
    // Cada pestaña armó su encabezado a su manera y no todas traen las mismas
    // columnas, así que saltear una que falta es lo esperado. Que falten todas
    // no: significa que el encabezado no se parece a ninguno de los alias, y
    // entonces el cambio quedó sólo en el sistema. Importa sobre todo al
    // denegar en SERVICIOS, donde la única celda que se escribe es el estado.
    if (celdas.length === 0) {
      const cuales = escribibles.map((c) => c.clave).join(", ");
      return `En "${pestana}" no se encontró la columna de ${cuales}, así que el cambio ` +
             "no se pudo escribir en la planilla. Se guardó en el sistema.";
    }

    await escribirCeldas(planilla, celdas);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * El número de OS más alto que ya está en la pestaña de un área.
 *
 * Es la cuenta de la que depende poder aprobar: el `FILTER` conserva el orden
 * ascendente —medido sobre las 228 filas, cero desórdenes en las siete
 * pestañas—, así que una OS con número mayor que este máximo entra al final y no
 * corre el seguimiento de nadie.
 *
 * `maximo: null` es una pestaña sin ninguna OS, que es el caso seguro. **No se
 * usa `null` para "no se pudo leer"**: ahí devuelve `ok: false`, y quien lo
 * llama tiene que negarse. Confundir las dos cosas haría que un problema de
 * lectura se lea como permiso para escribir, que es justo al revés.
 */
type MaximoDePestana =
  | { ok: true; maximo: number | null }
  | { ok: false; error: string };

async function maximoDeLaPestana(
  planilla: string, pestana: string
): Promise<MaximoDePestana> {
  try {
    const encabezado = (await leerValores(planilla, `${pestana}!1:1`))[0] ?? [];
    const claves = encabezado.map(claveDeEncabezado);

    // Si el encabezado no nombra la columna vale la A, igual que en
    // `mapearEncabezados`: el número de OS siempre está primero.
    const columna = claves.findIndex((h) =>
      ALIAS_OS.os_number.some((a) => claveDeEncabezado(a) === h)
    );
    const letra = letraDeColumna(columna >= 0 ? columna : 0);

    const filas = await leerValores(
      planilla, `${pestana}!${letra}2:${letra}`, { sinFormato: true }
    );
    const numeros = filas
      .map((f) => Number(f?.[0]))
      .filter((n) => Number.isFinite(n) && n > 0);

    return { ok: true, maximo: numeros.length > 0 ? Math.max(...numeros) : null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Escribe `APROBADO` en el estado maestro, en `SERVICIOS`.
 *
 * Va aparte de `escribirEnPlanilla()` y no es best-effort. Una OS aprobada en el
 * sistema y sin `APROBADO` en la planilla **no llega nunca a la pestaña de su
 * área**: nadie del área la ve, la comparativa no aparece, y el sistema dice que
 * sí mientras la planilla la sigue mostrando por aprobar. Por eso esto corre
 * antes del update y, si falla, el cambio no se guarda.
 *
 * Sólo esa celda. El resto de `SERVICIOS` es `QUERY(IMPORTRANGE(...))`, y
 * escribir ahí no cambia el dato: rompe la fórmula y con ella toda la pestaña.
 */
async function aprobarEnElMaestro(
  planilla: string,
  orden: { os_number: number | null; sheets_tab: string | null; sheets_row: number | null }
): Promise<string | null> {
  const pestana = orden.sheets_tab;
  const fila = orden.sheets_row;
  if (!pestana || !fila) return "La OS no tiene fila en la planilla.";

  const encabezado = (await leerValores(planilla, `${pestana}!1:1`))[0] ?? [];
  const claves = encabezado.map(claveDeEncabezado);

  const columnaNumero = claves.findIndex((h) =>
    ALIAS_OS.os_number.some((a) => claveDeEncabezado(a) === h)
  );
  const enLaPlanilla = (await leerValores(
    planilla, `${pestana}!A${fila}:Z${fila}`, { sinFormato: true }
  ))[0] ?? [];

  if (Number(enLaPlanilla[columnaNumero >= 0 ? columnaNumero : 0]) !== orden.os_number) {
    return `La fila ${fila} de "${pestana}" ya no es la de la OS #${orden.os_number}. ` +
           "Sincronizá las órdenes de servicio y volvé a intentar.";
  }

  const columnaEstado = claves.findIndex((h) =>
    ALIAS_OS.estado.some((a) => claveDeEncabezado(a) === h)
  );
  if (columnaEstado < 0) {
    return `En "${pestana}" no se encontró la columna de estado, así que la ` +
           "aprobación no se puede escribir en la planilla.";
  }

  await escribirCeldas(planilla, [
    { pestana, fila, columna: columnaEstado, valor: "APROBADO" },
  ]);
  return null;
}

/** Una fecha ISO como la escribe la planilla. */
const fechaAR = (iso: string | null | undefined): string =>
  iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("es-AR") : "";

/** PATCH — seguimiento de una OS: estado, fechas y proveedor. */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  // Dos permisos distintos y no uno. Hacer el seguimiento de una OS —proveedor,
  // costo, fechas— es el trabajo de Mantenimiento; decidir si se hace o no es de
  // quien está en `os_aprobadores`, que puede no tener nada que ver con el
  // módulo. Quien sólo aprueba entra, pero nada más que a decidir: eso se
  // comprueba abajo, campo por campo.
  const [puedeEditar, aprobador] = await Promise.all([
    puedeEditarMantenimiento(supabase, user.id),
    puedeAprobarOS(supabase, user.id),
  ]);

  if (!puedeEditar && !aprobador) {
    return NextResponse.json(
      { error: "Editar una orden de servicio requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const id = String(body?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Falta la orden" }, { status: 400 });

  // Sólo estos campos: el resto lo manda la planilla.
  const update: Record<string, unknown> = {};
  const enPlanilla: { clave: string; valor: string }[] = [];

  const texto = (v: unknown) => String(v ?? "").trim() || null;

  if (body.estado !== undefined) {
    update.estado = texto(body.estado);
    enPlanilla.push({ clave: "estado", valor: String(update.estado ?? "") });
  }
  if (body.proveedor_elegido !== undefined) {
    update.proveedor_elegido = texto(body.proveedor_elegido);
    enPlanilla.push({ clave: "proveedor_elegido", valor: String(update.proveedor_elegido ?? "") });
  }
  if (body.fecha_pedido !== undefined) {
    update.fecha_pedido = body.fecha_pedido || null;
    enPlanilla.push({ clave: "fecha_pedido", valor: fechaAR(body.fecha_pedido) });
  }
  if (body.fecha_realizacion !== undefined) {
    update.fecha_realizacion = body.fecha_realizacion || null;
    enPlanilla.push({ clave: "fecha_realizacion", valor: fechaAR(body.fecha_realizacion) });
  }
  if (body.observaciones !== undefined) {
    update.observaciones = texto(body.observaciones);
    enPlanilla.push({ clave: "observaciones", valor: String(update.observaciones ?? "") });
  }
  // El motivo no va a la planilla: la única columna de texto libre que la app
  // escribe allá es OBSERVACIONES, que es de uso general y tiene notas cargadas
  // que no son motivos. Pisarla perdería datos, y agregar el motivo al final
  // dejaría un campo donde después no se distingue una cosa de la otra.
  if (body.motivo_rechazo !== undefined) {
    update.motivo_rechazo = texto(body.motivo_rechazo);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No hay nada para cambiar" }, { status: 400 });
  }

  // Quien está en la lista pero no edita Mantenimiento decide y nada más. Sin
  // esto, sumar a alguien para que apruebe le daría de yapa el seguimiento
  // entero —proveedor, costo, fechas—, que es de otro.
  const SOLO_DECIDIR = ["estado", "motivo_rechazo"];
  if (!puedeEditar) {
    const deMas = Object.keys(update).filter((c) => !SOLO_DECIDIR.includes(c));
    if (deMas.length > 0) {
      return NextResponse.json(
        {
          error: "Estar en la lista de aprobadores alcanza para aprobar o denegar, " +
                 `no para cambiar ${deMas.join(", ")}. Eso requiere nivel de edición ` +
                 "en Mantenimiento.",
        },
        { status: 403 }
      );
    }
  }

  const admin = createAdminClient();

  // ── Aprobar ─────────────────────────────────────────────────
  //
  // Es el único cambio que se escribe en la planilla ANTES de guardarse, y el
  // único que se rechaza entero si la planilla no lo acepta. La razón está en
  // `aprobarEnElMaestro()`: una OS aprobada sólo en el sistema no llega nunca a
  // la pestaña de su área.
  if (esAprobacionDeOS(update.estado)) {
    const { data: orden } = await admin
      .from("ordenes_servicio")
      .select("os_number, area, sheets_tab, sheets_row")
      .eq("id", id)
      .maybeSingle();

    if (!orden) return NextResponse.json({ error: "No existe esa orden" }, { status: 404 });

    // La lista gatea la **decisión**, no la palabra.
    //
    // Una OS que sigue en SERVICIOS todavía no se aprobó: ponerle APROBADO es
    // decidir, y eso lo hace quien está en la lista. Una que ya está en la
    // pestaña de su área fue aprobada hace rato —el FILTER la levantó por eso—
    // y ahí el estado es seguimiento como cualquier otro campo, que es trabajo
    // de Mantenimiento. Pedir la lista también para ese caso le sacaría a
    // Mantenimiento algo que hoy hace, sin que nadie decida nada.
    const esLaDecision = dondeSeEscribeElEstado(orden.sheets_tab) === "maestro";

    if (esLaDecision && !aprobador) {
      return NextResponse.json(
        { error: "Aprobar una orden de servicio requiere estar en la lista de aprobadores de OS" },
        { status: 403 }
      );
    }

    const planilla = PLANILLA();
    if (planilla && esLaDecision) {
      const pestana = pestanaDeArea(orden.area);
      const maximo = await maximoDeLaPestana(planilla, pestana);

      if (!maximo.ok) {
        return NextResponse.json(
          {
            error: `No se pudo leer la pestaña "${pestana}" para saber si aprobar ` +
                   `correría sus filas, así que no se aprobó: ${maximo.error}`,
          },
          { status: 502 }
        );
      }

      if (aprobarCorreriaFilas(orden.os_number ?? 0, maximo.maximo)) {
        return NextResponse.json(
          { error: porQueNoSePuedeAprobar(orden.os_number ?? 0, pestana, maximo.maximo) },
          { status: 409 }
        );
      }

      const problema = await aprobarEnElMaestro(planilla, orden).catch((e) =>
        e instanceof Error ? e.message : String(e)
      );
      if (problema) {
        return NextResponse.json(
          { error: `No se aprobó: ${problema}` },
          { status: 502 }
        );
      }

      // Ya quedó escrito. Sacarlo de la lista evita que el escritor de después
      // lo intente otra vez —y lo descarte, porque nunca aprueba— dejando un
      // aviso de que no se pudo escribir algo que sí se escribió.
      const i = enPlanilla.findIndex((c) => c.clave === "estado");
      if (i >= 0) enPlanilla.splice(i, 1);
    }
  }

  // Denegar le cierra la puerta a quien pidió el trabajo, así que no puede ser
  // mudo. La regla vive acá y no sólo en el formulario: una validación que
  // existe en el botón deja de existir apenas alguien llame a la API de otra
  // forma.
  //
  // El motivo que cuenta es el que queda: si ya había uno cargado, volver a
  // guardar la OS denegada no exige repetirlo.
  if (esDenegacionDeOS(update.estado)) {
    // Se lee sólo acá: guardar una fecha o el proveedor no tiene por qué pagar
    // un viaje más a la base.
    let motivo = update.motivo_rechazo;
    if (!("motivo_rechazo" in update)) {
      const { data: previa } = await admin
        .from("ordenes_servicio")
        .select("motivo_rechazo")
        .eq("id", id)
        .maybeSingle();
      motivo = previa?.motivo_rechazo;
    }

    if (faltaLaJustificacion(update.estado, motivo)) {
      return NextResponse.json({ error: POR_QUE_HACE_FALTA }, { status: 400 });
    }
  }

  const { data, error } = await admin
    .from("ordenes_servicio")
    .update(update)
    .eq("id", id)
    .select("*, equipos(name, code), sectores(nombre)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const planilla_error = await escribirEnPlanilla(data, enPlanilla);

  return NextResponse.json({ data, planilla_error });
}

/**
 * No hay POST: las órdenes de servicio **no se crean acá**.
 *
 * `SERVICIOS` importa sus columnas del formulario de Google donde se piden, y
 * las pestañas de área son un `FILTER` sobre ella. Agregar una fila desde la
 * app quedaría fuera del rango de la fórmula, sin número asignado y sin
 * aparecer en ninguna pestaña. Una OS se pide en el formulario; acá se le hace
 * el seguimiento.
 */
