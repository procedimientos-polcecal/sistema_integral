import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { traerTodo } from "@/lib/core/paginado";
import { cuentaDeUnRepuesto } from "@/lib/mantenimiento/cuentaDeUnRepuesto";

/**
 * A qué artículo del pañol se refiere un renglón de repuesto de una OT.
 *
 * Lo elige una persona y **nunca se completa por parecido de nombre**: enlazar
 * al que se le parece es peor que dejar en null. Soltarlo deja `articulo_id` en
 * null y no borra el renglón. Las dos devuelven la cuenta de lo que viene, que
 * cambia al cambiar de artículo.
 *
 * ── CAMBIAR O SOLTAR EL ARTÍCULO CON RI PEGADOS: SE NIEGA, PERO NO TODO IGUAL ──
 *
 * Hay dos clases de vínculo que este renglón puede tener, y **frenan cosas
 * distintas por una razón distinta**:
 *
 * **Los pegados al artículo** (`articulo_id = el viejo`) frenan **cambiar y
 * soltar**. Pegar un RI a un renglón con artículo lo escribe sobre el artículo, y
 * esa decisión la toma la ruta (`ri/route.ts`), no la persona: ella dijo «este RI
 * es de esta pieza». Esa fila no guarda de qué renglón vino. Si después se cambia
 * el artículo y la fila vieja queda, **sigue contando para todas las demás órdenes
 * abiertas que piden el artículo viejo**, y desde esta pantalla ya no se puede
 * sacar, porque el DELETE busca en el artículo *nuevo*. Se podría borrar al
 * cambiar, pero no se sabe cuáles eran de este renglón y cuáles los pegó otro del
 * mismo artículo: borrar es llevarse el trabajo ajeno sin avisar.
 *
 * **Los pegados al renglón** (`repuesto_id = este renglón`, que es lo que pasa si
 * el RI se pegó antes de elegir artículo) frenan **las dos cosas también**, y por una
 * razón que no es la misma. La cuenta (`cuentaDeUnRepuesto`) lee los vínculos de
 * *todos* los renglones del artículo, así que en cuanto el renglón elige artículo su
 * vínculo propio pasa a valer para el grupo: eso es lo pedido —pegar primero el
 * número y elegir el artículo después— y no es una fuga, porque el renglón ya es de
 * ese artículo. Lo que sí sería una fuga es que **cambiar** el artículo lo arrastrara
 * a otro grupo: el pedido nunca fue de esa pieza y el RI pasaría a cubrir a todas las
 * órdenes abiertas que piden el artículo nuevo (reproducido: pegar el 500 sin
 * artículo, elegir A y cambiar a B lo dejaba pasar).
 *
 * **Y soltar se frena por eso mismo, aunque mirado solo parezca inofensivo.** Soltar
 * angosta el alcance —el vínculo vuelve a valer sólo para este renglón—, nadie lee
 * «cubierta» de más, y el vínculo sigue alcanzable porque el DELETE de `ri` lo busca
 * por `repuesto_id`. Pero **soltar y volver a elegir son el cambio que esta misma
 * ruta acaba de negar**: en dos clics, con los dos botones uno al lado del otro en la
 * pantalla, y con `viejo` en null las dos preguntas de abajo dan false y el vínculo
 * entra al grupo nuevo sin que nada lo mire. Dejar abierta la primera mitad era dejar
 * abierto el camino entero, y **la orden que lee «cubierta» de más no es la de quien
 * apretó**, así que el aviso de la pantalla no la alcanza. La primera versión de este
 * arreglo frenaba sólo el cambio; lo encontró la revisión de la misma ola.
 *
 * Quien se equivocó de artículo saca el RI y lo vuelve a pegar: dos clics y el
 * número, a cambio de que el sistema no lo mueva solo.
 *
 * Repetir el mismo artículo no es un cambio.
 *
 * **El 409 trae `ris_pegados`** con los números de los dos orígenes: puede haber un
 * vínculo cuyo RI la planilla ya dejó de tener (no hay foreign key justamente para
 * eso), y esa fila bloquea aunque la cuenta no la vea. Con los números la pantalla
 * puede ofrecer sacarlos uno por uno, y el DELETE de `ri` alcanza a los dos.
 * Y el 404 de un artículo inexistente gana sobre el 409: ver el comentario abajo.
 */

type Params = { params: Promise<{ id: string }> };

const esquema = z.object({ articulo_id: z.string().min(1, "Falta el artículo") });

async function conPermiso() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return {
      error: NextResponse.json(
        { error: "Elegir el artículo de un repuesto requiere nivel de edición en Mantenimiento" },
        { status: 403 }
      ),
    };
  }
  return { user };
}

async function guardar(id: string, articuloId: string | null) {
  const admin = createAdminClient();

  const { data: renglon } = await admin
    .from("ordenes_trabajo_repuestos")
    .select("id, work_order_id, articulo_id")
    .eq("id", id)
    .maybeSingle();
  if (!renglon) return NextResponse.json({ error: "No existe ese repuesto" }, { status: 404 });

  // **Primero se comprueba que el artículo nuevo exista, y recién después qué
  // bloquea.** Un artículo que no existe es un pedido que no puede salir bien
  // pase lo que pase: avisar antes de los RI mandaría a la persona a sacar
  // vínculos para toparse después con un 404.
  if (articuloId !== null) {
    const { data: articulo } = await admin
      .from("inventario_articulos").select("id").eq("id", articuloId).maybeSingle();
    if (!articulo) return NextResponse.json({ error: "No existe ese artículo del pañol" }, { status: 404 });
  }

  const viejo = (renglon.articulo_id as string | null) ?? null;
  // **Con artículo puesto, el artículo no se mueve mientras haya un RI pegado**, sea
  // del artículo o del propio renglón: las dos clases frenan cambiar y soltar, por
  // razones distintas que están en la cabecera.
  // **Elegir el primero (viejo null) no es cambiar**: ahí el vínculo del renglón pasa a
  // valer para el grupo, que es lo pedido, y bloquearlo impediría pegar primero y elegir después.
  const bloquea = viejo !== null && viejo !== articuloId;
  if (bloquea) {
    // **Se leen de la tabla de vínculos y no de la cuenta, a propósito.** La
    // cuenta ignora un RI que la planilla ya no tiene (no trae nada); este
    // bloqueo no puede ignorarlo, porque la fila sigue ahí y sigue bloqueando.
    // Por eso el 409 **lleva los números**: la pantalla no los puede sacar de
    // `cuenta.ris`, y sin ellos la persona tendría que sacar vínculos que no ve.
    // Dos consultas y no un `or`: son dos columnas y dos razones distintas.
    const pegados: { nro_ri: number }[] = [];
    try {
      pegados.push(
        ...(await traerTodo((d, h) =>
          admin.from("mant_ri_de_repuesto").select("nro_ri").eq("articulo_id", viejo!).range(d, h)
        ))
      );
      pegados.push(
        ...(await traerTodo((d, h) =>
          admin.from("mant_ri_de_repuesto").select("nro_ri").eq("repuesto_id", id).range(d, h)
        ))
      );
    } catch {
      return NextResponse.json({ error: "No se pudieron comprobar los RI de este repuesto" }, { status: 500 });
    }
    if (pegados.length > 0) {
      const ris = [...new Set(pegados.map((p) => p.nro_ri))].sort((x, y) => x - y);
      const uno = ris.length === 1;
      return NextResponse.json(
        {
          error:
            `Este repuesto tiene pegado${uno ? "" : "s"} ${uno ? "el RI" : "los RI"} ${ris.join(", ")}, ` +
            `que ${uno ? "vale" : "valen"} para todas las órdenes que piden este artículo: ` +
            `${uno ? "sacalo" : "sacalos"} antes de cambiar o soltar el artículo.`,
          ris_pegados: ris,
        },
        { status: 409 }
      );
    }
  }

  const { error } = await admin
    .from("ordenes_trabajo_repuestos")
    .update({ articulo_id: articuloId })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Lo escrito ya está escrito: si sólo falla la cuenta se contesta 200 con una
  // advertencia, no 500 (que le diría a la persona que no se guardó).
  try {
    const cuenta = await cuentaDeUnRepuesto(admin, { ...renglon, articulo_id: articuloId });
    return NextResponse.json({ data: { articulo_id: articuloId }, cuenta });
  } catch (e) {
    console.error("[repuestos/articulo] la cuenta de lo que viene falló después de guardar:", e);
    return NextResponse.json({
      data: { articulo_id: articuloId },
      cuenta: null,
      advertencia: "Se guardó, pero no se pudo calcular lo que viene. Recargá la pantalla para verlo.",
    });
  }
}

/** PUT — `{ articulo_id }`. */
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const permiso = await conPermiso();
  if (permiso.error) return permiso.error;

  const r = validar(esquema, await request.json().catch(() => null));
  if (!r.ok) return errorDeValidacion(r.problemas);
  return guardar(id, r.datos.articulo_id);
}

/** DELETE — suelta el artículo; el renglón queda. */
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const permiso = await conPermiso();
  if (permiso.error) return permiso.error;
  return guardar(id, null);
}
