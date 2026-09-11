import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeConfirmarEnOdoo, tieneAccesoFacturacion } from "@/lib/facturacion/auth";
import {
  avisoDeCredencialesFaltantes,
  dondeApuntaOdoo,
  hayCredencialesOdoo,
} from "@/lib/odoo/client";
import { confirmarElBorrador, traerElBorrador } from "@/lib/odoo/borradorDeOdoo";

/**
 * El borrador de Odoo, visto y confirmado desde el SdG.
 *
 * `GET` lo muestra: líneas, cuentas, analítica, impuestos y adjuntos, como están
 * en Odoo **ahora** —no como el SdG los mandó—, que es la diferencia entre
 * revisar y suponer.
 *
 * `POST` lo postea, y es lo único del módulo reservado a **administradores**:
 * un asiento posteado es inmutable. Además pide `confirmar: true` en el cuerpo a
 * propósito, para que esta llamada no pueda salir de un clic accidental ni de un
 * reintento automático.
 */

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
  if (!hayCredencialesOdoo()) {
    return NextResponse.json({ error: avisoDeCredencialesFaltantes() }, { status: 503 });
  }

  const { data: factura } = await supabase
    .from("facturas_proveedor")
    .select("odoo_move_id, importe_total")
    .eq("id", id)
    .maybeSingle();

  if (!factura) return NextResponse.json({ error: "No existe esa factura" }, { status: 404 });
  if (!factura.odoo_move_id) {
    return NextResponse.json(
      { error: "Esta factura todavía no tiene un borrador en Odoo." },
      { status: 404 }
    );
  }

  try {
    const borrador = await traerElBorrador(factura.odoo_move_id as number);
    return NextResponse.json({
      borrador,
      odoo: dondeApuntaOdoo(),
      /*
       * La diferencia se calcula acá y no en la pantalla porque es el mismo
       * número que decide si el posteo se permite: que los dos lados la saquen
       * de lugares distintos sería pedir que se desincronicen.
       */
      diferencia:
        Math.round((borrador.total - Math.abs(Number(factura.importe_total ?? 0))) * 100) / 100,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  /*
   * Acá `admin` y no `edicion`, a diferencia de todo el resto del módulo: es la
   * única acción que no se deshace. Ver `puedeConfirmarEnOdoo`.
   */
  if (!(await puedeConfirmarEnOdoo(supabase, user.id))) {
    return NextResponse.json(
      {
        error:
          "Confirmar postea el asiento en Odoo y eso no se deshace: requiere nivel de administrador en Facturación.",
      },
      { status: 403 }
    );
  }
  if (!hayCredencialesOdoo()) {
    return NextResponse.json({ error: avisoDeCredencialesFaltantes() }, { status: 503 });
  }

  const b = await cuerpoJson(request);
  if (b.confirmar !== true) {
    return NextResponse.json(
      {
        error:
          "Confirmar postea el asiento en Odoo y eso no se deshace: hay que decirlo explícitamente.",
      },
      { status: 400 }
    );
  }

  const resultado = await confirmarElBorrador(createAdminClient(), id);

  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.motivos.join(" "), motivos: resultado.motivos },
      { status: 409 }
    );
  }

  return NextResponse.json(resultado);
}
