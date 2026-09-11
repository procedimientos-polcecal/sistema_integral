import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarDespacho } from "@/lib/despacho/auth";
import { LUGARES_DE_DESCARGA, netoDeLaRecepcion } from "@/lib/despacho/recepcion";
import { empujarRecepcion } from "@/lib/despacho/pushRecepcion";
import { espejarRecepcion } from "@/lib/despacho/espejoRecepcion";
import type { Recepcion } from "@/lib/despacho/types";

const COLUMNAS =
  "id, fecha, empresa_id, proveedor_id, odoo_product_id, odoo_product_nombre, peso_bruto_kg, peso_tara_kg, lugar_descarga, notas, odoo_purchase_order_id, odoo_purchase_name, odoo_picking_id, odoo_error, odoo_error_en, sheets_fila, sheets_pendiente, sheets_pendiente_en, cargado_por, cargado_en, actualizado_por, actualizado_en";

/**
 * Los pasos de una recepción: el bruto, la tara, y cerrar.
 *
 * Cerrar es lo que dispara los tres pasos en Odoo y la escritura en la planilla.
 * Va acá y no en el alta porque el neto recién existe cuando el camión se pesó
 * vacío.
 *
 * **Cerrar usa el cliente admin**, y no es por comodidad: para crear la orden
 * hay que leer `proveedores_odoo`, que desde la 20260910084718 sólo lee un
 * `admin_sistema`. Quien está en la balanza tiene `edicion` en Despacho, así que
 * con su propio cliente el vínculo con Odoo le vendría vacío y la orden fallaría
 * por un motivo que no tiene nada que ver con lo que hizo.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarDespacho(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para editar recepciones" }, { status: 403 });
  }

  const b = await cuerpoJson(request);

  const { data: actual } = await supabase
    .from("despacho_recepciones")
    .select(COLUMNAS)
    .eq("id", id)
    .maybeSingle();

  if (!actual) return NextResponse.json({ error: "Esa recepción no existe" }, { status: 404 });
  const recepcion = actual as unknown as Recepcion;

  // ── Cerrar ─────────────────────────────────────────────────
  if (b?.accion === "cerrar") {
    if (recepcion.odoo_purchase_order_id && recepcion.sheets_fila) {
      return NextResponse.json(
        { error: `Esa recepción ya está cerrada (${recepcion.odoo_purchase_name}).` },
        { status: 409 }
      );
    }
    return await cerrar(id, recepcion, user.id);
  }

  // ── Un paso, o una corrección ──────────────────────────────
  const cambios: Record<string, unknown> = {
    actualizado_por: user.id,
    actualizado_en: new Date().toISOString(),
  };

  if (b?.peso_bruto_kg !== undefined) cambios.peso_bruto_kg = numeroOpcional(b.peso_bruto_kg);
  if (b?.peso_tara_kg !== undefined) cambios.peso_tara_kg = numeroOpcional(b.peso_tara_kg);
  if (b?.notas !== undefined) cambios.notas = textoOpcional(b.notas);
  if (b?.lugar_descarga !== undefined) {
    const lugar = textoOpcional(b.lugar_descarga);
    if (lugar !== null && !LUGARES_DE_DESCARGA.includes(lugar as (typeof LUGARES_DE_DESCARGA)[number])) {
      return NextResponse.json(
        { error: `Lugar de descarga inválido. Son: ${LUGARES_DE_DESCARGA.join(", ")}` },
        { status: 400 }
      );
    }
    cambios.lugar_descarga = lugar;
  }

  if (Object.keys(cambios).length === 2) {
    return NextResponse.json({ error: "No vino ningún cambio" }, { status: 400 });
  }

  /*
   * El neto se comprueba sobre **lo que va a quedar**: si la tara que llega es
   * mayor que el bruto que ya estaba, el problema es de la recepción entera y no
   * del campo. Se avisa y no se guarda, porque de acá sale la cantidad de una
   * orden de compra que se confirma sola.
   */
  const despues = { ...recepcion, ...cambios } as Recepcion;
  const neto = netoDeLaRecepcion(despues);
  if (neto.problema) return NextResponse.json({ error: neto.problema }, { status: 400 });

  const { data, error } = await supabase
    .from("despacho_recepciones")
    .update(cambios)
    .eq("id", id)
    .select(COLUMNAS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ data, ...(neto.aviso ? { aviso: neto.aviso } : {}) });
}

async function cerrar(id: string, recepcion: Recepcion, usuarioId: string) {
  const admin = createAdminClient();

  const neto = netoDeLaRecepcion(recepcion);
  if (neto.problema) return NextResponse.json({ error: neto.problema }, { status: 400 });
  if (neto.toneladas === null) {
    return NextResponse.json(
      { error: "Faltan el bruto o la tara: sin neto no hay orden." },
      { status: 400 }
    );
  }

  const avisos: string[] = [];
  if (neto.aviso) avisos.push(neto.aviso);

  // ── 1. Odoo ────────────────────────────────────────────────
  const push = await empujarRecepcion(admin, id);
  if (!push.ok) return NextResponse.json({ error: push.motivo }, { status: 400 });
  if (push.aviso) avisos.push(push.aviso);

  // ── 2. La planilla ─────────────────────────────────────────
  const { data: proveedor } = await admin
    .from("despacho_recepcion_proveedores")
    .select("nombre_planilla")
    .eq("proveedor_id", recepcion.proveedor_id)
    .maybeSingle();

  const { data: base } = await admin
    .from("proveedores")
    .select("nombre")
    .eq("id", recepcion.proveedor_id)
    .maybeSingle();

  /*
   * El nombre para la planilla sale de la configuración; si no está, el del
   * catálogo. **No se inventa una forma corta**: hoy el libro tiene 51 textos
   * para diez proveedores justamente porque cada uno escribió el que le pareció.
   */
  const nombre =
    (proveedor as { nombre_planilla: string } | null)?.nombre_planilla ??
    (base as { nombre: string } | null)?.nombre ??
    "";

  const { data: recargada } = await admin
    .from("despacho_recepciones")
    .select(COLUMNAS)
    .eq("id", id)
    .single();

  const espejo = await espejarRecepcion(recargada as unknown as Recepcion, nombre);

  await admin
    .from("despacho_recepciones")
    .update({
      ...(espejo.ok
        ? { sheets_fila: espejo.fila, sheets_pendiente: null, sheets_pendiente_en: null }
        : { sheets_pendiente: espejo.error, sheets_pendiente_en: new Date().toISOString() }),
      actualizado_por: usuarioId,
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", id);

  if (!espejo.ok && espejo.error) avisos.push(espejo.error);

  const { data } = await admin.from("despacho_recepciones").select(COLUMNAS).eq("id", id).single();

  return NextResponse.json({
    data,
    orden: push.odooNombre,
    recepcionValidada: push.recepcionValidada,
    ...(avisos.length ? { avisos } : {}),
  });
}

function textoOpcional(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const s = valor.trim();
  return s === "" ? null : s;
}

function numeroOpcional(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor !== "string") return null;
  const s = valor.trim();
  if (s === "") return null;
  const normalizado = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}
