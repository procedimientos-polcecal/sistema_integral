import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarLeer } from "@/lib/odoo/client";
import { hoyEnArgentina, sumarDias } from "@/lib/core/fechas";
import { movimientoDesdeLaLineaDeOdoo, type Catalogos, type LineaDeOdoo } from "./reconocer";
import { traerCarbonilleros, traerProductosDeOdoo } from "./consultas";

/**
 * Traer de Odoo las entradas de carbonilla que todavía no están en el libro.
 *
 * LA VENTANA VA SOBRE `create_date`, NO SOBRE `date_order`, y es la decisión que
 * importa de este archivo. Se midió: 1.053 de 1.055 órdenes del año se cargan el
 * mismo día, pero el máximo son 3 días — y al 16/09/2026 hay once días sin
 * cargar. Una orden fechada el 05/09 y cargada el 20/09 **la ventana de
 * `date_order` no la ve nunca**: se la pasa por atrás mientras el cron avanza.
 * Con `create_date` eso no puede pasar.
 *
 * El margen es fijo contra hoy y no contra la última corrida: una corrida que se
 * saltó no abre un hueco.
 *
 * NUNCA PISA. Si una orden que ya entró cambia de cantidad en Odoo, el
 * movimiento no se reescribe: va a la bandeja y una persona decide. Un saldo que
 * se mueve solo hacia atrás no se nota hasta el conteo.
 *
 * Spec: docs/superpowers/specs/2026-09-16-calidad-stock-de-carbonilla-design.md
 */

const DIAS_DE_MARGEN = 30;

/**
 * El cron nunca mira antes de esto: es lo único que evita que el histórico
 * importado se duplique cuando la sincronización pase por las mismas órdenes.
 * Se pone el día en que corrió `scripts/importar-stock-carbonilla.mts`.
 */
export const CALIDAD_DESDE = process.env.CALIDAD_DESDE ?? "2026-09-16";

/**
 * De a cuántos ids se consulta Supabase.
 *
 * Un `.in()` con muchos ids arma una URL que PostgREST rechaza con un 400 sin
 * decir por qué. Doscientos es el número que usa el resto del repo.
 */
const LOTE = 200;

export interface ResumenDeSincronizacion {
  leidas: number;
  nuevas: number;
  yaEstaban: number;
  descartadas: number;
  aLaBandeja: number;
  cambiadasEnOdoo: number;
}

interface LineaCruda {
  id: number;
  order_id: [number, string];
  product_id: [number, string];
  partner_id: [number, string];
  product_qty: number;
}

interface YaGuardado {
  odoo_purchase_line_id: number;
  odoo_purchase_name: string | null;
  toneladas: number;
}

/** Las líneas del libro que ya tienen alguno de estos ids de Odoo, por lotes. */
async function traerLoQueYaEsta(
  supabase: SupabaseClient,
  ids: number[]
): Promise<Map<number, YaGuardado>> {
  const encontradas = new Map<number, YaGuardado>();

  for (let i = 0; i < ids.length; i += LOTE) {
    const { data, error } = await supabase
      .from("calidad_movimientos")
      .select("odoo_purchase_line_id, odoo_purchase_name, toneladas")
      .in("odoo_purchase_line_id", ids.slice(i, i + LOTE));
    if (error) throw new Error(error.message);

    for (const m of (data ?? []) as YaGuardado[]) {
      encontradas.set(m.odoo_purchase_line_id, m);
    }
  }

  return encontradas;
}

export async function sincronizarCarbonillaConOdoo(
  supabase: SupabaseClient
): Promise<ResumenDeSincronizacion> {
  const vacio: ResumenDeSincronizacion = {
    leidas: 0, nuevas: 0, yaEstaban: 0, descartadas: 0, aLaBandeja: 0, cambiadasEnOdoo: 0,
  };

  const [carbonilleros, productos] = await Promise.all([
    traerCarbonilleros(supabase),
    traerProductosDeOdoo(supabase),
  ]);

  // Sin carbonilleros declarados no hay a quién buscarle órdenes. No es un
  // error: es el catálogo vacío, y la pantalla de carbonilleros lo dice.
  const activos = carbonilleros.filter((c) => c.activo);
  if (activos.length === 0) return vacio;

  const catalogos: Catalogos = {
    carbonilleros: new Map(
      activos.map((c) => [
        c.odoo_partner_id,
        { id: c.id, carbon: c.carbon, proveedorId: c.proveedor_id },
      ])
    ),
    productos: new Map(productos.map((p) => [p.odoo_product_id, p.cuenta])),
  };

  const desde = sumarDias(hoyEnArgentina(), -DIAS_DE_MARGEN);

  const crudas = await buscarLeer<LineaCruda>(
    "purchase.order.line",
    [
      ["order_id.state", "=", "purchase"],
      ["order_id.partner_id", "in", activos.map((c) => c.odoo_partner_id)],
      ["create_date", ">=", `${desde} 00:00:00`],
    ],
    ["id", "order_id", "product_id", "partner_id", "product_qty"],
    { limite: 2000 }
  );
  if (crudas.length === 0) return vacio;

  // La fecha del movimiento es la del papel (`date_order`), no la de carga. La
  // de carga sólo decide qué se mira, arriba.
  const ordenIds = [...new Set(crudas.map((l) => l.order_id[0]))];
  const ordenes = await buscarLeer<{ id: number; date_order: string }>(
    "purchase.order",
    [["id", "in", ordenIds]],
    ["id", "date_order"],
    { limite: 2000 }
  );
  const fechaDeOrden = new Map(ordenes.map((o) => [o.id, String(o.date_order).slice(0, 10)]));

  const lineas: LineaDeOdoo[] = crudas.map((l) => ({
    id: l.id,
    ordenNombre: l.order_id[1],
    fecha: fechaDeOrden.get(l.order_id[0]) ?? "",
    partnerId: l.partner_id[0],
    partnerNombre: l.partner_id[1],
    productoId: l.product_id[0],
    productoNombre: l.product_id[1],
    cantidad: l.product_qty,
  }));

  // La fecha de corte: el histórico importado no se vuelve a traer. Una línea
  // sin fecha de orden tampoco entra — no hay dónde ponerla en el libro.
  const delLadoNuevo = lineas.filter((l) => l.fecha && l.fecha >= CALIDAD_DESDE);
  if (delLadoNuevo.length === 0) return { ...vacio, leidas: lineas.length };

  const guardadas = await traerLoQueYaEsta(supabase, delLadoNuevo.map((l) => l.id));

  const resumen: ResumenDeSincronizacion = { ...vacio, leidas: lineas.length };

  for (const linea of delLadoNuevo) {
    const guardada = guardadas.get(linea.id);

    if (guardada) {
      resumen.yaEstaban++;
      // El movimiento guarda el signo; la cantidad de Odoo es siempre positiva.
      const guardado = Math.abs(Number(guardada.toneladas));
      if (Math.abs(guardado - linea.cantidad) > 0.0005) {
        resumen.cambiadasEnOdoo++;
        await aLaBandeja(
          supabase,
          linea,
          `La ${linea.ordenNombre} pasó de ${guardado} a ${linea.cantidad} toneladas después de haber entrado al stock. El movimiento NO se cambió: decidilo vos.`
        );
      }
      continue;
    }

    const r = movimientoDesdeLaLineaDeOdoo(linea, catalogos);

    if (r.resultado === "descartado") {
      resumen.descartadas++;
      continue;
    }

    if (r.resultado === "a_la_bandeja") {
      resumen.aLaBandeja++;
      await aLaBandeja(supabase, linea, r.motivo);
      continue;
    }

    // `ignoreDuplicates` y no un update: si la recepción de Despacho ya guardó
    // esta misma línea con su propio origen, la sincronización no la toca. Ése
    // es todo el mecanismo anti-duplicado.
    const { error } = await supabase
      .from("calidad_movimientos")
      .upsert(r.movimiento, { onConflict: "odoo_purchase_line_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);

    resumen.nuevas++;
    await supabase
      .from("calidad_odoo_sin_reconocer")
      .delete()
      .eq("odoo_purchase_line_id", linea.id);
  }

  return resumen;
}

/** Dejar la línea a la vista, con el motivo escrito y sin tocar el stock. */
async function aLaBandeja(
  supabase: SupabaseClient,
  linea: LineaDeOdoo,
  motivo: string
): Promise<void> {
  const { error } = await supabase.from("calidad_odoo_sin_reconocer").upsert({
    odoo_purchase_line_id: linea.id,
    odoo_purchase_name: linea.ordenNombre,
    odoo_partner_id: linea.partnerId,
    odoo_partner_nombre: linea.partnerNombre,
    odoo_product_id: linea.productoId,
    odoo_product_nombre: linea.productoNombre,
    fecha: linea.fecha,
    toneladas: linea.cantidad,
    motivo,
  });
  if (error) throw new Error(error.message);
}
