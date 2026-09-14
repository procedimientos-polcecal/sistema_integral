import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeFacturarCantera } from "@/lib/cantera/auth";
import { traerConsumos, traerInsumos, traerVoladura, traerYacimientos } from "@/lib/cantera/consultas";
import { contratistasDeCantera, todosLosPartnerIds } from "@/lib/cantera/contratistas";
import { facturasDisponibles, facturaEsDeAlgunContratista } from "@/lib/cantera/odoo";
import { hayCredencialesOdoo, avisoDeCredencialesFaltantes } from "@/lib/odoo/client";
import { espejarVoladura } from "@/lib/cantera/espejo";
import type { RenglonPlano } from "@/lib/cantera/planilla";

/**
 * La conciliación de una voladura contra Odoo: vincular la factura de
 * perforación y/o la de voladura, y marcar si el importe conforma.
 *
 * Sólo finanzas —estar en `cantera_finanzas`—, nunca quien sólo edita el
 * módulo: cargar metros y conciliar una factura las hacen personas distintas
 * (spec del módulo). No se crea ni se postea nada en Odoo: se lee y se
 * compara.
 */

function idsYaUsados(v: Awaited<ReturnType<typeof traerVoladura>>): number[] {
  if (!v) return [];
  return [v.perf_odoo_move_id, v.vol_odoo_move_id].filter((id): id is number => id !== null);
}

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

  const voladura = await traerVoladura(supabase, codigo);
  if (!voladura) return NextResponse.json({ error: "Esa voladura no existe" }, { status: 404 });

  const contratistas = await contratistasDeCantera(supabase);
  const partnerIds = todosLosPartnerIds(contratistas);

  try {
    const candidatas = await facturasDisponibles(partnerIds, idsYaUsados(voladura));
    return NextResponse.json({ candidatas, sinEnlace: contratistas.sinEnlace });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error consultando Odoo" }, { status: 502 });
  }
}

const ETAPAS = ["perf", "vol"] as const;
type Etapa = (typeof ETAPAS)[number];

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

  const voladura = await traerVoladura(supabase, codigo);
  if (!voladura) return NextResponse.json({ error: "Esa voladura no existe" }, { status: 404 });

  const b = await cuerpoJson(request);
  const etapa = b?.etapa as Etapa;
  if (!ETAPAS.includes(etapa)) {
    return NextResponse.json({ error: "Falta indicar la etapa (perf/vol)" }, { status: 400 });
  }

  const cambios: Record<string, unknown> = {
    [`${etapa}_conforme_por`]: user.id,
    [`${etapa}_conforme_en`]: new Date().toISOString(),
  };

  if ("odoo_move_id" in b) {
    if (b.odoo_move_id === null) {
      cambios[`${etapa}_odoo_move_id`] = null;
      cambios[`${etapa}_odoo_move_name`] = null;
      cambios[`${etapa}_odoo_empresa`] = null;
      cambios[`${etapa}_odoo_importe`] = null;
      cambios[`${etapa}_odoo_leido_en`] = null;
    } else {
      const contratistas = await contratistasDeCantera(supabase);
      const factura = await facturaEsDeAlgunContratista(Number(b.odoo_move_id), todosLosPartnerIds(contratistas));
      if (!factura) {
        return NextResponse.json(
          { error: "Esa factura no existe en Odoo o no es de un contratista de cantera" },
          { status: 400 }
        );
      }
      cambios[`${etapa}_odoo_move_id`] = factura.id;
      cambios[`${etapa}_odoo_move_name`] = factura.name;
      // El número real ("FC A 0002-00002979") es `factura.numero`
      // (`display_name` de Odoo, lo que se ve en la columna "Número" de la
      // lista de facturas) y no `ref` —`ref` es el campo "Referencia" de
      // Odoo y casi nunca está cargado—. Se guarda acá para no repetir la
      // llamada a Odoo cada vez que se abre la pantalla.
      cambios[`${etapa}_odoo_ref`] = factura.numero;
      cambios[`${etapa}_odoo_empresa`] = factura.empresa;
      cambios[`${etapa}_odoo_importe`] = factura.importeNeto;
      cambios[`${etapa}_odoo_leido_en`] = new Date().toISOString();
    }
  }

  if (typeof b?.ref === "string") cambios[`${etapa}_odoo_ref`] = b.ref.trim() || null;
  if (typeof b?.conforme === "boolean" || b?.conforme === null) cambios[`${etapa}_conforme`] = b.conforme;
  if (typeof b?.conforme_obs === "string") cambios[`${etapa}_conforme_obs`] = b.conforme_obs.trim() || null;

  const { error } = await supabase.from("cantera_voladuras").update(cambios).eq("codigo", codigo);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // La columna "Facturación"/"N° factura" y "Coincide" de la planilla dependen
  // de esto: se espeja también acá, no sólo al editar metros y pozos.
  const [actualizada, consumos, yacimientos, insumos] = await Promise.all([
    traerVoladura(supabase, codigo),
    traerConsumos(supabase, codigo),
    traerYacimientos(supabase),
    traerInsumos(supabase),
  ]);
  if (!actualizada) return NextResponse.json({ error: "Esa voladura no existe" }, { status: 404 });

  const yacimiento = yacimientos.find((y) => y.id === actualizada.yacimiento_id) ?? null;
  const nombreInsumoPorId = new Map(insumos.map((i) => [i.id, i.nombre]));
  const renglones: RenglonPlano[] = consumos.map((c) => ({
    insumo: c.insumo_raw ?? (c.insumo_id ? (nombreInsumoPorId.get(c.insumo_id) ?? null) : null),
    cantidad: c.cantidad,
    precio_usd: c.precio_usd,
    tipo: c.tipo,
  }));

  const espejo = await espejarVoladura(actualizada, yacimiento, renglones);
  await supabase
    .from("cantera_voladuras")
    .update(
      espejo.ok
        ? { sheets_pendiente: null, sheets_pendiente_en: null }
        : { sheets_pendiente: espejo.error ?? "no se pudo escribir", sheets_pendiente_en: new Date().toISOString() }
    )
    .eq("codigo", codigo);
  const conPlanilla = await traerVoladura(supabase, codigo);

  return NextResponse.json({ data: conPlanilla ?? actualizada, planilla_error: espejo.ok ? null : espejo.error });
}
