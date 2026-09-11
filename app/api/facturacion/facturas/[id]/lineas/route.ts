import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarFacturacion, tieneAccesoFacturacion } from "@/lib/facturacion/auth";
import { describirDistribucion, revisarDistribucion } from "@/lib/facturacion/lineas";
import { normalizarDescripcion } from "@/lib/compras/productoOdoo";
import { hayCredencialesOdoo } from "@/lib/odoo/client";
import { leerCatalogoComprable } from "@/lib/odoo/catalogo";
import { leerCuentasAnaliticas, leerCuentasContables } from "@/lib/odoo/catalogoContable";

/**
 * El detalle de una factura del buzón: verlo, y corregirlo.
 *
 * `GET` devuelve las líneas **y los catálogos con los que se las imputa**, que
 * son de Odoo y dependen de la empresa: las cuentas contables y las analíticas
 * son distintas en Polcecal y en Polysan, y usar la de la otra no da un error
 * prolijo — da un asiento en la contabilidad equivocada.
 *
 * Los catálogos se traen acá y no en la pantalla del buzón porque son ~700
 * filas por empresa y sólo hacen falta cuando alguien abre el detalle de una
 * factura. Cargarlos en cada visita al buzón sería pagar ese viaje siempre.
 */

async function laFactura(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data } = await supabase
    .from("facturas_proveedor")
    .select("id, empresa_id, detalle_leido, empresas!empresa_id(nombre, odoo_company_id)")
    .eq("id", id)
    .maybeSingle();
  return data;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoFacturacion(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Facturación" }, { status: 403 });
  }

  const factura = await laFactura(supabase, id);
  if (!factura) return NextResponse.json({ error: "No existe esa factura" }, { status: 404 });

  const { data: lineas } = await supabase
    .from("facturas_proveedor_lineas")
    .select("*")
    .eq("factura_id", id)
    .order("orden");

  const empresa = (Array.isArray(factura.empresas) ? factura.empresas[0] : factura.empresas) as
    | { nombre: string; odoo_company_id: number | null }
    | null;

  const companyId = empresa?.odoo_company_id ?? null;

  /*
   * Sin Odoo configurado, o sin empresa definida, las líneas se ven igual: lo
   * que falta son los selectores. Es mejor poder leer el detalle que recibir un
   * error por algo que no impide leerlo.
   */
  if (!companyId || !hayCredencialesOdoo()) {
    return NextResponse.json({
      lineas: lineas ?? [],
      detalleLeido: factura.detalle_leido,
      catalogos: null,
      motivo: !companyId
        ? "La factura no tiene empresa definida, así que no se sabe de cuál traer las cuentas."
        : "Odoo no está configurado.",
    });
  }

  try {
    const [productos, cuentas, analiticas] = await Promise.all([
      leerCatalogoComprable(),
      leerCuentasContables(companyId),
      leerCuentasAnaliticas(companyId),
    ]);

    return NextResponse.json({
      lineas: lineas ?? [],
      detalleLeido: factura.detalle_leido,
      empresa: empresa?.nombre ?? null,
      catalogos: { productos, cuentas, analiticas },
      motivo: null,
    });
  } catch (e) {
    return NextResponse.json({
      lineas: lineas ?? [],
      detalleLeido: factura.detalle_leido,
      catalogos: null,
      motivo: `No se pudieron traer los catálogos de Odoo: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

/**
 * Corregir una línea: el producto, la cuenta, la distribución analítica.
 *
 * Lo que dice el comprobante —descripción, cantidad, precio, total— **no se
 * toca**: es el papel, y si está mal leído la factura se vuelve a cargar. Lo que
 * se corrige es la interpretación, que es justamente lo que el sistema propuso.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarFacturacion(supabase, user.id))) {
    return NextResponse.json(
      { error: "Corregir el detalle requiere nivel de edición en Facturación" },
      { status: 403 }
    );
  }

  const b = await cuerpoJson(request);
  const lineaId = String(b.linea_id ?? "");
  if (!lineaId) return NextResponse.json({ error: "Falta decir qué línea" }, { status: 400 });

  const { data: linea } = await supabase
    .from("facturas_proveedor_lineas")
    .select("id, factura_id, descripcion, odoo_product_id")
    .eq("id", lineaId)
    .eq("factura_id", id)
    .maybeSingle();

  if (!linea) return NextResponse.json({ error: "Esa línea no es de esta factura" }, { status: 404 });

  const cambios: Record<string, unknown> = {};

  if ("odoo_product_id" in b) {
    const productoId = b.odoo_product_id === null ? null : Number(b.odoo_product_id);
    cambios.odoo_product_id = productoId;
    cambios.odoo_product_nombre = productoId ? String(b.odoo_product_nombre ?? "") || null : null;
    // Que lo haya elegido una persona es un dato, no un detalle de auditoría:
    // es lo que distingue una imputación revisada de una que nadie miró.
    cambios.producto_origen = productoId ? "a mano" : null;
  }

  if ("odoo_account_id" in b) {
    const cuentaId = b.odoo_account_id === null ? null : Number(b.odoo_account_id);
    cambios.odoo_account_id = cuentaId;
    cambios.odoo_account_nombre = cuentaId ? String(b.odoo_account_nombre ?? "") || null : null;
  }

  if ("analitica" in b) {
    const analitica = (b.analitica ?? null) as Record<string, number> | null;
    const problema = revisarDistribucion(analitica);
    if (problema) return NextResponse.json({ error: problema }, { status: 400 });

    cambios.analitica = analitica && Object.keys(analitica).length ? analitica : null;
    cambios.analitica_detalle = describirDistribucion(
      analitica,
      new Map(
        Object.entries((b.analitica_nombres ?? {}) as Record<string, string>).map(([k, v]) => [
          Number(k),
          v,
        ])
      )
    );
  }

  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: "No vino nada para cambiar" }, { status: 400 });
  }

  const { data: guardada, error } = await supabase
    .from("facturas_proveedor_lineas")
    .update(cambios)
    .eq("id", lineaId)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  /*
   * Cuando una persona corrige el producto, el sistema lo aprende — la misma
   * tabla que usan las órdenes de compra, así que lo que se enseña acá también
   * mejora las órdenes. Sólo con elección humana: aprender de la propia
   * sugerencia sería confirmarse a sí mismo.
   */
  if (cambios.producto_origen === "a mano" && cambios.odoo_product_id) {
    await createAdminClient()
      .from("compras_producto_odoo")
      .upsert(
        {
          descripcion_normalizada: normalizarDescripcion(linea.descripcion as string),
          odoo_product_id: cambios.odoo_product_id as number,
          odoo_product_nombre: (cambios.odoo_product_nombre as string) ?? "",
          created_by: user.id,
        },
        { onConflict: "descripcion_normalizada" }
      );
  }

  return NextResponse.json({ linea: guardada });
}
