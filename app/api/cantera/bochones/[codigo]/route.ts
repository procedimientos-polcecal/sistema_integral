import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { esAdminCantera, puedeEditarCantera, tieneAccesoCantera } from "@/lib/cantera/auth";
import { traerBochon, traerYacimientos } from "@/lib/cantera/consultas";
import { desespejarBochon, espejarBochon, espejarBochonRenombrado } from "@/lib/cantera/espejo";
import { reacomodarCorrelativos } from "@/lib/cantera/codigos";

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

/**
 * Borra un bochón cargado de más y **reacomoda los códigos** de los que quedan:
 * si se borra el B03 de cinco, el B04 pasa a ser B03 y el B05 pasa a ser B04,
 * así la próxima alta sigue sin huecos.
 *
 * Sólo admin de Cantera, igual que borrar una voladura: no se deshace. Y acá
 * pesa más, porque reacomodar cambia el código de otros bochones — también en
 * la planilla, donde cada fila se reescribe por su código viejo. Una factura de
 * Odoo vinculada viaja con su bochón (se enlaza por id de Odoo, no por código);
 * la del bochón borrado queda libre para vincularse a otro.
 *
 * Un fallo de la planilla no deshace nada en el sistema: el borrado y los
 * renombres ya están hechos, y la respuesta trae lo que dijo Google para
 * mostrarlo una vez. En los renombrados queda además `sheets_pendiente`.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const { codigo } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!(await esAdminCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sólo un admin de Cantera puede borrar un bochón" }, { status: 403 });
  }

  const bochon = await traerBochon(supabase, codigo);
  if (!bochon) return NextResponse.json({ error: "Ese bochón no existe" }, { status: 404 });

  const yacimientos = await traerYacimientos(supabase);
  const yacimiento = yacimientos.find((y) => y.id === bochon.yacimiento_id) ?? null;
  if (!yacimiento) return NextResponse.json({ error: "La cantera de este bochón no existe" }, { status: 404 });

  const { error: errDel } = await supabase.from("cantera_bochones").delete().eq("codigo", codigo);
  if (errDel) return NextResponse.json({ error: errDel.message }, { status: 400 });

  const { data: restantes, error: errRest } = await supabase
    .from("cantera_bochones")
    .select("codigo, correlativo")
    .eq("yacimiento_id", bochon.yacimiento_id)
    .eq("anio", bochon.anio);
  if (errRest) {
    return NextResponse.json({ error: `Se borró, pero no se pudieron reacomodar los códigos: ${errRest.message}` }, { status: 500 });
  }

  const cambios = reacomodarCorrelativos(restantes ?? [], "B", yacimiento.codigo, bochon.anio);
  for (const c of cambios) {
    const { error } = await supabase
      .from("cantera_bochones")
      .update({ codigo: c.a, correlativo: c.correlativo })
      .eq("codigo", c.de);
    if (error) {
      return NextResponse.json(
        { error: `Se borró, pero se cortó el reacomodo en ${c.de} → ${c.a}: ${error.message}. Los códigos quedaron a medias.` },
        { status: 500 }
      );
    }
  }

  const errores: string[] = [];
  const vaciada = await desespejarBochon(codigo);
  if (!vaciada.ok) errores.push(vaciada.error ?? "no se pudo vaciar la fila");

  for (const c of cambios) {
    const movido = await traerBochon(supabase, c.a);
    if (!movido) continue;
    const espejo = await espejarBochonRenombrado(c.de, movido, yacimiento);
    if (!espejo.ok) {
      errores.push(`${c.de} → ${c.a}: ${espejo.error}`);
      await supabase
        .from("cantera_bochones")
        .update({ sheets_pendiente: espejo.error ?? "no se pudo escribir", sheets_pendiente_en: new Date().toISOString() })
        .eq("codigo", c.a);
    }
  }

  return NextResponse.json({
    ok: true,
    renombrados: cambios.map((c) => ({ de: c.de, a: c.a })),
    planilla_error: errores.length ? errores.join(" · ") : null,
  });
}
