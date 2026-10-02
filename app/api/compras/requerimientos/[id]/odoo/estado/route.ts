import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarCompras, tieneAccesoCompras } from "@/lib/compras/auth";
import { avisoDeCredencialesFaltantes, hayCredencialesOdoo } from "@/lib/odoo/client";
import { confirmarLaOrden, estadosDeLasOrdenes } from "@/lib/odoo/pdfDeOrden";
import { leerEstado } from "@/lib/odoo/estadoDeOrden";
import { traerLasOrdenes } from "@/lib/odoo/ordenEnOdoo";
import { diferenciasDeLaOrden } from "@/lib/compras/divergenciaDeOrden";

/**
 * En qué estado están las órdenes de este requerimiento en Odoo, y confirmarlas.
 *
 * - `GET`  → **qué dice** cada una, leído de Odoo en el momento: proveedor,
 *   fecha, líneas con cantidad y precio, totales, y cuánto se recibió y se
 *   facturó. Antes devolvía sólo el estado, que es una palabra; con eso no se
 *   podía contestar qué se pidió ni en qué quedó sin abrir Odoo. Pedir quince
 *   campos en vez de uno no cuesta otro viaje, que es lo que se paga.
 * - `POST` con `{ orden }` → la confirma (`button_confirm`) y devuelve el
 *   estado que quedó.
 *
 * **Por qué el estado no se guarda de este lado.** La orden vive en Odoo y ahí
 * la puede confirmar o cancelar cualquiera; una copia nuestra empezaría a
 * mentir el primer día y nada avisaría. Odoo manda, así que se pregunta.
 *
 * Y por qué es una ruta aparte y no parte de la ficha: la ficha es un Server
 * Component, y meterle una llamada a Odoo la haría esperar hasta 30s para
 * mostrar dos palabras. Acá la pantalla dibuja primero y el estado llega
 * después.
 *
 * **Confirmar lo aprieta una persona, no la generación de la orden.** No es
 * gratis: crea el remito de entrada y deja la orden sin poder editarse ni
 * borrarse en Odoo. Quién puede hacerlo es quien puede editar Compras; leer el
 * estado, cualquiera que tenga acceso al módulo.
 *
 * Las dos operaciones validan la orden contra el vínculo del requerimiento: el
 * id que llega por la URL tiene que ser de *este* RI, o cambiar un número
 * confirmaría órdenes ajenas.
 */

export const maxDuration = 60;

/** Las órdenes que este requerimiento tiene vinculadas. */
async function ordenesDelRequerimiento(requerimientoId: string): Promise<number[]> {
  const { data } = await createAdminClient()
    .from("compras_odoo_ordenes")
    .select("odoo_order_id")
    .eq("requerimiento_id", requerimientoId);

  return (data ?? []).map((o) => o.odoo_order_id as number);
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const ids = await ordenesDelRequerimiento(id);

  try {
    const leidas = await traerLasOrdenes(ids);

    /*
     * `estados` se mantiene con la forma de antes a propósito: es lo que decide
     * si se ofrece el botón de confirmar, y cambiarle la forma al mismo tiempo
     * que se agrega lo demás mezcla dos cosas. Una orden que ya no está en Odoo
     * no vuelve en el mapa y `leerEstado(null)` la deja sin confirmar, que es
     * lo que hacía antes.
     */
    const estados = ids.map((odooOrderId) => ({
      odooOrderId,
      ...(leidas.get(odooOrderId)?.estado ?? leerEstado(null)),
    }));

    /*
     * La comparación va contra la **suma** de las órdenes. Un pedido que pagan
     * las dos empresas son dos del 50%, y comparar una sola contra el costo
     * entero sería un cartel permanente y falso en cada ficha compartida.
     */
    const todas = [...leidas.values()];
    const { data: ri } = await createAdminClient()
      .from("compras_requerimientos")
      .select("costo_iva, cantidad")
      .eq("id", id)
      .maybeSingle();

    const diferencias = ri
      ? diferenciasDeLaOrden(
          { costoConIva: ri.costo_iva as number | null, cantidad: ri.cantidad as number | null },
          {
            total: todas.reduce((a, o) => a + o.total, 0),
            cantidad: todas.reduce(
              (a, o) => a + o.lineas.reduce((b, l) => b + l.cantidad, 0),
              0
            ),
          }
        )
      : [];

    return NextResponse.json({ estados, ordenes: todas, diferencias });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json(
      { error: "No tenés permiso para confirmar la orden en Odoo" },
      { status: 403 }
    );
  }

  if (!hayCredencialesOdoo()) {
    return NextResponse.json({ error: avisoDeCredencialesFaltantes() }, { status: 503 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const pedida = Number(body?.orden);

  if (!Number.isInteger(pedida) || pedida <= 0) {
    return NextResponse.json({ error: "Falta decir qué orden confirmar." }, { status: 400 });
  }

  if (!(await ordenesDelRequerimiento(id)).includes(pedida)) {
    return NextResponse.json({ error: "Esa orden no es de este requerimiento." }, { status: 404 });
  }

  /*
   * Se vuelve a mirar el estado antes de confirmar, y no se confía en lo que la
   * pantalla creía: entre que se dibujó y se apretó, alguien pudo confirmarla o
   * cancelarla en Odoo. Confirmar una cancelada sería revivir a mano algo que
   * dieron de baja del otro lado.
   */
  try {
    const antes = leerEstado((await estadosDeLasOrdenes([pedida])).get(pedida) ?? null);

    if (!antes.sePuedeConfirmar) {
      return NextResponse.json({
        yaEstaba: true,
        ...antes,
        aviso: antes.estaConfirmada
          ? `La orden ya estaba confirmada en Odoo (${antes.nombre}).`
          : `La orden no se puede confirmar desde acá: en Odoo figura como ${antes.nombre}.`,
      });
    }

    return NextResponse.json({ yaEstaba: false, ...leerEstado(await confirmarLaOrden(pedida)) });
  } catch (e) {
    /*
     * Un fallo al confirmar no rompe nada: la orden sigue en Odoo, en borrador,
     * y se confirma allá o volviendo a apretar. El texto va con lo que dijo
     * Odoo sin traducir, como el resto de la integración.
     */
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
