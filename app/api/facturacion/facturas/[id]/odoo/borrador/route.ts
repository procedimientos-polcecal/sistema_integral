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
import { actualizarElBorradorEnOdoo } from "@/lib/odoo/pushFactura";
import { puedeEditarFacturacion } from "@/lib/facturacion/auth";
import { auditar, nombreParaAuditoria } from "@/lib/core/auditoria";

/**
 * El borrador de Odoo, visto y confirmado desde el SdG.
 *
 * `GET` lo muestra: líneas, cuentas, analítica, impuestos y adjuntos, como están
 * en Odoo **ahora** —no como el SdG los mandó—, que es la diferencia entre
 * revisar y suponer.
 *
 * `PUT` lo **reescribe** con lo que dice el SdG ahora. Es la acción que faltaba:
 * sin ella, lo que se imputaba después de crear el borrador no llegaba nunca al
 * asiento. Pide nivel de edición, como imputar — sólo toca un borrador.
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

  /*
   * El asiento quedó posteado y **eso no se deshace**. Hasta el 05/10/2026 acá
   * terminaba la ruta y el id de quien lo confirmó no se guardaba en ningún
   * lado: la comprobación de permiso de arriba sabía quién era y después se
   * perdía. Ver `lib/core/auditoria.ts`.
   *
   * Va DESPUÉS de postear y no antes, a propósito. Antes registraría una
   * intención y no un hecho —si Odoo rechaza, quedaría un asiento posteado en
   * la auditoría que no existe—. El precio es que un fallo de la auditoría no
   * puede deshacer nada, así que no se intenta: se informa.
   */
  const { data: quien } = await supabase
    .from("usuarios")
    .select("nombre, apellido, email")
    .eq("id", user.id)
    .maybeSingle();

  const registro = await auditar(supabase, {
    modulo: "facturacion",
    entidad: "facturas_proveedor",
    entidadId: id,
    accion: "postear",
    usuario: { id: user.id, nombre: nombreParaAuditoria(quien) },
    valorNuevo: resultado.nombre,
    contexto: { asiento: resultado.nombre, total: resultado.total },
  });

  // No se traga: quien posteó tiene que saber que el asiento salió pero que no
  // quedó registrado quién fue. Mismo criterio que los fallos de escritura a la
  // planilla — un fallo que no se distingue de un éxito no es un registro.
  return NextResponse.json({
    ...resultado,
    auditoria_error: registro.ok ? null : registro.error,
  });
}

export async function PUT(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  // Edición y no admin: reescribir un borrador se deshace volviéndolo a escribir.
  if (!(await puedeEditarFacturacion(supabase, user.id))) {
    return NextResponse.json(
      { error: "Actualizar el borrador requiere nivel de edición en Facturación" },
      { status: 403 }
    );
  }
  if (!hayCredencialesOdoo()) {
    return NextResponse.json({ error: avisoDeCredencialesFaltantes() }, { status: 503 });
  }

  const resultado = await actualizarElBorradorEnOdoo(createAdminClient(), id);

  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.motivos.join(" "), motivos: resultado.motivos },
      { status: 409 }
    );
  }

  return NextResponse.json(resultado.factura);
}
