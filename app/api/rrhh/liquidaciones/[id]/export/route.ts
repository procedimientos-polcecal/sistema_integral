import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { es_admin_check } from "@/lib/rrhh/route-utils";
import { xlsxResponse } from "@/lib/rrhh/xlsxExport";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const { data: liquidacion, error } = await supabase
    .from("liquidaciones")
    .select("*, empleados(legajo, nombre, apellido)")
    .eq("id", id)
    .single();
  if (error || !liquidacion) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const rows = [
    ["Legajo", liquidacion.empleados?.legajo],
    ["Empleado", `${liquidacion.empleados?.apellido}, ${liquidacion.empleados?.nombre}`],
    [
      "Período",
      `${new Date(liquidacion.fecha_desde).toLocaleDateString("es-AR", { timeZone: "UTC" })} - ${new Date(liquidacion.fecha_hasta).toLocaleDateString("es-AR", { timeZone: "UTC" })}`,
    ],
    ["Tipo", liquidacion.tipo],
    [],
    ["Concepto", "Horas", "Monto"],
    ["Horas normales", liquidacion.horas_normales, liquidacion.monto_normal],
    ["Horas extra 50%", liquidacion.horas_extra_50, liquidacion.monto_extra_50],
    ["Horas extra 100%", liquidacion.horas_extra_100, liquidacion.monto_extra_100],
    [],
    ["Total bruto", "", liquidacion.total_bruto],
  ];

  return xlsxResponse(`liquidacion-${liquidacion.empleados?.legajo}-${liquidacion.id}.xlsx`, "Liquidación", rows);
}
