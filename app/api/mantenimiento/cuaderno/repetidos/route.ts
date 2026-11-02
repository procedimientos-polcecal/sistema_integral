import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { traerTodo } from "@/lib/core/paginado";
import {
  diasRepetidos, type DiaRepetido, type MiembroDeGrupo, type RenglonPrevio,
} from "@/lib/mantenimiento/cuadernoRepetidos";

/**
 * Los días que una foto recién leída comparte con renglones ya cargados.
 *
 * - **GET** dice cuáles son. No bloquea nada: un día puede estar escrito en dos
 *   hojas, así que quien carga elige.
 * - **DELETE** reemplaza: borra los renglones **previos** de esos días. Lo
 *   decide con `diasRepetidos` **recalculando** acá, no con una lista de ids
 *   que mande el navegador: la negativa a borrar lo que ya generó una OT no
 *   puede depender de que la pantalla haya mandado bien los ids.
 *
 * Los dos ven los renglones de **todas las cargas del contratista**, no sólo
 * de la abierta: la misma hoja subida en otra carga es el caso que más se da.
 */

/** Un `.in()` con muchos ids arma una URL que PostgREST rechaza con un 400. */
const LOTE = 150;

const lotes = <T,>(xs: readonly T[]): T[][] => {
  const salida: T[][] = [];
  for (let i = 0; i < xs.length; i += LOTE) salida.push(xs.slice(i, i + LOTE));
  return salida;
};

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

type Calculo =
  | { ok: true; dias: DiaRepetido[]; fotos: string[] }
  | { ok: false; respuesta: NextResponse };

/** Lo que comparten las dos puntas: qué días se repiten y con qué renglones. */
async function calcular(
  supabase: Awaited<ReturnType<typeof createClient>>,
  cuadernoId: string,
  fotoIds: string[],
  fechasPedidas: string[] | null
): Promise<Calculo> {
  const error = (mensaje: string, status = 500): Calculo =>
    ({ ok: false, respuesta: NextResponse.json({ error: mensaje }, { status }) });

  if (!cuadernoId) return error("Falta la carga.", 400);
  if (fotoIds.length === 0) return error("Falta decir qué fotos se acaban de leer.", 400);

  try {
    const { data: carga, error: errorCarga } = await supabase
      .from("mant_cuadernos")
      .select("id, proveedor_id")
      .eq("id", cuadernoId)
      .maybeSingle();
    if (errorCarga) return error(errorCarga.message);
    if (!carga) return error("No existe esa carga.", 404);

    // Las fechas de lo recién leído, salvo que el que llama ya las haya elegido.
    let fechasNuevas: (string | null)[] = fechasPedidas ?? [];
    if (!fechasPedidas) {
      fechasNuevas = [];
      for (const lote of lotes(fotoIds)) {
        // `traerTodo` y no `.limit()`: PostgREST corta en 1000 filas sin avisar.
        const filas = await traerTodo((d, h) =>
          supabase
            .from("mant_cuadernos_renglones")
            .select("id, fecha")
            .in("foto_id", lote)
            .order("id")
            .range(d, h)
        );
        fechasNuevas.push(...filas.map((r) => r.fecha));
      }
    }
    const fechas = [...new Set(fechasNuevas.filter((f): f is string => !!f))];
    if (fechas.length === 0) return { ok: true, dias: [], fotos: fotoIds };

    // Todas las cargas de este contratista.
    const cargas = await traerTodo((d, h) =>
      supabase.from("mant_cuadernos").select("id").eq("proveedor_id", carga.proveedor_id).range(d, h)
    );
    const cargaIds = cargas.map((c) => c.id);

    const previos: RenglonPrevio[] = [];
    for (const delasCargas of lotes(cargaIds)) {
      for (const delasFechas of lotes(fechas)) {
        const filas = await traerTodo((d, h) =>
          supabase
            .from("mant_cuadernos_renglones")
            .select("id, cuaderno_id, foto_id, fecha, tarea, orden_trabajo_id, grupo_id")
            .in("cuaderno_id", delasCargas)
            .in("fecha", delasFechas)
            .order("id")
            .range(d, h)
        );
        previos.push(...(filas as RenglonPrevio[]));
      }
    }

    // Los compañeros de grupo de los previos: un grupo con orden la tiene entera.
    const grupos = [...new Set(previos.map((r) => r.grupo_id).filter((g): g is string => !!g))];
    const miembros: MiembroDeGrupo[] = [];
    for (const lote of lotes(grupos)) {
      const filas = await traerTodo((d, h) =>
        supabase
          .from("mant_cuadernos_renglones")
          .select("grupo_id, orden_trabajo_id")
          .in("grupo_id", lote)
          .order("id")
          .range(d, h)
      );
      miembros.push(...filas);
    }

    const dias = diasRepetidos(fechas, previos, new Set(fotoIds), cuadernoId, miembros);
    return { ok: true, dias, fotos: fotoIds };
  } catch (e) {
    return error(e instanceof Error ? e.message : String(e));
  }
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const fotoIds = (params.get("foto_ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const r = await calcular(supabase, params.get("cuaderno_id") ?? "", fotoIds, null);
  if (!r.ok) return r.respuesta;
  return NextResponse.json({ dias: r.dias });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const cuerpo = await cuerpoJson<{ cuaderno_id?: unknown; foto_ids?: unknown; fechas?: unknown }>(request);
  const fotoIds = Array.isArray(cuerpo.foto_ids) ? cuerpo.foto_ids.filter((x): x is string => typeof x === "string") : [];
  const fechas = Array.isArray(cuerpo.fechas) ? cuerpo.fechas.filter((x): x is string => typeof x === "string" && FECHA.test(x)) : [];
  if (fechas.length === 0) return NextResponse.json({ error: "Falta decir qué días se reemplazan." }, { status: 400 });

  const r = await calcular(supabase, typeof cuerpo.cuaderno_id === "string" ? cuerpo.cuaderno_id : "", fotoIds, fechas);
  if (!r.ok) return r.respuesta;

  // Sólo los días pedidos que siguen repetidos. Si alguno no se puede, no se
  // borra **ninguno**: reemplazar la mitad dejaría el día a medio cambiar.
  const pedidos = new Set(fechas);
  const dias = r.dias.filter((d) => pedidos.has(d.fecha));
  const bloqueados = dias.filter((d) => !d.se_puede_reemplazar);
  if (bloqueados.length > 0) {
    return NextResponse.json({ error: bloqueados.map((d) => `${d.fecha}: ${d.motivo}`).join(" ") }, { status: 409 });
  }

  // No lleva `auditar()` a propósito: la lista de acciones auditadas es la de lo
  // que no se deshace, y estos renglones se rehacen —la foto sigue en el bucket y
  // `respuesta_cruda` guarda lo que leyó el modelo—. La guarda que importa es la
  // de arriba: se niega si alguno ya generó una OT.
  const ids = dias.flatMap((d) => d.renglon_ids);
  if (ids.length === 0) return NextResponse.json({ ok: true, borrados: 0 });

  const admin = createAdminClient();
  let borrados = 0;
  for (const lote of lotes(ids)) {
    // `orden_trabajo_id is null` también acá: si la generación convirtió uno
    // entre la lectura y el borrado, no se lo lleva.
    const { data, error } = await admin
      .from("mant_cuadernos_renglones")
      .delete()
      .in("id", lote)
      .is("orden_trabajo_id", null)
      .select("id");
    if (error) {
      return NextResponse.json(
        { error: `Se borraron ${borrados} de ${ids.length} renglones y falló el resto: ${error.message}` },
        { status: 500 }
      );
    }
    borrados += (data ?? []).length;
  }
  if (borrados !== ids.length) {
    return NextResponse.json(
      { error: `Se borraron ${borrados} de ${ids.length} renglones: alguno se convirtió en una orden mientras tanto. Revisá esos días.` },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true, borrados });
}
