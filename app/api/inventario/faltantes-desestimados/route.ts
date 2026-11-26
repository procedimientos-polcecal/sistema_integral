import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarInventario } from "@/lib/inventario/auth";
import { nombreParaAuditoria } from "@/lib/core/auditoria";

/**
 * Desestimar un faltante, y volver a considerarlo.
 *
 * «Para reponer» propone comprar lo que tiene faltante y consumo reciente.
 * Desestimar es contestarle que no: el artículo sale de la propuesta y pasa a
 * una lista aparte, hasta que vuelva a moverse. Por qué «volver a moverse» se
 * mide contra el **día** del último movimiento y no contra el instante en que
 * se desestimó está en [lib/inventario/desestimar.ts](lib/inventario/desestimar.ts);
 * el resumen es que los movimientos llegan en tandas del mismo día y el
 * instante levantaría la desestimación a los cinco minutos.
 *
 * **El `ultimo_movimiento` lo calcula la ruta y no llega del cliente.** Es el
 * ancla de la que depende cuánto dura la decisión: si lo mandara la pantalla,
 * una fecha vieja la volvería eterna y una futura la haría inútil, y las dos
 * cosas se verían igual de bien desde afuera.
 *
 * **No se audita**, a diferencia de ajustar stock: se deshace con un click
 * desde la misma pantalla y la fila guarda quién fue y cuándo, que es lo que
 * hay que poder contestar. La `auditoria` del núcleo es para lo que no vuelve.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarInventario(supabase, user.id))) {
    return NextResponse.json(
      { error: "Tu usuario no tiene nivel de edición en Inventario" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const articuloId = String(body?.articulo_id ?? "").trim();
  if (!articuloId) {
    return NextResponse.json({ error: "Falta de qué artículo se trata" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: articulo } = await admin
    .from("inventario_articulos")
    .select("id, codigo, descripcion")
    .eq("id", articuloId)
    .maybeSingle();
  if (!articulo) {
    return NextResponse.json({ error: "Ese artículo no existe" }, { status: 404 });
  }

  /*
   * El día del último movimiento del artículo. Se busca por `articulo_id` y no
   * por código: el código se repite en el movimiento sólo para poder leer el
   * kardex sin resolver el artículo, y en 16 de las 766 entradas con RI ya se
   * vio que puede no coincidir. El que manda es el enlace resuelto.
   *
   * Sin movimientos queda en null, que la decisión lee como «cualquiera lo
   * despierta».
   */
  const { data: ultimo } = await admin
    .from("inventario_movimientos")
    .select("fecha")
    .eq("articulo_id", articuloId)
    .not("fecha", "is", null)
    .order("fecha", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: quien } = await admin
    .from("usuarios")
    .select("nombre, apellido, email")
    .eq("id", user.id)
    .maybeSingle();

  const motivo = String(body?.motivo ?? "").trim() || null;

  const { error } = await admin
    .from("inventario_faltantes_desestimados")
    .upsert(
      {
        articulo_id: articuloId,
        ultimo_movimiento: (ultimo?.fecha as string | null) ?? null,
        motivo,
        desestimado_por: user.id,
        desestimado_por_nombre: nombreParaAuditoria(quien) || null,
        // Volver a desestimar reinicia el reloj: sin esto, la fila conservaría
        // la fecha de la primera vez y la decisión nueva nacería caducada.
        desestimado_en: new Date().toISOString(),
      },
      { onConflict: "articulo_id" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, ultimo_movimiento: ultimo?.fecha ?? null });
}

/** Volver a considerarlo: se borra la fila y el artículo vuelve a la propuesta. */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarInventario(supabase, user.id))) {
    return NextResponse.json(
      { error: "Tu usuario no tiene nivel de edición en Inventario" },
      { status: 403 }
    );
  }

  const articuloId = new URL(request.url).searchParams.get("articulo_id")?.trim() ?? "";
  if (!articuloId) {
    return NextResponse.json({ error: "Falta de qué artículo se trata" }, { status: 400 });
  }

  const { error } = await createAdminClient()
    .from("inventario_faltantes_desestimados")
    .delete()
    .eq("articulo_id", articuloId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
