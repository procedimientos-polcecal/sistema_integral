import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { leerValores, escribirCeldas, agregarFila } from "@/lib/core/sheets";
import {
  pestanaDeSector, filaParaComparativa, coincideLaFila,
  COLUMNA_ELECCION, COLUMNAS_COMPARATIVA,
} from "@/lib/mantenimiento/comparativas";
import { codigoDeEquipo } from "@/lib/mantenimiento/planilla";
import { cargarEnlaces, resolver, proveedorDe } from "@/lib/mantenimiento/enlaces";

const PLANILLA = () => process.env.GOOGLE_SHEETS_COMPARATIVAS_ID ?? "";

const SIN_PLANILLA = NextResponse.json(
  { error: "Falta configurar GOOGLE_SHEETS_COMPARATIVAS_ID" },
  { status: 503 }
);

/** GET ?os=142 — las cotizaciones que se compararon para esa OS. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const os = Number(new URL(request.url).searchParams.get("os"));
  if (!os || isNaN(os)) {
    return NextResponse.json({ error: "Falta el número de OS" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("os_comparativas")
    .select("*")
    .eq("os_number", os)
    .order("sheets_tab")
    .order("sheets_row");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

/**
 * Comprueba que la fila guardada siga siendo la de esta cotización.
 *
 * Devuelve el problema como texto, o null si se puede escribir.
 */
async function verificarFila(
  planilla: string,
  cotizacion: { sheets_tab: string | null; sheets_row: number | null; os_number: number; proveedor: string }
): Promise<string | null> {
  if (!cotizacion.sheets_tab || !cotizacion.sheets_row) {
    return "La cotización no está enlazada a ninguna fila de la planilla.";
  }

  const rango = `${cotizacion.sheets_tab}!A${cotizacion.sheets_row}:O${cotizacion.sheets_row}`;
  const fila = (await leerValores(planilla, rango, { sinFormato: true }))[0] ?? [];

  return coincideLaFila(fila, cotizacion)
    ? null
    : "La fila de la planilla ya no es la de esta cotización — alguien la movió. " +
      "Sincronizá las comparativas y volvé a intentar.";
}

/** POST — una cotización nueva: primero a la planilla, después al espejo. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Cargar una cotización requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const planilla = PLANILLA();
  if (!planilla) return SIN_PLANILLA;

  const b = await request.json().catch(() => null);
  const osNumber = Number(b?.os_number);
  const proveedor = String(b?.proveedor ?? "").trim();
  if (!osNumber || isNaN(osNumber)) {
    return NextResponse.json({ error: "Falta el número de OS" }, { status: 400 });
  }
  if (!proveedor) return NextResponse.json({ error: "Falta el proveedor" }, { status: 400 });

  const admin = createAdminClient();

  // Lo que ya sabemos de la OS: la cotización no vuelve a pedir el equipo ni
  // el sector, que son de la orden y no de la oferta.
  const { data: os } = await admin
    .from("ordenes_servicio")
    .select("area, sector_raw, equipo_raw, descripcion")
    .eq("os_number", osNumber)
    .maybeSingle();

  const sector = String(b.sector ?? os?.sector_raw ?? "").trim() || "Otros";
  const pestana = pestanaDeSector(sector);

  const cotizacion = {
    os_number: osNumber,
    fecha: b.fecha || new Date().toISOString().slice(0, 10),
    area: os?.area ?? null,
    sector,
    equipo_raw: os?.equipo_raw ?? null,
    descripcion: String(b.descripcion ?? os?.descripcion ?? "").trim() || null,
    proveedor,
    precio_unitario: String(b.precio_unitario ?? "").trim() || null,
    iva: b.iva === "" || b.iva == null ? null : Number(b.iva),
    precio_total: String(b.precio_total ?? "").trim() || null,
    vigencia_hasta: b.vigencia_hasta || null,
    plazos: String(b.plazos ?? "").trim() || null,
    condiciones_pago: String(b.condiciones_pago ?? "").trim() || null,
    otras_especificaciones: String(b.otras_especificaciones ?? "").trim() || null,
    eleccion: Boolean(b.eleccion),
  };

  // La planilla primero: si falla, no queda una cotización en la app que la
  // próxima sincronización va a borrar sin dejar rastro.
  let sheetsRow: number;
  try {
    sheetsRow = await agregarFila(planilla, pestana, filaParaComparativa(cotizacion));
  } catch (e) {
    return NextResponse.json(
      { error: `No se pudo escribir en la planilla: ${e instanceof Error ? e.message : e}` },
      { status: 502 }
    );
  }

  // Los mismos enlaces que hace la sincronización, para que una cotización
  // cargada acá quede igual de completa que una traída de la planilla.
  const enlaces = await cargarEnlaces(admin);
  const equipo_code = codigoDeEquipo(cotizacion.equipo_raw);
  const { equipment_id } = resolver(enlaces, {
    equipo_code,
    equipo_raw: cotizacion.equipo_raw,
    sector_raw: cotizacion.sector,
  });

  const { data, error } = await admin
    .from("os_comparativas")
    .insert({
      ...cotizacion,
      equipo_code,
      equipment_id,
      proveedor_id: proveedorDe(enlaces, proveedor),
      sheets_tab: pestana,
      sheets_row: sheetsRow,
      synced_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}

/**
 * PATCH — elegir o desmarcar una cotización.
 *
 * Elegir es exclusivo dentro de la OS: si se marca una, las demás quedan sin
 * marcar. Una comparativa con dos elegidas no dice nada.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Elegir el proveedor requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const planilla = PLANILLA();
  if (!planilla) return SIN_PLANILLA;

  const b = await request.json().catch(() => null);
  const id = String(b?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Falta la cotización" }, { status: 400 });
  const eleccion = Boolean(b.eleccion);

  const admin = createAdminClient();
  const { data: cot } = await admin
    .from("os_comparativas")
    .select("id, os_number, proveedor, sheets_tab, sheets_row")
    .eq("id", id)
    .maybeSingle();
  if (!cot) return NextResponse.json({ error: "No existe esa cotización" }, { status: 404 });

  // Las demás de la misma OS, para desmarcarlas.
  const { data: hermanas } = await admin
    .from("os_comparativas")
    .select("id, os_number, proveedor, sheets_tab, sheets_row, eleccion")
    .eq("os_number", cot.os_number);

  const aDesmarcar = eleccion
    ? (hermanas ?? []).filter((h) => h.id !== cot.id && h.eleccion)
    : [];

  try {
    const celdas: { pestana: string; columna: number; fila: number; valor: string }[] = [];

    for (const c of [{ ...cot, marca: eleccion }, ...aDesmarcar.map((h) => ({ ...h, marca: false }))]) {
      const problema = await verificarFila(planilla, c);
      if (problema) return NextResponse.json({ error: problema }, { status: 409 });

      celdas.push({
        pestana: c.sheets_tab!,
        fila: c.sheets_row!,
        columna: COLUMNA_ELECCION,
        valor: c.marca ? "TRUE" : "FALSE",
      });
    }

    await escribirCeldas(planilla, celdas);
  } catch (e) {
    return NextResponse.json(
      { error: `No se pudo escribir en la planilla: ${e instanceof Error ? e.message : e}` },
      { status: 502 }
    );
  }

  const { error } = await admin.from("os_comparativas").update({ eleccion }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (aDesmarcar.length > 0) {
    const { error: errorHermanas } = await admin
      .from("os_comparativas")
      .update({ eleccion: false })
      .in("id", aDesmarcar.map((h) => h.id));
    if (errorHermanas) {
      return NextResponse.json({ error: errorHermanas.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true, desmarcadas: aDesmarcar.length });
}

/** DELETE ?id= — borra una cotización y vacía su fila en la planilla. */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Borrar una cotización requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const planilla = PLANILLA();
  if (!planilla) return SIN_PLANILLA;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta la cotización" }, { status: 400 });

  const admin = createAdminClient();
  const { data: cot } = await admin
    .from("os_comparativas")
    .select("id, os_number, proveedor, sheets_tab, sheets_row")
    .eq("id", id)
    .maybeSingle();
  if (!cot) return NextResponse.json({ error: "No existe esa cotización" }, { status: 404 });

  // Vaciar la fila y no borrarla: borrarla correría todas las de abajo y
  // dejaría mal el número de fila de las demás cotizaciones.
  try {
    const problema = await verificarFila(planilla, cot);
    if (problema) return NextResponse.json({ error: problema }, { status: 409 });

    await escribirCeldas(
      planilla,
      Array.from({ length: COLUMNAS_COMPARATIVA }, (_, columna) => ({
        pestana: cot.sheets_tab!,
        fila: cot.sheets_row!,
        columna,
        valor: "",
      }))
    );
  } catch (e) {
    return NextResponse.json(
      { error: `No se pudo escribir en la planilla: ${e instanceof Error ? e.message : e}` },
      { status: 502 }
    );
  }

  const { error } = await admin.from("os_comparativas").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
