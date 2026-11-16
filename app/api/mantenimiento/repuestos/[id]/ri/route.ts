import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuentaDeUnRepuesto, leerNroRi } from "@/lib/mantenimiento/cuentaDeUnRepuesto";

/**
 * Pegar un RI de Compras a un repuesto de una OT, y sacarlo.
 *
 * **El destino sale de la fila:** si el renglón tiene `articulo_id`, el RI se pega
 * al artículo y vale para toda OT que lo use; si no, al renglón y vale sólo ahí.
 *
 * **Se comprueba contra `compras_requerimientos` antes de pegar**, aunque la tabla
 * no tenga foreign key (a propósito: un RI que la planilla deje de tener no debe
 * llevarse el vínculo): lo que se rechaza es tipear un número que nunca existió.
 *
 * **El 23505 del índice único se traduce a 409** y no se resuelve con un `upsert`.
 * Los índices son comunes y no parciales, así que un `ON CONFLICT` serviría; pero
 * pegarlo dos veces es un pedido repetido que conviene decir, no tragarse: la
 * pantalla vieja de otra persona le cuenta a quien aprieta que ya estaba.
 *
 * Sacar toca los dos destinos de este renglón (artículo y renglón): el RI pudo
 * pegarse antes de que se eligiera el artículo, y desde acá se quiere que no
 * quede en ningún lado. Las dos respuestas devuelven la cuenta de lo que viene.
 */

type Params = { params: Promise<{ id: string }> };

async function conPermiso() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return {
      error: NextResponse.json(
        { error: "Pegar un RI a un repuesto requiere nivel de edición en Mantenimiento" },
        { status: 403 }
      ),
    };
  }
  return { user };
}

async function respuesta(
  renglon: { id: string; work_order_id: string; articulo_id: string | null },
  extra: Record<string, unknown> = {}
) {
  // **Lo escrito ya está escrito**: si sólo falla armar la cuenta, contestar 500
  // le diría a la persona que no se guardó, apretaría de nuevo y recibiría un 409
  // «ya está pegado» que se lee como una contradicción. Se contesta 200 sin
  // cuenta y con una advertencia en castellano; el error crudo va al log.
  try {
    const cuenta = await cuentaDeUnRepuesto(createAdminClient(), renglon);
    return NextResponse.json({ ...extra, cuenta });
  } catch (e) {
    console.error("[repuestos/ri] la cuenta de lo que viene falló después de guardar:", e);
    return NextResponse.json({
      ...extra,
      cuenta: null,
      advertencia: "Se guardó, pero no se pudo calcular lo que viene. Recargá la pantalla para verlo.",
    });
  }
}

/** POST — `{ nro_ri }`. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const permiso = await conPermiso();
  if (permiso.error) return permiso.error;

  const cuerpo = await request.json().catch(() => null);
  const r = leerNroRi(cuerpo?.nro_ri);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  const { nro_ri } = r;

  const admin = createAdminClient();

  const { data: renglon } = await admin
    .from("ordenes_trabajo_repuestos")
    .select("id, work_order_id, articulo_id")
    .eq("id", id)
    .maybeSingle();
  if (!renglon) return NextResponse.json({ error: "No existe ese repuesto" }, { status: 404 });

  // Una fila alcanza; `range(0, 0)` y no `maybeSingle`, que falla si el número se repite.
  const { data: existe } = await admin
    .from("compras_requerimientos").select("nro_ri").eq("nro_ri", nro_ri).range(0, 0);
  if (!existe || existe.length === 0) {
    return NextResponse.json({ error: `No existe el RI ${nro_ri} en Compras` }, { status: 404 });
  }

  const { data, error } = await admin
    .from("mant_ri_de_repuesto")
    .insert({
      nro_ri,
      articulo_id: renglon.articulo_id ?? null,
      repuesto_id: renglon.articulo_id ? null : renglon.id,
      creado_por: permiso.user!.id,
    })
    .select("id, nro_ri, articulo_id, repuesto_id, creado_en")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: `El RI ${nro_ri} ya está pegado a este repuesto.` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return respuesta(renglon, { data });
}

/** DELETE — `?nro_ri=`. Lo saca del artículo y del renglón. */
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const permiso = await conPermiso();
  if (permiso.error) return permiso.error;

  const r = leerNroRi(new URL(request.url).searchParams.get("nro_ri"));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  const { nro_ri } = r;

  const admin = createAdminClient();
  const { data: renglon } = await admin
    .from("ordenes_trabajo_repuestos")
    .select("id, work_order_id, articulo_id")
    .eq("id", id)
    .maybeSingle();
  if (!renglon) return NextResponse.json({ error: "No existe ese repuesto" }, { status: 404 });

  // Dos borrados que no son atómicos: si el segundo falla, el primero ya se
  // hizo y se contesta 400 con el vínculo a medio sacar. Repetir el pedido lo
  // termina (borrar lo que no está no falla), así que no se envuelve en nada más.
  const borrados = [
    admin.from("mant_ri_de_repuesto").delete().eq("repuesto_id", id).eq("nro_ri", nro_ri),
    ...(renglon.articulo_id
      ? [admin.from("mant_ri_de_repuesto").delete().eq("articulo_id", renglon.articulo_id).eq("nro_ri", nro_ri)]
      : []),
  ];
  for (const b of borrados) {
    const { error } = await b;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return respuesta(renglon);
}
