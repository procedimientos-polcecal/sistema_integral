import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeFacturarCantera } from "@/lib/cantera/auth";
import { traerBochon } from "@/lib/cantera/consultas";
import { contratistasDeCantera, todosLosPartnerIds } from "@/lib/cantera/contratistas";
import { facturasDisponibles, facturaEsDeAlgunContratista } from "@/lib/cantera/odoo";
import { hayCredencialesOdoo, avisoDeCredencialesFaltantes } from "@/lib/odoo/client";

/**
 * La conciliación de un bochón contra Odoo — un solo campo `odoo_*`, a
 * diferencia de la voladura que tiene uno por etapa (acá no hay etapas).
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const { codigo } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeFacturarCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sólo finanzas concilia facturas" }, { status: 403 });
  }
  if (!hayCredencialesOdoo()) {
    return NextResponse.json({ error: avisoDeCredencialesFaltantes() }, { status: 503 });
  }

  const bochon = await traerBochon(supabase, codigo);
  if (!bochon) return NextResponse.json({ error: "Ese bochón no existe" }, { status: 404 });

  const contratistas = await contratistasDeCantera(supabase);
  const partnerIds = todosLosPartnerIds(contratistas);
  const excluir = bochon.odoo_move_id !== null ? [bochon.odoo_move_id] : [];

  try {
    const candidatas = await facturasDisponibles(partnerIds, excluir);
    return NextResponse.json({ candidatas, sinEnlace: contratistas.sinEnlace });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error consultando Odoo" }, { status: 502 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const { codigo } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeFacturarCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sólo finanzas concilia facturas" }, { status: 403 });
  }

  const bochon = await traerBochon(supabase, codigo);
  if (!bochon) return NextResponse.json({ error: "Ese bochón no existe" }, { status: 404 });

  const b = await cuerpoJson(request);
  const cambios: Record<string, unknown> = {
    conforme_por: user.id,
    conforme_en: new Date().toISOString(),
  };

  if ("odoo_move_id" in b) {
    if (b.odoo_move_id === null) {
      cambios.odoo_move_id = null;
      cambios.odoo_move_name = null;
      cambios.odoo_empresa = null;
      cambios.odoo_importe = null;
      cambios.odoo_leido_en = null;
    } else {
      const contratistas = await contratistasDeCantera(supabase);
      const factura = await facturaEsDeAlgunContratista(Number(b.odoo_move_id), todosLosPartnerIds(contratistas));
      if (!factura) {
        return NextResponse.json(
          { error: "Esa factura no existe en Odoo o no es de un contratista de cantera" },
          { status: 400 }
        );
      }
      cambios.odoo_move_id = factura.id;
      cambios.odoo_move_name = factura.name;
      cambios.odoo_empresa = factura.empresa;
      cambios.odoo_importe = factura.importeNeto;
      cambios.odoo_leido_en = new Date().toISOString();
    }
  }

  if (typeof b?.ref === "string") cambios.odoo_ref = b.ref.trim() || null;
  if (typeof b?.conforme === "boolean" || b?.conforme === null) cambios.conforme = b.conforme;
  if (typeof b?.conforme_obs === "string") cambios.conforme_obs = b.conforme_obs.trim() || null;

  const { data, error } = await supabase
    .from("cantera_bochones")
    .update(cambios)
    .eq("codigo", codigo)
    .select("odoo_move_id, odoo_move_name, odoo_empresa, odoo_ref, odoo_importe, conforme, conforme_obs")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
