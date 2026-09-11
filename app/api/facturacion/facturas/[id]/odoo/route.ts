import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarFacturacion, tieneAccesoFacturacion } from "@/lib/facturacion/auth";
import {
  avisoDeCredencialesFaltantes,
  dondeApuntaOdoo,
  enlaceAOdoo,
  hayCredencialesOdoo,
} from "@/lib/odoo/client";
import { empujarFacturaAOdoo } from "@/lib/odoo/pushFactura";
import { candidatosEnOdoo } from "@/lib/odoo/sincronizarFacturas";

/**
 * La factura del buzón, del lado de Odoo.
 *
 * - `GET` trae los candidatos para vincularla a mano.
 * - `POST` crea el borrador en Odoo.
 * - `PATCH` vincula (o desvincula) un asiento elegido por una persona.
 *
 * Ninguna de las tres postea nada: el borrador lo confirma alguien en Odoo. Y
 * las tres exigen nivel de edición, porque escriben en la contabilidad del
 * grupo aunque sea en borrador.
 */

function sinCredenciales() {
  return NextResponse.json({ error: avisoDeCredencialesFaltantes() }, { status: 503 });
}

async function elQuePuedeEditar() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };

  if (!(await puedeEditarFacturacion(supabase, user.id))) {
    return {
      error: NextResponse.json(
        { error: "Escribir en Odoo requiere nivel de edición en Facturación" },
        { status: 403 }
      ),
    };
  }
  return { supabase, user };
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
  if (!hayCredencialesOdoo()) return sinCredenciales();

  try {
    const { candidatos, motivo } = await candidatosEnOdoo(createAdminClient(), id);
    return NextResponse.json({
      odoo: dondeApuntaOdoo(),
      motivo: motivo ?? null,
      candidatos: candidatos.map((c) => ({ ...c, enlace: enlaceAOdoo("account.move", c.odooMoveId) })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const quien = await elQuePuedeEditar();
  if (quien.error) return quien.error;
  if (!hayCredencialesOdoo()) return sinCredenciales();

  const resultado = await empujarFacturaAOdoo(createAdminClient(), id);

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.motivos.join(" "), motivos: resultado.motivos }, { status: 409 });
  }

  return NextResponse.json({
    ...resultado.factura,
    odoo: dondeApuntaOdoo(),
    enlace: enlaceAOdoo("account.move", resultado.factura.odooMoveId),
  });
}

/**
 * Vincular a mano el asiento que eligió una persona, o soltar el vínculo.
 *
 * Queda marcado como `a mano` y no como `numero`: lo que dedujo el sistema y lo
 * que decidió alguien son dos cosas distintas, y dentro de seis meses la
 * diferencia importa.
 *
 * El estado del buzón **no** se toca acá. Vincular dice "es ésta"; si ya está
 * posteada, lo va a decir la sincronización cuando la lea.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const quien = await elQuePuedeEditar();
  if (quien.error) return quien.error;

  const b = await cuerpoJson(request);
  const admin = createAdminClient();

  if (b.odoo_move_id === null) {
    const { error } = await admin
      .from("facturas_proveedor")
      .update({
        odoo_move_id: null,
        odoo_nombre: null,
        odoo_estado: null,
        odoo_conciliado_por: null,
        odoo_pendiente: null,
      })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ odooMoveId: null });
  }

  const odooMoveId = Number(b.odoo_move_id);
  if (!Number.isInteger(odooMoveId) || odooMoveId <= 0) {
    return NextResponse.json(
      { error: `"${b.odoo_move_id}" no es un asiento de Odoo` },
      { status: 400 }
    );
  }

  const { error } = await admin
    .from("facturas_proveedor")
    .update({
      odoo_move_id: odooMoveId,
      odoo_nombre: typeof b.odoo_nombre === "string" ? b.odoo_nombre : null,
      odoo_estado: typeof b.odoo_estado === "string" ? b.odoo_estado : null,
      odoo_conciliado_por: "a mano",
      odoo_pendiente: null,
      odoo_sincronizado_en: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ odooMoveId, enlace: enlaceAOdoo("account.move", odooMoveId) });
}
