import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { esAdminCalidad, tieneAccesoCalidad } from "@/lib/calidad/auth";
import { traerBandeja, traerProductosDeOdoo } from "@/lib/calidad/consultas";

/**
 * La lista blanca: qué producto de Odoo cuenta como carbonilla.
 *
 * SE ELIGE POR ID Y NUNCA POR NOMBRE. En esta base conviven `CARBONILLA` (6909)
 * y `CARBONILLA ` (4419) —con un espacio al final—, los dos buenos, con 947
 * líneas entre ambos. En un desplegable se ven idénticos, así que **el id va al
 * lado del nombre en todas las filas**.
 *
 * `cuenta = false` no es lo mismo que no estar: es "ya lo miré, es flete, no me
 * lo muestres más en la bandeja".
 */
export async function GET() {
  const supabase = await createClient();
  const user = await usuarioActual();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoCalidad(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Calidad" }, { status: 403 });
  }

  const [productos, bandeja] = await Promise.all([
    traerProductosDeOdoo(supabase),
    traerBandeja(supabase),
  ]);

  const resueltos = new Set(productos.map((p) => p.odoo_product_id));
  const sinResolver = [
    ...new Map(
      bandeja
        .filter((l) => !resueltos.has(l.odoo_product_id))
        .map((l) => [
          l.odoo_product_id,
          { odoo_product_id: l.odoo_product_id, odoo_product_nombre: l.odoo_product_nombre },
        ])
    ).values(),
  ];

  return NextResponse.json({ productos, sinResolver });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await usuarioActual();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminCalidad(supabase, user.id))) {
    return NextResponse.json({ error: "Sólo un admin de Calidad edita la lista" }, { status: 403 });
  }

  const p = await cuerpoJson<{
    odoo_product_id: number;
    odoo_product_nombre: string;
    cuenta: boolean;
  }>(request);

  if (!Number.isInteger(Number(p.odoo_product_id))) {
    return NextResponse.json({ error: "Falta el id del producto de Odoo." }, { status: 400 });
  }
  if (typeof p.cuenta !== "boolean") {
    return NextResponse.json({ error: "Hay que decir si cuenta o no." }, { status: 400 });
  }

  const { error } = await supabase.from("calidad_productos_odoo").upsert(
    {
      odoo_product_id: Number(p.odoo_product_id),
      // El nombre se cachea tal cual viene, con el espacio al final incluido.
      odoo_product_nombre: p.odoo_product_nombre ?? "",
      cuenta: p.cuenta,
      cargado_por: user.id,
    },
    { onConflict: "odoo_product_id" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Resuelto el producto, las líneas que esperaban por él dejan de esperar: si
  // cuenta, la próxima corrida las trae; si no, no vuelven a aparecer.
  await supabase
    .from("calidad_odoo_sin_reconocer")
    .delete()
    .eq("odoo_product_id", Number(p.odoo_product_id));

  return NextResponse.json({ ok: true });
}
