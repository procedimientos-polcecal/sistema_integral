import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarDespacho, tieneAccesoDespacho } from "@/lib/despacho/auth";
import {
  traerProveedoresDeRecepcion,
  traerRecepcionesAbiertasAnteriores,
  traerRecepcionesDelDia,
} from "@/lib/despacho/consultas";
import { LUGARES_DE_DESCARGA } from "@/lib/despacho/recepcion";
import { hoyEnArgentina } from "@/lib/core/fechas";

/**
 * Las recepciones de material: el camión que llega a la balanza.
 *
 * Spec: docs/superpowers/specs/2026-09-11-despacho-recepcion-de-carbonilla-design.md
 *
 * El alta es lo primero que pasa —el camión está en la balanza— así que pide lo
 * mínimo: proveedor, empresa y, si se sabe, dónde descarga. Los pesos vienen
 * después, uno por uno, por `PATCH`.
 */

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoDespacho(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Despacho" }, { status: 403 });
  }

  const fecha = new URL(request.url).searchParams.get("fecha") ?? hoyEnArgentina();
  const [delDia, abiertas, proveedores] = await Promise.all([
    traerRecepcionesDelDia(supabase, fecha),
    traerRecepcionesAbiertasAnteriores(supabase, fecha),
    traerProveedoresDeRecepcion(supabase),
  ]);

  return NextResponse.json({ fecha, delDia, abiertas, proveedores });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarDespacho(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para cargar recepciones" }, { status: 403 });
  }

  const b = await cuerpoJson(request);

  const proveedorId = String(b?.proveedor_id ?? "").trim();
  if (!proveedorId) return NextResponse.json({ error: "Falta el proveedor" }, { status: 400 });

  const empresaId = String(b?.empresa_id ?? "").trim();
  if (!empresaId) return NextResponse.json({ error: "Falta la empresa" }, { status: 400 });

  const lugar = textoOpcional(b?.lugar_descarga);
  if (lugar !== null && !LUGARES_DE_DESCARGA.includes(lugar as (typeof LUGARES_DE_DESCARGA)[number])) {
    return NextResponse.json(
      { error: `Lugar de descarga inválido. Son: ${LUGARES_DE_DESCARGA.join(", ")}` },
      { status: 400 }
    );
  }

  /*
   * El producto sale de la configuración del proveedor y **no del cuerpo del
   * pedido**: es lo que decide a qué cuenta entra el material en Odoo, y no
   * puede depender de lo que mande una pantalla. Si el proveedor no está
   * configurado, la recepción se carga igual —el camión ya está— y lo que no va
   * a poder es cerrarse, que es cuando el producto hace falta.
   */
  const { data: config } = await supabase
    .from("despacho_recepcion_proveedores")
    .select("odoo_product_id, odoo_product_nombre, activo")
    .eq("proveedor_id", proveedorId)
    .maybeSingle();

  const fila = {
    fecha: textoOpcional(b?.fecha) ?? hoyEnArgentina(),
    empresa_id: empresaId,
    proveedor_id: proveedorId,
    odoo_product_id: config?.activo ? config.odoo_product_id : null,
    odoo_product_nombre: config?.activo ? config.odoo_product_nombre : null,
    lugar_descarga: lugar,
    notas: textoOpcional(b?.notas),
    peso_bruto_kg: numeroOpcional(b?.peso_bruto_kg),
    cargado_por: user.id,
  };

  const { data, error } = await supabase
    .from("despacho_recepciones")
    .insert(fila)
    .select(
      "id, fecha, empresa_id, proveedor_id, odoo_product_id, odoo_product_nombre, peso_bruto_kg, peso_tara_kg, lugar_descarga, notas, odoo_purchase_order_id, odoo_purchase_name, odoo_picking_id, odoo_error, odoo_error_en, sheets_fila, sheets_pendiente, sheets_pendiente_en, cargado_por, cargado_en, actualizado_por, actualizado_en"
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({
    data,
    ...(config?.activo
      ? {}
      : {
          aviso:
            "Ese proveedor todavía no tiene cargado qué producto de Odoo le corresponde: " +
            "la recepción se puede pesar, pero no se va a poder cerrar hasta que se configure.",
        }),
  });
}

function textoOpcional(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const s = valor.trim();
  return s === "" ? null : s;
}

/** Un peso que llega de la pantalla. Vacío es null; "12.610,5" y "12610.5" entran igual. */
function numeroOpcional(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor !== "string") return null;
  const s = valor.trim();
  if (s === "") return null;
  const normalizado = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}
