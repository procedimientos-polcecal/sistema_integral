import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esAdminCompras, tieneAccesoCompras } from "@/lib/compras/auth";
import { traerTodo } from "@/lib/core/paginado";
import { avisoDeCredencialesFaltantes, hayCredencialesOdoo } from "@/lib/odoo/client";
import { empujarOrdenesDeRequerimiento } from "@/lib/odoo/pushOrden";
import {
  losPendientesDeOdoo,
  POR_TANDA,
  resumirPendientes,
  type PendienteDeOdoo,
} from "@/lib/compras/pendientesDeOdoo";

/**
 * Los pedidos que quedaron sin su orden en Odoo, y el botón para mandarlos.
 *
 * - `GET`  → qué hay pendiente y cuánto es. **No escribe nada.**
 * - `POST` → manda **una tanda** y devuelve cuántas quedan.
 *
 * ## Por qué de a tandas y no todo junto
 *
 * Son 119 requerimientos y **177 órdenes** —58 los pagan las dos empresas—, a
 * varios segundos cada una contra Odoo Online. En una sola llamada eso no entra
 * en ningún límite de función. La pantalla pide tanda tras tanda y muestra el
 * avance; se puede parar en el medio y lo hecho queda hecho, porque
 * `empujarOrdenesDeRequerimiento` vincula cada orden apenas la crea.
 *
 * ## Por qué admin y no quien edita Compras
 *
 * El botón de una ficha crea una orden. Éste crea ciento setenta y siete en la
 * contabilidad real del grupo, por $103 millones. Es el mismo criterio con el
 * que confirmar una factura en Odoo quedó para admins.
 */

export const maxDuration = 60;

async function pendientes(desde: string | null) {
  const admin = createAdminClient();

  const ris = await traerTodo<PendienteDeOdoo>((inicio, fin) =>
    admin
      .from("compras_requerimientos")
      .select(
        "id, nro_ri, fecha, descripcion, estado_compra, proveedor_id, costo_iva, empresa_id, paga_ambas"
      )
      .eq("estado_compra", "PEDIDO")
      .range(inicio, fin)
  );

  const conOrden = await traerTodo<{ requerimiento_id: string }>((inicio, fin) =>
    admin.from("compras_odoo_ordenes").select("requerimiento_id").range(inicio, fin)
  );

  return losPendientesDeOdoo(ris, new Set(conOrden.map((o) => o.requerimiento_id)), desde);
}

/** El corte sólo se acepta como fecha; cualquier otra cosa se ignora. */
const corteDe = (v: string | null): string | null =>
  v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await tieneAccesoCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenés acceso a Compras" }, { status: 403 });
  }

  const desde = corteDe(new URL(request.url).searchParams.get("desde"));
  const lista = await pendientes(desde);

  return NextResponse.json({
    resumen: resumirPendientes(lista),
    /*
     * Una muestra y no la lista entera: son 119 y la pantalla muestra los
     * primeros para que se vea *qué* se va a mandar, no para listarlos todos.
     * El resumen es el número que importa.
     */
    muestra: lista.slice(0, 10).map((r) => ({
      nro_ri: r.nro_ri,
      fecha: r.fecha,
      descripcion: r.descripcion,
      costo_iva: r.costo_iva,
      paga_ambas: r.paga_ambas,
    })),
    porTanda: POR_TANDA,
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await esAdminCompras(supabase, user.id))) {
    return NextResponse.json(
      { error: "Mandar la cola entera a Odoo es de admin de Compras." },
      { status: 403 }
    );
  }

  if (!hayCredencialesOdoo()) {
    return NextResponse.json({ error: avisoDeCredencialesFaltantes() }, { status: 503 });
  }

  const cuerpo = await request.json().catch(() => ({}));
  const desde = corteDe(typeof cuerpo.desde === "string" ? cuerpo.desde : null);

  /*
   * La cola se recalcula en **cada** tanda, no se pagina sobre una lista vieja.
   * Los que se acaban de crear ya tienen vínculo y salen solos, así que la
   * siguiente tanda son siempre los que faltan. Eso es lo que hace que apretar
   * dos veces no duplique nada.
   */
  const cola = await pendientes(desde);
  const tanda = cola.slice(0, POR_TANDA);

  const admin = createAdminClient();
  const creadas: { nro_ri: number; ordenes: string[] }[] = [];
  const fallaron: { nro_ri: number; motivo: string }[] = [];

  for (const r of tanda) {
    try {
      const resultado = await empujarOrdenesDeRequerimiento(admin, r.id);
      if (resultado.ok) {
        creadas.push({
          nro_ri: r.nro_ri,
          ordenes: resultado.ordenes.map((o) => o.odooNombre ?? `#${o.odooOrderId}`),
        });
      } else {
        /*
         * Un fallo no corta la tanda ni la cola: el motivo ya quedó en
         * `odoo_pendiente` del requerimiento —lo escribe el propio push— con su
         * botón de reintentar en la ficha. Cortar acá dejaría al resto sin
         * intentar por un problema de uno solo.
         */
        fallaron.push({ nro_ri: r.nro_ri, motivo: resultado.motivos.join(" | ") });
      }
    } catch (e) {
      fallaron.push({ nro_ri: r.nro_ri, motivo: e instanceof Error ? e.message : String(e) });
    }
  }

  /*
   * Cuántas quedan de verdad: **los que fallaron siguen en la cola**, porque no
   * tienen vínculo y la próxima tanda los va a volver a tomar.
   *
   * Y por eso va también `avanzo`. Una tanda que falla entera devolvería la
   * misma cola para siempre, y una pantalla que sólo mirara `quedan` pediría
   * tandas sin fin sobre los mismos cinco. El corte es "esta tanda no creó
   * nada", no "la cola llegó a cero".
   */
  const quedan = Math.max(0, cola.length - creadas.length);

  return NextResponse.json({
    creadas,
    fallaron,
    quedan,
    avanzo: creadas.length > 0,
    procesados: tanda.length,
  });
}
