import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puedeEditarProduccion } from "@/lib/produccion/auth";
import { espejarMovimiento } from "@/lib/produccion/envases/espejo";

/**
 * Cargar un movimiento de envases.
 *
 * Dos cosas pasan acá, y la segunda no es opcional aunque lo parezca:
 *
 * 1. La fila en `produccion_envases_movimientos`.
 * 2. El **espejo a la planilla**. La planilla manda: un movimiento que no llega
 *    allá no existe, porque la próxima sincronización lee el stock de la
 *    fórmula —que no lo incluye— y lo borra de hecho.
 *
 * Por eso el espejo **no corre en segundo plano**: se espera, se anota el
 * pendiente si falló, y se le dice a quien cargó. Es un segundo más de espera a
 * cambio de que nadie cargue algo que se va a evaporar sin aviso.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarProduccion(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para cargar movimientos" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.articulo_id) {
    return NextResponse.json({ error: "Falta el artículo" }, { status: 400 });
  }

  /** Un número del formulario. Lo que no sea un número positivo es cero. */
  const numero = (v: unknown): number => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const entrada = numero(body.entrada);
  const salida = numero(body.salida);
  const rotura = numero(body.rotura);
  const despacho = numero(body.despacho);

  // La misma regla que el check de la tabla, para que el error se lea en
  // castellano en vez de llegar como una violación de constraint.
  if (entrada + salida + rotura + despacho <= 0) {
    return NextResponse.json(
      { error: "El movimiento no mueve nada: cargá al menos un número." },
      { status: 400 }
    );
  }

  const { data: articulo } = await supabase
    .from("produccion_envases_articulos")
    .select("id, codigo")
    .eq("id", body.articulo_id)
    .single();
  if (!articulo) {
    return NextResponse.json({ error: "El artículo no existe" }, { status: 400 });
  }

  const fecha = typeof body.fecha === "string" && body.fecha ? body.fecha.slice(0, 10) : null;
  const texto = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;

  const { data: mov, error } = await supabase
    .from("produccion_envases_movimientos")
    .insert({
      articulo_id: articulo.id,
      codigo: articulo.codigo,
      fecha,
      entrada, salida, rotura, despacho,
      observacion: texto(body.observacion),
      proveedor_raw: texto(body.proveedor),
      creado_por: user.id,
      origen: "app",
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const espejo = await espejarMovimiento({
    codigo: articulo.codigo,
    entrada, salida, rotura, despacho,
    fecha,
    observacion: mov.observacion,
    proveedor: mov.proveedor_raw,
  });

  // El pendiente se anota o se limpia; nunca queda a medias.
  await supabase
    .from("produccion_envases_movimientos")
    .update(
      espejo.ok
        ? { sheets_fila: espejo.fila, sheets_pendiente: null, sheets_pendiente_en: null }
        : {
            sheets_pendiente: espejo.error ?? "no se pudo escribir",
            sheets_pendiente_en: new Date().toISOString(),
          }
    )
    .eq("id", mov.id);

  return NextResponse.json({
    data: { ...mov, sheets_fila: espejo.ok ? espejo.fila : null },
    // Con lo que dijo Google, sin traducir. La pantalla lo muestra: un fallo de
    // escritura no es un console.warn.
    planilla_error: espejo.ok ? null : espejo.error,
  });
}
