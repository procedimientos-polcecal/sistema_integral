import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarCantera, tieneAccesoCantera } from "@/lib/cantera/auth";
import { traerBochon } from "@/lib/cantera/consultas";

/**
 * Ver y editar un bochón. Los campos de conciliación (`odoo_*`, `conforme*`)
 * son de finanzas y no se tocan acá.
 */

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
function fecha(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
function texto(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s === "" ? null : s;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const { codigo } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Cantera" }, { status: 403 });
  }
  const bochon = await traerBochon(supabase, codigo);
  if (!bochon) return NextResponse.json({ error: "Ese bochón no existe" }, { status: 404 });
  return NextResponse.json({ bochon });
}

const CAMPOS_FECHA = ["inicio", "fin", "fecha_voladura"] as const;
const CAMPOS_NUM = ["cantidad", "metros_perforados", "precio_usd_m", "tc_usd"] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const { codigo } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para editar bochones" }, { status: 403 });
  }

  const bochon = await traerBochon(supabase, codigo);
  if (!bochon) return NextResponse.json({ error: "Ese bochón no existe" }, { status: 404 });

  const b = await cuerpoJson(request);
  const cambios: Record<string, unknown> = {
    actualizado_por: user.id,
    actualizado_en: new Date().toISOString(),
  };
  for (const c of CAMPOS_FECHA) if (c in b) cambios[c] = fecha(b[c]);
  for (const c of CAMPOS_NUM) if (c in b) cambios[c] = num(b[c]);
  if ("voladura_codigo" in b) cambios.voladura_codigo = texto(b.voladura_codigo);
  if ("observaciones" in b) cambios.observaciones = texto(b.observaciones);

  const { data, error } = await supabase
    .from("cantera_bochones")
    .update(cambios)
    .eq("codigo", codigo)
    .select(
      "id, codigo, yacimiento_id, anio, correlativo, voladura_codigo, inicio, fin, fecha_voladura, cantidad, metros_perforados, precio_usd_m, tc_usd, observaciones, origen"
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ bochon: data });
}
