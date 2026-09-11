import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarCompras } from "@/lib/compras/auth";
import { avisoDeCredencialesFaltantes, hayCredencialesOdoo } from "@/lib/odoo/client";
import { empujarOrdenesDeRequerimiento, ensayarOrdenesDeRequerimiento } from "@/lib/odoo/pushOrden";

/**
 * La orden de compra de un requerimiento, en Odoo.
 *
 * - `GET`  → **ensayo**: muestra lo que se le mandaría a Odoo sin mandarlo.
 * - `POST` → la crea, en borrador, y guarda el vínculo.
 *
 * El GET existe porque esto escribe en la contabilidad de otra gente. Poder ver
 * los `vals` exactos antes de apretar el botón, y después de cada cambio en el
 * requerimiento, es más barato que revisar una orden mal creada en Odoo.
 *
 * Nunca postea ni confirma nada: la orden queda en `draft` y contabilidad
 * genera la factura desde ahí. El SdG propone, Odoo confirma.
 *
 * El `POST` acepta un cuerpo opcional `{ producto_id }` con el producto de
 * Odoo que Compras confirmó en el selector del ensayo. Sin cuerpo (o con uno
 * que no trae `producto_id`), el push busca lo que ya se aprendió para esa
 * misma descripción, y recién si tampoco hay usa el genérico `ART. VARIOS`.
 * Una pantalla vieja no rompe.
 */

export const maxDuration = 60;

async function permiso(): Promise<{ error: NextResponse } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };

  if (!(await puedeEditarCompras(supabase, user.id))) {
    return {
      error: NextResponse.json(
        { error: "No tenés permiso para crear la orden de compra" },
        { status: 403 }
      ),
    };
  }

  if (!hayCredencialesOdoo()) {
    return {
      error: NextResponse.json(
        { error: avisoDeCredencialesFaltantes() },
        { status: 503 }
      ),
    };
  }

  return { ok: true };
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const paso = await permiso();
  if ("error" in paso) return paso.error;

  const { id } = await params;
  try {
    return NextResponse.json(await ensayarOrdenesDeRequerimiento(createAdminClient(), id));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const paso = await permiso();
  if ("error" in paso) return paso.error;

  const { id } = await params;
  // El cuerpo es opcional: sin él, o sin `producto_id` adentro, la orden usa
  // el producto genérico, como antes de que existiera este selector.
  const body = await request.json().catch(() => null);
  const productoId = Number(body?.producto_id);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  try {
    const resultado = await empujarOrdenesDeRequerimiento(
      createAdminClient(),
      id,
      Number.isInteger(productoId) && productoId > 0
        ? { productoId, usuarioId: user?.id ?? null }
        : undefined
    );

    /*
     * 422 y no 500 cuando no se pudo armar: no es un error del servidor, es que
     * faltan datos —el proveedor no está en esa empresa, no hay cotización
     * elegida— y quien hizo la acción puede arreglarlo. El motivo va en la
     * respuesta **y** queda en `odoo_pendiente`, para que no dependa de que
     * alguien estuviera mirando la pantalla en ese momento.
     */
    return NextResponse.json(resultado, { status: resultado.ok ? 200 : 422 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
