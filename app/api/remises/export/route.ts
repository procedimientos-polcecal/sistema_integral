import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/remises/route-utils";
import { xlsxResponse, xlsxMultiSheetResponse } from "@/lib/core/xlsxExport";
import { EXPORT_HEADERS, filasParaFechas, fechasSemanaActual, nombreDia } from "@/lib/remises/exportRows";

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "day";

  if (scope === "day") {
    const fecha = url.searchParams.get("fecha");
    if (!fecha) return NextResponse.json({ error: "Falta fecha" }, { status: 400 });
    const rows = await filasParaFechas(supabase, [fecha]);
    return xlsxResponse(`rutas_${fecha}.xlsx`, "Rutas", [EXPORT_HEADERS, ...rows]);
  }

  if (scope === "week") {
    const fechas = fechasSemanaActual();
    const sheets = [];
    for (const fecha of fechas) {
      const rows = await filasParaFechas(supabase, [fecha]);
      if (rows.length) sheets.push({ name: `${nombreDia(fecha)} ${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`, rows: [EXPORT_HEADERS, ...rows] });
    }
    if (!sheets.length) return NextResponse.json({ error: "No hay rutas en la semana actual" }, { status: 400 });
    return xlsxMultiSheetResponse(`rutas_semana_${fechas[0]}.xlsx`, sheets);
  }

  // historial: últimos 90 días con rutas generadas.
  const hace90dias = new Date();
  hace90dias.setDate(hace90dias.getDate() - 90);
  const { data: fechasConRutas } = await supabase
    .from("hojas_ruta")
    .select("fecha")
    .gte("fecha", hace90dias.toISOString().slice(0, 10))
    .order("fecha", { ascending: false });
  const fechas = [...new Set((fechasConRutas ?? []).map((f) => f.fecha))];
  const rows = await filasParaFechas(supabase, fechas);
  return xlsxResponse("historial_remises.xlsx", "Historial", [EXPORT_HEADERS, ...rows]);
}
