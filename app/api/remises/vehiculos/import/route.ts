import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/remises/route-utils";

const ENCABEZADOS = ["nombre", "nombre/vehículo", "nombre/vehiculo"];

export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });

  let rows: unknown[][];
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  } catch {
    return NextResponse.json({ error: "No se pudo leer el archivo. Verificá que sea .xlsx" }, { status: 400 });
  }

  const { data: existentes } = await supabase.from("vehiculos").select("nombre");
  const nombresExistentes = new Set((existentes ?? []).map((v) => v.nombre.toLowerCase()));

  const { data: choferesExistentes } = await supabase.from("choferes").select("id, nombre");
  const choferesPorNombre = new Map((choferesExistentes ?? []).map((c) => [c.nombre.toLowerCase(), c.id]));

  let agregados = 0;
  for (const row of rows) {
    const nombre = String(row[0] ?? "").trim();
    const chofer = String(row[1] ?? "").trim();
    const capacidad = parseInt(String(row[2] ?? ""), 10) || 8;
    const telefono = String(row[3] ?? "").trim();
    if (!nombre || ENCABEZADOS.includes(nombre.toLowerCase())) continue;
    if (nombresExistentes.has(nombre.toLowerCase())) continue;

    let choferId: string | null = null;
    if (chofer) {
      const clave = chofer.toLowerCase();
      choferId = choferesPorNombre.get(clave) ?? null;
      if (!choferId) {
        const { data: nuevoChofer } = await supabase
          .from("choferes")
          .insert({ nombre: chofer, telefono: telefono || null })
          .select("id")
          .single();
        if (nuevoChofer) {
          choferId = nuevoChofer.id;
          choferesPorNombre.set(clave, nuevoChofer.id);
        }
      }
    }

    await supabase.from("vehiculos").insert({ nombre, capacidad, chofer_id: choferId });
    nombresExistentes.add(nombre.toLowerCase());
    agregados++;
  }

  return NextResponse.json({ agregados });
}
