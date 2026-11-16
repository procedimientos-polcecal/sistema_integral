import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { cuentaDeUnRepuesto } from "@/lib/mantenimiento/cuentaDeUnRepuesto";

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

const esquema = z.object({
  nro_ri: z
    .number({ error: "El número de RI tiene que ser un número" })
    .int("El número de RI tiene que ser entero")
    .positive("El número de RI tiene que ser mayor que cero"),
});

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
  try {
    const cuenta = await cuentaDeUnRepuesto(createAdminClient(), renglon);
    return NextResponse.json({ ...extra, cuenta });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** POST — `{ nro_ri }`. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const permiso = await conPermiso();
  if (permiso.error) return permiso.error;

  const r = validar(esquema, await request.json().catch(() => null));
  if (!r.ok) return errorDeValidacion(r.problemas);
  const { nro_ri } = r.datos;

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

  const r = validar(esquema, { nro_ri: Number(new URL(request.url).searchParams.get("nro_ri")) });
  if (!r.ok) return errorDeValidacion(r.problemas);
  const { nro_ri } = r.datos;

  const admin = createAdminClient();
  const { data: renglon } = await admin
    .from("ordenes_trabajo_repuestos")
    .select("id, work_order_id, articulo_id")
    .eq("id", id)
    .maybeSingle();
  if (!renglon) return NextResponse.json({ error: "No existe ese repuesto" }, { status: 404 });

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
