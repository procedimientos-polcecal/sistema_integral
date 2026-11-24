import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento, puedeVerMantenimiento } from "@/lib/mantenimiento/auth";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { traerTodo } from "@/lib/core/paginado";
import { salidasCandidatas, type SalidaDelPanol } from "@/lib/inventario/salidasDelRepuesto";

/**
 * De qué salida del pañol salió el repuesto de una OT: ofrecer las candidatas y
 * declarar una. Pedir no es usar; lo que prueba que la pieza fue a esa orden es
 * la salida, y acá una persona dice cuál.
 *
 * **Los movimientos se leen con el cliente admin, y no es una comodidad.**
 * `inventario_movimientos` está cerrada con `tiene_acceso_inventario()`: con la
 * sesión, alguien de Mantenimiento sin Inventario recibe `null` sin ningún error
 * —la misma forma que el valor hora de RRHH, que le da 0 a quien no tiene el
 * módulo—, y ni siquiera se podría comprobar que el movimiento exista. Como RLS
 * no corre, **el permiso lo pone esta ruta**: ver Mantenimiento para el GET,
 * editarlo para el PATCH y el DELETE. Con sólo la sesión, cualquiera con el id de
 * un repuesto leería el kardex del pañol.
 *
 * **`movimiento_puesto_por` sale de la sesión y nunca del cuerpo.** La policy de
 * esa tabla es `for all` con `mant_puede_editar()`: si el id viniera del cuerpo,
 * cualquiera que pueda editar dejaría escrito que lo declaró otra persona, y
 * «quién lo dijo» es justo el dato que la columna existe para proteger.
 *
 * **El espejo llega tarde.** `inventario_movimientos` espeja la pestaña del
 * kardex y va detrás de la planilla (medido el 23/11/2026: 5.063 filas contra
 * 5.136, 73 de atraso): una salida cargada en la planilla y todavía no importada
 * **no aparece entre las candidatas y no da error**. Se resuelve sola con la
 * próxima sincronización.
 *
 * Las columnas nuevas (`movimiento_*`) las crea la migración
 * `20261123214811`, que corre una persona a mano: el GET no las nombra, así que
 * anda antes de que esté aplicada; el PATCH y el DELETE contestan 400 hasta
 * entonces.
 */

type Params = { params: Promise<{ id: string }> };

const SIN_ARTICULO = "El renglón todavía no dice qué artículo del pañol es.";

const esquema = z.object({
  movimiento_id: z.string().uuid("El movimiento no es válido"),
});

async function conPermiso() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return {
      error: NextResponse.json(
        { error: "Declarar la salida de un repuesto requiere nivel de edición en Mantenimiento" },
        { status: 403 }
      ),
    };
  }
  return { user };
}

const COLUMNAS = "id, articulo_id, fecha, cantidad, solicitante, sector_raw, equipo_raw, tipo";

/** GET — las salidas del pañol que pueden ser la de este repuesto. */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeVerMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: renglon } = await admin
    .from("ordenes_trabajo_repuestos")
    .select("id, articulo_id")
    .eq("id", id)
    .maybeSingle();
  if (!renglon) return NextResponse.json({ error: "No existe ese repuesto" }, { status: 404 });

  // Hoy 0 de 37 renglones tienen artículo: ésta es la respuesta habitual.
  if (!renglon.articulo_id) {
    return NextResponse.json({ candidatas: [], motivo: SIN_ARTICULO });
  }

  const { data: entradas, error: errEntrada } = await admin
    .from("inventario_movimientos")
    .select("articulo_id, fecha")
    .eq("articulo_id", renglon.articulo_id)
    .eq("tipo", "entrada")
    // `fecha` es nullable a propósito (migración 20260902115220: sin fecha el
    // movimiento existe igual) y Postgres pone los NULL primero en un orden
    // descendente: sin este filtro una entrada sin fecha ganaría el «más
    // reciente» y el GET volvería vacío sin avisar. Hoy no pasa (medido el
    // 23/11/2026: 0 de 1.166 entradas y 0 de 3.897 salidas sin fecha), pero el
    // fallo sería mudo.
    .not("fecha", "is", null)
    .order("fecha", { ascending: false })
    .range(0, 0);
  if (errEntrada) return NextResponse.json({ error: errEntrada.message }, { status: 500 });
  const entrada = entradas?.[0];
  if (!entrada) {
    return NextResponse.json({ candidatas: [], motivo: "Ese artículo no tiene ninguna entrada en el pañol." });
  }

  // Se filtra por artículo y por fecha **en la base**: PostgREST corta en 1.000
  // filas sin avisar, y el kardex tiene 3.897 salidas. El orden (fecha desc, id)
  // es el que decide cuáles sobreviven al tope cuando un día trae más de diez.
  let salidas: SalidaDelPanol[];
  try {
    salidas = await traerTodo<SalidaDelPanol>((d, h) =>
      admin
        .from("inventario_movimientos")
        .select(COLUMNAS)
        .eq("articulo_id", renglon.articulo_id!)
        .eq("tipo", "salida")
        .gte("fecha", entrada.fecha)
        .order("fecha", { ascending: false })
        .order("id", { ascending: true })
        .range(d, h)
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo leer el pañol" }, { status: 500 });
  }

  const candidatas = salidasCandidatas(entrada, salidas);
  if (candidatas.length === 0) {
    return NextResponse.json({
      candidatas,
      motivo: "Ese artículo no tiene salidas del pañol desde su última entrada.",
    });
  }
  return NextResponse.json({ candidatas });
}

/** PATCH — `{ movimiento_id }`. Declara con qué salida se cumplió el renglón. */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const permiso = await conPermiso();
  if (permiso.error) return permiso.error;

  const r = validar(esquema, await request.json().catch(() => null));
  if (!r.ok) return errorDeValidacion(r.problemas);

  const admin = createAdminClient();
  const { data: renglon } = await admin
    .from("ordenes_trabajo_repuestos")
    .select("id, articulo_id")
    .eq("id", id)
    .maybeSingle();
  if (!renglon) return NextResponse.json({ error: "No existe ese repuesto" }, { status: 404 });

  const { data: movimiento } = await admin
    .from("inventario_movimientos")
    .select("id, articulo_id, tipo")
    .eq("id", r.datos.movimiento_id)
    .maybeSingle();
  if (!movimiento) {
    return NextResponse.json({ error: "No existe esa salida del pañol" }, { status: 400 });
  }
  // Sólo una salida prueba que la pieza fue a una orden: una entrada es la
  // llegada de stock. Tipos medidos en producción: "salida" y "entrada".
  if (movimiento.tipo !== "salida") {
    return NextResponse.json({ error: "Ese movimiento no es una salida del pañol" }, { status: 400 });
  }
  if (!renglon.articulo_id) {
    return NextResponse.json({ error: SIN_ARTICULO }, { status: 400 });
  }
  if (movimiento.articulo_id !== renglon.articulo_id) {
    return NextResponse.json(
      { error: "Esa salida es de otro artículo del pañol, no del que dice este repuesto" },
      { status: 400 }
    );
  }

  const { error } = await admin
    .from("ordenes_trabajo_repuestos")
    .update({
      movimiento_id: movimiento.id,
      movimiento_puesto_por: permiso.user!.id,
      movimiento_puesto_en: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

/**
 * DELETE — saca el vínculo. Lleva también `puesto_por` y `puesto_en`: sin
 * `movimiento_id` dirían «alguien lo vinculó tal día» sobre nada.
 *
 * **No se audita, y conviene saber qué se pierde.** El valor se vuelve a poner
 * con un PATCH, pero la autoría no: un PATCH sobre un renglón ya vinculado pisa
 * también quién lo había declarado y cuándo, sin leer lo que había, y eso no
 * queda registrado en ningún lado. Se decidió así porque `auditoria` se reserva
 * para lo irreversible y esta es una afirmación que se vuelve a hacer; si se
 * quiere conservar la autoría anterior, hay que agregar la llamada.
 */
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const permiso = await conPermiso();
  if (permiso.error) return permiso.error;

  const { data, error } = await createAdminClient()
    .from("ordenes_trabajo_repuestos")
    .update({ movimiento_id: null, movimiento_puesto_por: null, movimiento_puesto_en: null })
    .eq("id", id)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "No existe ese repuesto" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
