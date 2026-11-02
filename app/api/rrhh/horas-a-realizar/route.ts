import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/rrhh/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { errorDeValidacion } from "@/lib/core/validar";
import { comoSeLee } from "@/lib/core/fechas";
import {
  horasValidas,
  primeraQueSeSuperpone,
  problemasDeLaVigencia,
} from "@/lib/rrhh/ausentismo/vigencias";

/**
 * Las horas que debería trabajar una persona de cada sector en el mes: el
 * divisor del reporte porcentual de ausentismo.
 *
 * `GET` lo lee cualquiera que entre al sistema. **El porqué cambió el
 * 02/11/2026 y conviene que quede dicho acá**, porque el encabezado de la
 * migración `20261029112043` guarda el motivo viejo y una migración aplicada no
 * se edita: decía que el porcentual lo veía todo el mundo, y desde que se cerró
 * el desglose por motivo (ver `reportesQueVe`) ya no es así. La lectura abierta
 * se sostiene igual, por una razón más simple: **cuántas horas debería trabajar
 * un sector no es un dato sensible**, y la policy de la tabla es `using (true)`.
 *
 * `POST` y `PATCH` sólo con **edición** de RRHH, no cualquier nivel:
 * `lectura` no cambia el divisor del titular. La policy de la tabla dice lo
 * mismo (`puede_editar_rrhh()`); acá se repite para contestar un 403 claro en
 * vez del error mudo de RLS.
 *
 * Todo va con el cliente de sesión y no con el admin: la tabla tiene sus
 * propias policies y es una lectura abierta, no hay nada que saltarse.
 *
 * Las reglas que la base no impone —que la vigencia de un sector no se pise
 * con otra— se validan acá, en castellano y todas juntas (ver `vigencias.ts`).
 * Cambiar el valor de un sector es **cerrar la fila vigente con un `hasta` y
 * abrir otra el día siguiente**, no pisarla: un mes ya reportado se calcula con
 * lo que regía en ese mes.
 *
 * Dos pedidos simultáneos para el mismo sector pueden pasar los dos el control
 * de superposición. Es un catálogo de una veintena de filas que edita una
 * persona; no se cerró con un bloqueo porque no hay quién lo dispare.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Una fila de la base, con las fechas sin hora y las horas como número. */
function filaLimpia(f: {
  id: string;
  sector_id: string;
  horas_por_empleado: number | string;
  desde: string;
  hasta: string | null;
  created_at: string;
}) {
  return {
    id: f.id,
    sector_id: f.sector_id,
    horas_por_empleado: Number(f.horas_por_empleado),
    desde: String(f.desde).slice(0, 10),
    hasta: f.hasta === null ? null : String(f.hasta).slice(0, 10),
    created_at: f.created_at,
  };
}

/** Si la vigencia pisa a otra del mismo sector, dice con cuál; `mensaje: null` si no. */
async function choque(
  supabase: SupabaseClient,
  sectorId: string,
  vigencia: { desde: string; hasta: string | null },
  salvo?: string,
): Promise<{ respuesta: NextResponse } | { mensaje: string | null }> {
  const { data, error } = await supabase
    .from("rrhh_horas_a_realizar")
    .select("id, desde, hasta")
    .eq("sector_id", sectorId);
  if (error) return { respuesta: NextResponse.json({ error: error.message }, { status: 500 }) };

  const otras = (data ?? [])
    .filter((o) => o.id !== salvo)
    .map((o) => ({
      desde: String(o.desde).slice(0, 10),
      hasta: o.hasta === null ? null : String(o.hasta).slice(0, 10),
    }));
  const pisada = primeraQueSeSuperpone(otras, vigencia);
  if (!pisada) return { mensaje: null };
  const hasta = pisada.hasta === null ? "sin fecha de fin" : `hasta el ${comoSeLee(pisada.hasta)}`;
  return {
    mensaje:
      `Esa vigencia se superpone con otra del mismo sector, que rige desde el ${comoSeLee(pisada.desde)}, ${hasta}. ` +
      "Para cambiar el valor hay que cerrar la anterior con una fecha hasta y abrir la nueva el día siguiente.",
  };
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data, error } = await supabase
    .from("rrhh_horas_a_realizar")
    .select("id, sector_id, horas_por_empleado, desde, hasta, created_at, sectores(nombre)")
    .order("desde", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    data: (data ?? []).map((f) => {
      const s = Array.isArray(f.sectores) ? f.sectores[0] : f.sectores;
      return { ...filaLimpia(f), sector: s?.nombre ?? null };
    }),
  });
}

/** POST — abrir una vigencia. `{ sector_id, horas_por_empleado, desde, hasta? }`. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const sinPermiso = await puede_editar_check(supabase);
  if (sinPermiso) return sinPermiso;

  const b = await cuerpoJson(request);
  const hasta = b.hasta == null || b.hasta === "" ? null : b.hasta;
  const problemas = problemasDeLaVigencia({ horas: b.horas_por_empleado, desde: b.desde, hasta });
  if (typeof b.sector_id !== "string" || !UUID.test(b.sector_id)) {
    problemas.unshift("Falta elegir el sector.");
  }
  if (problemas.length) return errorDeValidacion(problemas);

  const sectorId = b.sector_id as string;
  const vigencia = { desde: b.desde as string, hasta: hasta as string | null };

  const c = await choque(supabase, sectorId, vigencia);
  if ("respuesta" in c) return c.respuesta;
  if (c.mensaje) return errorDeValidacion([c.mensaje]);

  const { data, error } = await supabase
    .from("rrhh_horas_a_realizar")
    .insert({ sector_id: sectorId, horas_por_empleado: horasValidas(b.horas_por_empleado), ...vigencia })
    .select("id, sector_id, horas_por_empleado, desde, hasta, created_at")
    .single();
  if (error) {
    // 23503: el sector no existe. Cualquier otro error es del servidor, no de
    // lo que se mandó.
    const noExiste = error.code === "23503";
    return NextResponse.json(
      { error: noExiste ? "Ese sector no existe en el sistema." : error.message },
      { status: noExiste ? 400 : 500 },
    );
  }
  return NextResponse.json({ data: filaLimpia(data) }, { status: 201 });
}

/**
 * PATCH — corregir una vigencia, o cerrarla con un `hasta`. Lleva `id` en el
 * cuerpo y cualquiera de `horas_por_empleado`, `desde`, `hasta`. El sector no
 * se cambia: mover una fila a otro sector es borrar una y abrir la otra.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const sinPermiso = await puede_editar_check(supabase);
  if (sinPermiso) return sinPermiso;

  const b = await cuerpoJson(request);
  const id = String(b.id ?? "");
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Falta indicar qué vigencia se modifica." }, { status: 400 });
  }

  const quiereHoras = "horas_por_empleado" in b;
  const quiereDesde = "desde" in b;
  const quiereHasta = "hasta" in b;
  if (!quiereHoras && !quiereDesde && !quiereHasta) {
    return NextResponse.json(
      { error: "No hay nada para cambiar: mandá horas_por_empleado, desde o hasta." },
      { status: 400 },
    );
  }

  const { data: actual, error: errActual } = await supabase
    .from("rrhh_horas_a_realizar")
    .select("id, sector_id, horas_por_empleado, desde, hasta, created_at")
    .eq("id", id)
    .maybeSingle();
  if (errActual) return NextResponse.json({ error: errActual.message }, { status: 500 });
  if (!actual) return NextResponse.json({ error: "Esa vigencia no existe." }, { status: 404 });

  // La fila como quedaría: las reglas se miran sobre el resultado, no sobre el pedido.
  const antes = filaLimpia(actual);
  const resultado = {
    horas: quiereHoras ? b.horas_por_empleado : antes.horas_por_empleado,
    desde: quiereDesde ? b.desde : antes.desde,
    hasta: quiereHasta ? (b.hasta == null || b.hasta === "" ? null : b.hasta) : antes.hasta,
  };

  const problemas = problemasDeLaVigencia(resultado);
  if (problemas.length) return errorDeValidacion(problemas);

  const vigencia = { desde: resultado.desde as string, hasta: resultado.hasta as string | null };
  const c = await choque(supabase, antes.sector_id, vigencia, id);
  if ("respuesta" in c) return c.respuesta;
  if (c.mensaje) return errorDeValidacion([c.mensaje]);

  const { data, error } = await supabase
    .from("rrhh_horas_a_realizar")
    .update({ horas_por_empleado: horasValidas(resultado.horas), ...vigencia })
    .eq("id", id)
    .select("id, sector_id, horas_por_empleado, desde, hasta, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: filaLimpia(data) });
}
