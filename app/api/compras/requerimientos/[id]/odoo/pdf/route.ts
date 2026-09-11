import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tieneAccesoCompras } from "@/lib/compras/auth";
import { avisoDeCredencialesFaltantes, hayCredencialesOdoo } from "@/lib/odoo/client";
import { pdfDeLaOrden } from "@/lib/odoo/pdfDeOrden";
import { cabeceraDeDescarga } from "@/lib/core/descarga";

/**
 * El PDF oficial de una orden de compra de este requerimiento.
 *
 * `GET …/odoo/pdf?orden=<id de Odoo>` devuelve el mismo archivo que sale de
 * *Imprimir → Orden de compra* en Odoo. Cómo se consigue —y por qué el camino
 * obvio no sirve— está en `lib/odoo/pdfDeOrden.ts`.
 *
 * **La orden se valida contra el vínculo del requerimiento.** No alcanza con
 * tener acceso a Compras: el id que llega por la URL tiene que ser una de las
 * órdenes de *este* RI. Sin eso, cualquiera con acceso podría bajar el PDF de
 * cualquier orden de compra del grupo cambiando un número en la barra de
 * direcciones, incluidas las que no salieron del SdG.
 *
 * Leer basta: bajar el papel de una orden que ya existe no cambia nada de este
 * lado ni del otro.
 */

/**
 * Odoo renderiza el PDF con wkhtmltopdf en el momento, y Odoo Online no es
 * rápido. Los 10s por defecto de Vercel no alcanzan.
 */
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await tieneAccesoCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenés acceso a Compras" }, { status: 403 });
  }

  if (!hayCredencialesOdoo()) {
    return NextResponse.json({ error: avisoDeCredencialesFaltantes() }, { status: 503 });
  }

  const { id } = await params;
  const pedida = Number(new URL(request.url).searchParams.get("orden"));

  if (!Number.isInteger(pedida) || pedida <= 0) {
    return NextResponse.json(
      { error: "Falta decir de qué orden es el PDF (?orden=…)." },
      { status: 400 }
    );
  }

  // El vínculo es la autorización: sólo las órdenes de este requerimiento.
  const admin = createAdminClient();
  const { data: vinculo } = await admin
    .from("compras_odoo_ordenes")
    .select("odoo_order_id")
    .eq("requerimiento_id", id)
    .eq("odoo_order_id", pedida)
    .maybeSingle();

  if (!vinculo) {
    return NextResponse.json(
      { error: "Esa orden no es de este requerimiento." },
      { status: 404 }
    );
  }

  try {
    const { nombre, contenido } = await pdfDeLaOrden(pedida);

    return new NextResponse(new Uint8Array(contenido), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": cabeceraDeDescarga(nombre),
        // Se pide de nuevo cada vez: la orden puede cambiar en Odoo y el papel
        // viejo no sirve para nada.
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    /*
     * El error va como JSON con lo que dijo Odoo sin traducir, igual que el
     * resto de la integración. Quien aprieta el botón ve un texto que dice qué
     * pasó, no un visor de PDF vacío.
     */
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
