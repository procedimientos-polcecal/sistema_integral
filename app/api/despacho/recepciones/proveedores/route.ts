import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { esAdminDespacho } from "@/lib/despacho/auth";

/**
 * Qué producto de Odoo y qué nombre de planilla le corresponde a cada proveedor
 * que trae material.
 *
 * Lo edita un admin del módulo y no quien está en la balanza: **el producto
 * decide a qué cuenta entra el material** en la contabilidad del grupo, y el
 * nombre de planilla es lo que evita que el libro vuelva a tener 51 formas de
 * escribir diez proveedores.
 *
 * `PUT` y no `POST`/`PATCH` porque la clave es el proveedor: se carga o se
 * corrige lo de uno, y es la misma operación.
 */
export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminDespacho(supabase, user.id))) {
    return NextResponse.json(
      { error: "Sólo un admin de Despacho configura los proveedores de recepción" },
      { status: 403 }
    );
  }

  const b = await cuerpoJson(request);
  const proveedorId = String(b?.proveedor_id ?? "").trim();
  if (!proveedorId) return NextResponse.json({ error: "Falta el proveedor" }, { status: 400 });

  if (typeof b?.odoo_product_id !== "number") {
    return NextResponse.json({ error: "Falta el producto de Odoo" }, { status: 400 });
  }
  const nombreProducto = String(b?.odoo_product_nombre ?? "").trim();
  if (!nombreProducto) {
    return NextResponse.json({ error: "Falta el nombre del producto" }, { status: 400 });
  }
  const nombrePlanilla = String(b?.nombre_planilla ?? "").trim();
  if (!nombrePlanilla) {
    return NextResponse.json(
      { error: "Falta cómo se escribe este proveedor en la planilla" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("despacho_recepcion_proveedores")
    .upsert(
      {
        proveedor_id: proveedorId,
        odoo_product_id: b.odoo_product_id,
        odoo_product_nombre: nombreProducto,
        nombre_planilla: nombrePlanilla,
        ...(typeof b.activo === "boolean" ? { activo: b.activo } : {}),
        actualizado_por: user.id,
        actualizado_en: new Date().toISOString(),
        cargado_por: user.id,
      },
      { onConflict: "proveedor_id" }
    )
    .select("proveedor_id, odoo_product_id, odoo_product_nombre, nombre_planilla, activo")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
