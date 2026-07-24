import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import * as XLSX from "xlsx";

const VALID_STATUSES = ["OPERATIVO","EN_MANTENIMIENTO","EN_REPARACION","STANDBY","FUERA_DE_SERVICIO","DADO_DE_BAJA"];
const VALID_CRITICALITY = ["ALTA","MEDIA","BAJA"];

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  if (rows.length === 0) return NextResponse.json({ error: "El archivo está vacío" }, { status: 400 });

  const { data: sectores } = await supabase
    .from("sectores")
    .select("id, nombre, empresas(nombre)");

  const sectorMap = new Map<string, string>(); // "EMPRESA|SECTOR" -> sector_id
  for (const s of sectores ?? []) {
    const key = `${(s.empresas as any)?.nombre?.toUpperCase() ?? "TRANSVERSAL"}|${s.nombre?.toUpperCase()}`;
    sectorMap.set(key, s.id);
  }

  const admin = createAdminClient();
  const results = { updated: 0, created: 0, errors: [] as string[] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // 1-indexed + header

    const code = String(row["Código"] ?? row["codigo"] ?? row["code"] ?? "").trim();
    const name = String(row["Nombre"] ?? row["nombre"] ?? row["name"] ?? "").trim();
    const empresaName = String(row["Empresa"] ?? row["empresa"] ?? row["Planta"] ?? row["planta"] ?? "").trim().toUpperCase();
    const sectorName = String(row["Sector"] ?? row["sector"] ?? "").trim().toUpperCase();
    const status = String(row["Estado"] ?? row["estado"] ?? row["status"] ?? "OPERATIVO").trim().toUpperCase();
    const criticality = String(row["Criticidad"] ?? row["criticidad"] ?? "MEDIA").trim().toUpperCase();
    const power_kw = row["kW"] ?? row["Potencia_kW"] ?? row["power_kw"] ?? null;
    const description = String(row["Descripción"] ?? row["Descripcion"] ?? row["description"] ?? "").trim() || null;
    const notes = String(row["Notas"] ?? row["notes"] ?? "").trim() || null;

    if (!code || !name) {
      results.errors.push(`Fila ${rowNum}: Código y Nombre son obligatorios`);
      continue;
    }

    if (status && !VALID_STATUSES.includes(status)) {
      results.errors.push(`Fila ${rowNum} (${code}): Estado inválido "${status}"`);
      continue;
    }

    if (criticality && !VALID_CRITICALITY.includes(criticality)) {
      results.errors.push(`Fila ${rowNum} (${code}): Criticidad inválida "${criticality}"`);
      continue;
    }

    const sectorKey = `${empresaName || "TRANSVERSAL"}|${sectorName}`;
    const sector_id = sectorMap.get(sectorKey);
    if (!sector_id) {
      results.errors.push(`Fila ${rowNum} (${code}): Sector "${sectorName}" en empresa "${empresaName}" no encontrado`);
      continue;
    }

    const payload: Record<string, unknown> = {
      code,
      name,
      sector_id,
      status: status || "OPERATIVO",
      criticality: criticality || "MEDIA",
      description,
      notes,
    };
    if (power_kw !== null && power_kw !== "") {
      payload.power_kw = Number(power_kw);
    }

    const { data: existing } = await admin
      .from("equipos")
      .select("id")
      .eq("code", code)
      .maybeSingle();

    if (existing) {
      const { error } = await admin.from("equipos").update(payload).eq("id", existing.id);
      if (error) results.errors.push(`Fila ${rowNum} (${code}): ${error.message}`);
      else results.updated++;
    } else {
      const { error } = await admin.from("equipos").insert(payload);
      if (error) results.errors.push(`Fila ${rowNum} (${code}): ${error.message}`);
      else results.created++;
    }
  }

  return NextResponse.json(results);
}
