import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/rrhh/route-utils";
import { leerStaging } from "@/lib/rrhh/staging";
import type { ParsedSheet } from "@/lib/rrhh/excelImport";

export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const { token, sheet } = await request.json();
  if (!token || !sheet) return NextResponse.json({ error: "Falta token o nombre de hoja" }, { status: 400 });

  const entry = await leerStaging<{ nombreArchivo: string; sheetNames: string[]; sheets: Record<string, ParsedSheet> }>(supabase, token, "fichadas");
  if (!entry) return NextResponse.json({ error: "La vista previa expiró, volvé a subir el archivo" }, { status: 400 });
  const parsed = entry.sheets[sheet];
  if (!parsed) return NextResponse.json({ error: "Esa hoja no existe en el archivo" }, { status: 400 });

  return NextResponse.json({
    sheetNames: entry.sheetNames,
    sheet,
    headers: parsed.headers,
    sample: parsed.rows.slice(0, 15),
    totalRows: parsed.rows.length,
  });
}
