import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { traerTodo } from "@/lib/core/paginado";

/**
 * En qué quedó el trabajo que salió de un aviso. Abierta a cualquiera que
 * entre al sistema.
 *
 * `GET` → `{ ordenes: { id, ot_number, estado, fecha_cierre }[] }`, una entrada
 * por cada OT enlazada a algún aviso (221 el 17/11/2026, de 238 avisos y 2.489
 * OT).
 *
 * **Por qué existe en vez de un embebido.** `ordenes_trabajo` tiene el SELECT
 * cerrado con `mant_puede_ver()` desde la migración `20260916110349`, y
 * `/mis-avisos` la abren los catorce usuarios: a 6 de 14 el embebido les
 * devolvería null **en silencio** y la pantalla diría «sin orden» sobre un
 * trabajo que existe. Es el mismo patrón que Disponibilidad con `ausencias`:
 * se lee con el cliente admin, RLS no corre y **el permiso es el de la ruta**.
 *
 * **Por qué alcanza con «estar logueado».** `avisos` tiene el SELECT abierto a
 * cualquier autenticado desde `20261022101507`, y esta ruta devuelve menos de
 * lo que un aviso ya dice: sólo `ot_number`, `estado` y `fecha_cierre`. La
 * descripción, el equipo y el costo de la orden siguen dentro del módulo, y la
 * proyección está escrita campo por campo en el `select`.
 *
 * **Por qué devuelve todas y no las de la página.** La pantalla pagina de a 50
 * del lado del servidor, así que para filtrar «sólo los abiertos» necesita
 * saber cuáles lo están antes de pedir la página. Son del orden de 221 filas de
 * cuatro campos.
 *
 * **Un fallo de lectura es 503 y no 500**: la pantalla lo reintenta y acá un
 * error es transitorio, igual que en el alta de avisos (`../route.ts`).
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const db = createAdminClient();

    // PostgREST corta en 1000 filas sin avisar; `order` para que las tandas no
    // se solapen ni se salteen filas.
    const avisos = await traerTodo((desde, hasta) =>
      db.from("avisos")
        .select("work_order_id")
        .not("work_order_id", "is", null)
        .order("id")
        .range(desde, hasta)
    );
    const ids = [...new Set(avisos.map((a) => a.work_order_id).filter((x): x is string => !!x))];

    // Un `.in()` largo arma una URL que PostgREST rechaza con un 400 mudo.
    const ordenes: { id: string; ot_number: number; estado: string | null; fecha_cierre: string | null }[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await db
        .from("ordenes_trabajo")
        .select("id, ot_number, estado, fecha_cierre")
        .in("id", ids.slice(i, i + 200));
      if (error) throw new Error(error.message);
      ordenes.push(...(data ?? []));
    }

    return NextResponse.json({ ordenes });
  } catch (e) {
    return NextResponse.json(
      { error: `No se pudo leer el estado de los trabajos: ${(e as Error).message}` },
      { status: 503 }
    );
  }
}
