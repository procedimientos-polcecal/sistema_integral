import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarLeer } from "@/lib/odoo/client";
import { CALIDAD_DESDE } from "./sincronizar";

/**
 * El camión que Despacho acaba de pesar, anotado en el stock de Calidad.
 *
 * **ÉSTE ES TODO EL MECANISMO ANTI-DUPLICADO** entre los dos caminos por los que
 * una entrada llega al libro. La recepción guarda el movimiento con el
 * `odoo_purchase_line_id` de la línea que ella misma acaba de crear; cuando el
 * cron pase por esa misma línea, el índice único la frena. No hay cruce por
 * fecha, proveedor y cantidad — que es justo el cruce que en la planilla vieja
 * se corrió un camión tres días seguidos en noviembre de 2025.
 *
 * Vive en `lib/calidad/` y no en `lib/despacho/` a propósito: Despacho no tiene
 * por qué conocer la forma de las tablas de Calidad. Lo llama y sigue.
 *
 * **Nunca lanza y nunca bloquea el cierre de la recepción.** Hay un camión
 * afuera esperando el papel; el stock puede esperar a la próxima corrida del
 * cron. Devuelve el aviso para que quien cerró se entere.
 *
 * Spec: docs/superpowers/specs/2026-09-16-calidad-stock-de-carbonilla-design.md
 */

export interface RecepcionParaElStock {
  recepcionId: string;
  /** El proveedor del núcleo, como lo guarda la recepción. */
  proveedorId: string;
  odooPurchaseOrderId: number;
  odooPurchaseName: string | null;
  /** `YYYY-MM-DD`, la del papel. */
  fecha: string;
  /** El neto pesado, en toneladas y positivo. */
  toneladas: number;
  cargadoPor: string | null;
}

export async function anotarLaRecepcionEnElStock(
  admin: SupabaseClient,
  d: RecepcionParaElStock
): Promise<{ aviso: string | null }> {
  try {
    // Antes del corte manda la importación: si alguien cierra una recepción con
    // fecha vieja, el libro ya la tiene desde la planilla.
    if (d.fecha < CALIDAD_DESDE) return { aviso: null };

    // Quién es este proveedor para Calidad. Primero por el enganche con el
    // núcleo; si no está —y son nueve de trece— por el partner de Odoo, que es
    // la identidad de verdad del carbonillero.
    const { data: porNucleo } = await admin
      .from("calidad_carbonilleros")
      .select("id, carbon, activo")
      .eq("proveedor_id", d.proveedorId)
      .eq("activo", true)
      .maybeSingle<{ id: string; carbon: string; activo: boolean }>();

    let carbonillero = porNucleo;

    if (!carbonillero) {
      const { data: vinculos } = await admin
        .from("proveedores_odoo")
        .select("odoo_partner_id")
        .eq("proveedor_id", d.proveedorId);

      const partners = (vinculos ?? []).map((v) => v.odoo_partner_id as number);
      if (partners.length) {
        const { data: porPartner } = await admin
          .from("calidad_carbonilleros")
          .select("id, carbon, activo")
          .in("odoo_partner_id", partners)
          .eq("activo", true)
          .maybeSingle<{ id: string; carbon: string; activo: boolean }>();
        carbonillero = porPartner;
      }
    }

    // NO SE INVENTA. Sin carbonillero declarado no se sabe el tipo de carbón, y
    // el tipo es lo único que no se puede deducir de ningún lado. La recepción
    // se cierra igual y la línea queda para que el cron la levante —o la ponga
    // en la bandeja con el nombre del proveedor, que es desde donde se declara—.
    if (!carbonillero) {
      return {
        aviso:
          "La recepción se cerró, pero este proveedor no está declarado como carbonillero, " +
          "así que el camión todavía no entró al stock de Calidad.",
      };
    }

    // El id de LA LÍNEA, que es la clave: 7 de 577 órdenes del año tienen dos.
    // Se pide la del producto que la orden lleva, que es una sola.
    const lineas = await buscarLeer<{ id: number }>(
      "purchase.order.line",
      [["order_id", "=", d.odooPurchaseOrderId]],
      ["id"],
      { limite: 5, orden: "id asc" }
    );
    if (lineas.length !== 1) {
      return {
        aviso:
          `La recepción se cerró, pero la orden ${d.odooPurchaseName ?? d.odooPurchaseOrderId} ` +
          `tiene ${lineas.length} líneas en Odoo y no una, así que el camión no entró al stock. ` +
          "Lo va a levantar la sincronización.",
      };
    }

    const { error } = await admin.from("calidad_movimientos").upsert(
      {
        fecha: d.fecha,
        tipo: "entrada",
        carbon: carbonillero.carbon,
        toneladas: d.toneladas,
        carbonillero_id: carbonillero.id,
        origen: "recepcion",
        odoo_purchase_line_id: lineas[0].id,
        odoo_purchase_name: d.odooPurchaseName,
        despacho_recepcion_id: d.recepcionId,
        cargado_por: d.cargadoPor,
      },
      { onConflict: "odoo_purchase_line_id", ignoreDuplicates: true }
    );
    if (error) {
      return { aviso: `La recepción se cerró, pero el stock de Calidad no se movió: ${error.message}` };
    }

    return { aviso: null };
  } catch (e) {
    // Que Odoo no conteste al leer la línea no puede voltear una recepción que
    // ya está cerrada y con su orden creada.
    return {
      aviso:
        "La recepción se cerró, pero no se pudo anotar en el stock de Calidad: " +
        (e instanceof Error ? e.message : String(e)),
    };
  }
}
