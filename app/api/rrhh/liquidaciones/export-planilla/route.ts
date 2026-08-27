import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { es_admin_check } from "@/lib/rrhh/route-utils";
import { xlsxResponse } from "@/lib/core/xlsxExport";
import { calcularPlanillaGeneral, parseModalidad } from "@/lib/rrhh/planillaGeneral";

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const desde = url.searchParams.get("desde");
  const hasta = url.searchParams.get("hasta");
  if (!desde || !hasta) return NextResponse.json({ error: "Faltan desde/hasta" }, { status: 400 });

  const filas = await calcularPlanillaGeneral(supabase, desde, hasta, parseModalidad(url.searchParams.get("modalidadPago")));

  const rows: unknown[][] = [
    [
      "Nombre",
      "Legajo",
      "Tipo",
      "Horas normales",
      "H. Extra 50%",
      "H. Extra 100%",
      "Franco comp.",
      "Horas vacaciones",
      "Horas enfermedad",
      "$ Hora normal",
      "$ Extra 50%",
      "$ Extra 100%",
      "$ Franco comp.",
      "$ Total",
    ],
    ...filas.map((f) => [
      f.nombre,
      f.legajo,
      f.modalidadPago === "MENSUAL" ? "Mensual" : "Jornal",
      f.horasNormales,
      f.horasExtra50,
      f.horasExtra100,
      f.horasFranco,
      f.horasVacaciones,
      f.horasEnfermedad,
      f.montoNormal,
      f.montoExtra50,
      f.montoExtra100,
      f.montoFranco,
      f.montoTotal,
    ]),
  ];

  return xlsxResponse(`planilla-general-${desde}-a-${hasta}.xlsx`, "Planilla general", rows);
}
