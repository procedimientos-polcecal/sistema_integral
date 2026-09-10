import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarFacturacion, tieneAccesoFacturacion } from "@/lib/facturacion/auth";
import type { EstadoDeFactura } from "@/lib/facturacion/types";

/**
 * Corregir o vincular una factura del buzón.
 *
 * Lo que se puede cambiar es corto a propósito: **la empresa, el proveedor, el
 * requerimiento, el estado y las notas.** Los datos fiscales no, porque son la
 * identidad del comprobante y la clave del índice único: cambiarlos convertiría
 * esta factura en otra. Una cargada con el número equivocado se anota en `notas`
 * y se carga la buena.
 *
 * Borrar tampoco existe, y no es un olvido: una factura que llegó, llegó.
 */

const ESTADOS: EstadoDeFactura[] = ["recibida", "vinculada", "informada", "contabilizada"];

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoFacturacion(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Facturación" }, { status: 403 });
  }

  const { data: factura } = await supabase
    .from("facturas_proveedor")
    .select("archivo_url, archivo_nombre")
    .eq("id", id)
    .single();

  if (!factura) return NextResponse.json({ error: "No existe esa factura" }, { status: 404 });
  if (!factura.archivo_url) {
    return NextResponse.json({ error: "Esa factura se cargó sin archivo" }, { status: 404 });
  }

  /*
   * El bucket es privado, así que el link se firma cuando alguien lo pide y no
   * se guarda en la base: un link firmado vence, y un dato guardado que vence es
   * un dato que se podre solo. Una hora alcanza para mirarla o descargarla.
   */
  const { data: firmado, error } = await createAdminClient()
    .storage.from("facturas-proveedor")
    .createSignedUrl(factura.archivo_url, 60 * 60);

  if (error || !firmado) {
    return NextResponse.json(
      { error: `No se pudo abrir el archivo: ${error?.message ?? "sin link"}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ link: firmado.signedUrl, nombre: factura.archivo_nombre });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarFacturacion(supabase, user.id))) {
    return NextResponse.json(
      { error: "Corregir una factura requiere nivel de edición en Facturación" },
      { status: 403 }
    );
  }

  const b = await cuerpoJson(request);
  const cambios: Record<string, unknown> = {};

  // Los tres enlaces aceptan `null` explícito: desvincular es una acción, no un
  // olvido, así que `undefined` (no vino el campo) y `null` (vaciarlo) no son lo
  // mismo.
  for (const campo of ["empresa_id", "proveedor_id", "requerimiento_id"] as const) {
    if (campo in b) cambios[campo] = b[campo] || null;
  }

  if ("notas" in b) cambios.notas = String(b.notas ?? "").trim() || null;

  /*
   * Vincular por **número** de requerimiento, que es el que la gente tiene a
   * mano: nadie sabe el uuid de un RI. Un número que no existe se contesta
   * diciéndolo, no enlazando al que se le parece.
   */
  if ("nro_ri" in b) {
    const nro = Number(b.nro_ri);
    if (!Number.isFinite(nro)) {
      return NextResponse.json({ error: `"${b.nro_ri}" no es un número de requerimiento` }, { status: 400 });
    }
    const { data: ri } = await supabase
      .from("compras_requerimientos")
      .select("id")
      .eq("nro_ri", nro)
      .maybeSingle();
    if (!ri) {
      return NextResponse.json({ error: `No existe el requerimiento ${nro}` }, { status: 404 });
    }
    cambios.requerimiento_id = ri.id;
  }

  if ("estado" in b) {
    if (!ESTADOS.includes(b.estado)) {
      return NextResponse.json(
        { error: `"${b.estado}" no es un estado del buzón` },
        { status: 400 }
      );
    }
    cambios.estado = b.estado;
  }

  /*
   * Vincularla a un requerimiento la saca del buzón sola. Es lo que uno espera
   * al vincular, y pedir además que alguien cambie el estado a mano sería
   * guardar dos veces lo mismo — con la mitad de las filas quedando en
   * "recibida" para siempre.
   */
  if (cambios.requerimiento_id && !("estado" in cambios)) cambios.estado = "vinculada";

  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: "No vino nada para cambiar" }, { status: 400 });
  }

  const { data: factura, error } = await supabase
    .from("facturas_proveedor")
    .update(cambios)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!factura) {
    return NextResponse.json({ error: "No existe esa factura" }, { status: 404 });
  }

  return NextResponse.json({ factura });
}
