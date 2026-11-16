import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import { CERRADAS } from "./alertas";
import {
  repartir, type RiPegado, type OrdenQuePide, type ParteDeLaOrden,
} from "./loQueViene";

/**
 * Arma lo que `repartir` recibe, para un renglón de repuesto, y la llama.
 *
 * `repartir` reparte lo que le dan; **las dos reglas que ella no puede proteger
 * están acá**, y son las que hacen que el número sea honesto:
 *
 *  - **Sólo los RI pegados a mano** (`mant_ri_de_repuesto`). Nunca los que el cruce
 *    por nombre de `riDelRepuesto.ts` adivina: un falso positivo ahí haría leer
 *    «cubierta» a una orden por algo que no es suyo.
 *  - **Sólo órdenes abiertas**: las que no están en `CERRADAS` de `alertas.ts`
 *    (`REALIZADO` y `SUSPENDIDA`), la misma definición que usa el resto de
 *    Mantenimiento y no una tercera. Una orden ya hecha, o suspendida, no reclama
 *    piezas. Hoy no hay ninguna `SUSPENDIDA`, así que no cambia ningún número.
 *
 * Quiénes compiten: si el renglón tiene artículo, **todas las órdenes abiertas que
 * piden ese mismo artículo** y los RI pegados al artículo o a cualquiera de esos
 * renglones; si no tiene, sólo él mismo y sus RI propios.
 *
 * **Un mismo RI pegado al artículo y a un renglón de ese artículo es legal** —son
 * dos filas, cada una en su índice único— y se cuenta **una sola vez**: dos filas
 * que dicen lo mismo no son dos entregas. Pegarlo en los dos lados es redundante,
 * no una orden doble.
 *
 * Todo lo que puede crecer se lee de a lotes de 200 ids (un `.in()` más largo arma
 * una URL que PostgREST rechaza) o paginado con `traerTodo`.
 */

const LOTE = 200;

type Cliente = SupabaseClient;

export interface CuentaDeUnRepuesto {
  /** Los RI pegados que cuentan, sin repetir, con lo que Compras dice de cada uno. */
  ris: RiPegado[];
  /** Cómo quedó el reparto, la orden más vieja primero. */
  partes: ParteDeLaOrden[];
  /** La parte de la orden de este renglón; null si esa orden ya está realizada. */
  estaOrden: ParteDeLaOrden | null;
}

/** «10», «2,5» → número. Lo que no se lee como número positivo no es una cantidad. */
export function cantidadDelRenglon(texto: string | null | undefined): number | null {
  const n = Number(String(texto ?? "").trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * El número de RI que viene en un pedido, o lo que hay que decirle a quien lo mandó.
 *
 * No pasa por `validar()` a propósito: `problemaEnCastellano` descarta el mensaje
 * de zod y arma el suyo, y para un entero dice «tiene que ser int» y para el 0
 * «tiene que ser 0 o más», que es falso porque el 0 se rechaza. Acá cada caso
 * dice lo que es verdad. **Falta** y **está mal** son casos distintos: un
 * `?nro_ri` ausente no es un 0.
 */
export function leerNroRi(valor: unknown): { ok: true; nro_ri: number } | { ok: false; error: string } {
  if (valor === undefined || valor === null || (typeof valor === "string" && valor.trim() === "")) {
    return { ok: false, error: "Falta el número de RI" };
  }
  // Un texto se acepta sólo si es una tira de dígitos: `Number("0x10")` es 16 y
  // `Number("1e3")` es 1000, y un `?nro_ri` mal escrito terminaría sacando el
  // vínculo de OTRO RI con un 200. Y nada que Postgres no guarde en un `integer`.
  const n =
    typeof valor === "number" ? valor
    : typeof valor === "string" && /^\d+$/.test(valor.trim()) ? Number(valor.trim())
    : NaN;
  if (!Number.isInteger(n) || n <= 0 || n > 2147483647) {
    return { ok: false, error: "El número de RI tiene que ser un entero mayor que cero" };
  }
  return { ok: true, nro_ri: n };
}

async function enLotes<T>(
  ids: readonly (string | number)[],
  leer: (lote: (string | number)[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const todo: T[] = [];
  for (let i = 0; i < ids.length; i += LOTE) {
    const { data, error } = await leer(ids.slice(i, i + LOTE) as (string | number)[]);
    if (error) throw new Error(error.message);
    todo.push(...(data ?? []));
  }
  return todo;
}

export async function cuentaDeUnRepuesto(
  admin: Cliente,
  renglon: { id: string; work_order_id: string; articulo_id: string | null }
): Promise<CuentaDeUnRepuesto> {
  // Los renglones que compiten por lo mismo.
  const renglones = renglon.articulo_id
    ? await traerTodo((d, h) =>
        admin
          .from("ordenes_trabajo_repuestos")
          .select("id, work_order_id, cantidad")
          .eq("articulo_id", renglon.articulo_id!)
          .range(d, h)
      )
    : await traerTodo((d, h) =>
        admin
          .from("ordenes_trabajo_repuestos")
          .select("id, work_order_id, cantidad")
          .eq("id", renglon.id)
          .range(d, h)
      );

  // Sólo órdenes abiertas.
  const ordenesIds = [...new Set(renglones.map((r) => r.work_order_id as string))];
  const ordenes = (
    await enLotes(ordenesIds, (lote) =>
      admin.from("ordenes_trabajo").select("id, ot_number, fecha, estado").in("id", lote as string[])
    )
  ).filter((o) => !CERRADAS.includes(String(o.estado ?? "")));
  const abiertas = new Set(ordenes.map((o) => o.id as string));

  // Lo que pide cada orden: la suma de sus renglones de este artículo.
  const pide = new Map<string, number | null>();
  for (const r of renglones) {
    const orden = r.work_order_id as string;
    if (!abiertas.has(orden)) continue;
    const c = cantidadDelRenglon(r.cantidad as string | null);
    const antes = pide.get(orden) ?? null;
    pide.set(orden, c == null ? antes : (antes ?? 0) + c);
  }
  const quePiden: OrdenQuePide[] = ordenes.map((o) => ({
    orden_id: o.id as string,
    ot_number: (o.ot_number as number | null) ?? null,
    fecha: (o.fecha as string | null) ?? null,
    pide: pide.get(o.id as string) ?? null,
  }));

  // Los RI pegados a mano: al artículo o a cualquiera de esos renglones.
  const pegados: { nro_ri: number }[] = [];
  if (renglon.articulo_id) {
    pegados.push(
      ...(await traerTodo((d, h) =>
        admin.from("mant_ri_de_repuesto").select("nro_ri").eq("articulo_id", renglon.articulo_id!).range(d, h)
      ))
    );
  }
  pegados.push(
    ...(await enLotes(
      renglones.map((r) => r.id as string),
      (lote) => admin.from("mant_ri_de_repuesto").select("nro_ri").in("repuesto_id", lote as string[])
    ))
  );
  const numeros = [...new Set(pegados.map((p) => p.nro_ri))];

  // Lo que Compras dice de cada uno. Un RI que la planilla ya no tiene no trae nada.
  const ris = (await enLotes(numeros, (lote) =>
    admin
      .from("compras_requerimientos")
      .select("nro_ri, cantidad, cantidad_recibida, estado_compra, estado_aprobacion")
      .in("nro_ri", lote as number[])
  )) as RiPegado[];

  const partes = repartir(ris, quePiden);
  return {
    ris,
    partes,
    estaOrden: partes.find((p) => p.orden_id === renglon.work_order_id) ?? null,
  };
}
