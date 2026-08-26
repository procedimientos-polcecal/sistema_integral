import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { leerValores, agregarFila } from "@/lib/core/sheets";
import { cargarEnlaces, resolver } from "@/lib/mantenimiento/enlaces";
import { codigoDeEquipo } from "@/lib/mantenimiento/planilla";
import { proximoNumeroDeAviso, filaParaLaPlanilla } from "@/lib/mantenimiento/avisos";

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
    fecha: new Date().toISOString().slice(0, 10),
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
  return NextResponse.json({ data, oa_number });
}
