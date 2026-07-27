import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { esAdminRrhh } from "@/lib/rrhh/auth";
import { crearStaging } from "@/lib/rrhh/staging";
import { parseWorkbookAllSheets, pickBestSheet, type ParsedSheet } from "@/lib/rrhh/excelImport";

const KEYWORDS = ["legajo", "nombre", "apellido", "hora", "sindicato", "sector", "empresa"];

function sheetSummary(sheetNames: string[], sheet: string, parsed: ParsedSheet) {
  return {
    sheetNames,
    sheet,
    headers: parsed.headers,
    sample: parsed.rows.slice(0, 15),
    totalRows: parsed.rows.length,
  };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminRrhh(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });

  let sheetNames: string[], sheets: Record<string, ParsedSheet>;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    ({ sheetNames, sheets } = parseWorkbookAllSheets(buffer));
  } catch {
    return NextResponse.json({ error: "No se pudo leer el archivo. Verificá que sea .xlsx o .csv" }, { status: 400 });
  }

  const nonEmpty = sheetNames.filter((n) => sheets[n].rows.length > 0);
  if (nonEmpty.length === 0) return NextResponse.json({ error: "El archivo no tiene filas en ninguna hoja" }, { status: 400 });
  const sheet = pickBestSheet(nonEmpty, sheets, KEYWORDS);

  const token = await crearStaging(supabase, user.id, "empleados", { sheetNames, sheets });

  return NextResponse.json({ token, ...sheetSummary(sheetNames, sheet, sheets[sheet]) });
}
