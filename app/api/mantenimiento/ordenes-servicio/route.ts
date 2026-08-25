import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { leerValores, escribirCeldas, agregarFila } from "@/lib/core/sheets";
import { cargarEnlaces, resolver } from "@/lib/mantenimiento/enlaces";
import { codigoDeEquipo } from "@/lib/mantenimiento/planilla";
import {
  ALIAS_OS, claveDeEncabezado, filaParaPlanilla,
} from "@/lib/mantenimiento/os";

const PLANILLA = () => process.env.GOOGLE_SHEETS_OS_ID ?? "";

/** Las OS nuevas se cargan siempre en la hoja maestra. */
const HOJA_MAESTRA = "SERVICIOS";

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
  pestana: string, fila: number, campos: { clave: string; valor: string }[]
): Promise<string | null> {
  const planilla = PLANILLA();
  if (!planilla || !pestana || !fila) return null;

  try {
    const encabezado = (await leerValores(planilla, `${pestana}!1:1`))[0] ?? [];
    const claves = encabezado.map(claveDeEncabezado);

    const celdas = campos
      .map((c) => ({
        columna: claves.findIndex((h) =>
          (ALIAS_OS[c.clave] ?? []).some((a) => claveDeEncabezado(a) === h)
        ),
        valor: c.valor,
      }))
      .filter((c) => c.columna >= 0)
      .map((c) => ({ pestana, fila, columna: c.columna, valor: c.valor }));

    await escribirCeldas(planilla, celdas);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Una fecha ISO como la escribe la planilla. */
const fechaAR = (iso: string | null | undefined): string =>
  iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("es-AR") : "";

/** PATCH — seguimiento de una OS: estado, fechas y proveedor. */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
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

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No hay nada para cambiar" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ordenes_servicio")
    .update(update)
    .eq("id", id)
    .select("*, equipos(name, code), sectores(nombre)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const planilla_error = await escribirEnPlanilla(
    data.sheets_tab, data.sheets_row, enPlanilla
  );

  return NextResponse.json({ data, planilla_error });
}

/** POST — una OS nueva, que además se agrega a la planilla. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Crear una orden de servicio requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const b = await request.json().catch(() => null);
  const descripcion = String(b?.descripcion ?? "").trim();
  const area = String(b?.area ?? "").trim();
  if (!descripcion) return NextResponse.json({ error: "Falta la descripción" }, { status: 400 });
  if (!area) return NextResponse.json({ error: "Falta el área" }, { status: 400 });

  const admin = createAdminClient();

  // El próximo número. La planilla y la app comparten la numeración, así que
  // conviene sincronizar antes de crear.
  const { data: ultima } = await admin
    .from("ordenes_servicio")
    .select("os_number")
    .order("os_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const osNumber = (ultima?.os_number ?? 0) + 1;

  const equipoRaw = String(b.equipo_raw ?? "").trim() || null;
  const equipoCode = codigoDeEquipo(equipoRaw);
  const sectorRaw = String(b.sector_raw ?? "").trim() || null;

  const enlaces = await cargarEnlaces(admin);
  const { equipment_id, sector_id } = resolver(enlaces, {
    equipo_code: equipoCode,
    sector_raw: sectorRaw,
  });

  const hoy = new Date().toISOString().slice(0, 10);
  const registro = {
    os_number: osNumber,
    fecha: hoy,
    area,
    sector_raw: sectorRaw,
    sector_id: b.sector_id || sector_id,
    equipo_raw: equipoRaw,
    equipo_code: equipoCode,
    equipment_id,
    descripcion,
    detalle_extra: String(b.detalle_extra ?? "").trim() || null,
    prioridad: String(b.prioridad ?? "").trim() || null,
    empresa: String(b.empresa ?? "").trim() || null,
    proveedor_elegido: String(b.proveedor_elegido ?? "").trim() || null,
    estado: String(b.estado ?? "").trim() || "PENDIENTE",
    observaciones: String(b.observaciones ?? "").trim() || null,
    app_created: true,
    sheets_tab: HOJA_MAESTRA,
    created_by: user.id,
  };

  const { data, error } = await admin
    .from("ordenes_servicio")
    .insert(registro)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Y a la planilla, que es la base de información. Si falla, la OS ya existe
  // en la app: se avisa y queda para escribirla a mano.
  let planilla_error: string | null = null;
  const planilla = PLANILLA();
  if (planilla) {
    try {
      const encabezado = (await leerValores(planilla, `${HOJA_MAESTRA}!1:1`))[0] ?? [];
      const fila = filaParaPlanilla(encabezado, {
        os_number: osNumber,
        fecha: fechaAR(hoy),
        area: registro.area,
        sector_raw: registro.sector_raw,
        equipo_raw: registro.equipo_raw,
        descripcion: registro.descripcion,
        detalle_extra: registro.detalle_extra,
        prioridad: registro.prioridad,
        empresa: registro.empresa,
        proveedor_elegido: registro.proveedor_elegido,
        estado: registro.estado,
        observaciones: registro.observaciones,
      });
      // El número siempre va primero, aunque el encabezado no se reconozca.
      if (fila.length > 0) fila[0] = osNumber;

      const numeroFila = await agregarFila(planilla, HOJA_MAESTRA, fila);
      await admin.from("ordenes_servicio").update({ sheets_row: numeroFila }).eq("id", data.id);
    } catch (e) {
      planilla_error = e instanceof Error ? e.message : String(e);
    }
  } else {
    planilla_error = "Falta configurar GOOGLE_SHEETS_OS_ID: la OS quedó sólo en la app.";
  }

  return NextResponse.json({ data, os_number: osNumber, planilla_error });
}
