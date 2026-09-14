import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarCantera, tieneAccesoCantera } from "@/lib/cantera/auth";
import { traerBochon, traerYacimientos } from "@/lib/cantera/consultas";
import { espejarBochon } from "@/lib/cantera/espejo";

/**
 * Ver y editar un bochón. Los campos de conciliación (`odoo_*`, `conforme*`)
 * son de finanzas y no se tocan acá.
 *
 * Al final se espeja BOCHONES en la planilla — una sola dirección, manda el
 * sistema. Un fallo no impide guardar: queda `sheets_pendiente` anotado y se
 * avisa en `planilla_error`, igual que en voladuras.
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

  const { error } = await supabase.from("cantera_bochones").update(cambios).eq("codigo", codigo);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const actualizado = await traerBochon(supabase, codigo);
  if (!actualizado) return NextResponse.json({ error: "Ese bochón no existe" }, { status: 404 });

  const yacimientos = await traerYacimientos(supabase);
  const yacimiento = yacimientos.find((y) => y.id === actualizado.yacimiento_id) ?? null;

  const espejo = await espejarBochon(actualizado, yacimiento);
  await supabase
    .from("cantera_bochones")
    .update(
      espejo.ok
        ? { sheets_pendiente: null, sheets_pendiente_en: null }
        : { sheets_pendiente: espejo.error ?? "no se pudo escribir", sheets_pendiente_en: new Date().toISOString() }
    )
    .eq("codigo", codigo);
  const conPlanilla = await traerBochon(supabase, codigo);

  return NextResponse.json({ bochon: conPlanilla ?? actualizado, planilla_error: espejo.ok ? null : espejo.error });
}
