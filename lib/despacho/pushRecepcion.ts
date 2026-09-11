import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarLeer, camposDe, crearEn, llamar, mensajeDeOdoo } from "@/lib/odoo/client";
import { resolverContextoDeOdoo } from "@/lib/odoo/contexto";
import { netoDeLaRecepcion } from "./recepcion";
import { origenDeLaRecepcion, valoresDeLaOrdenDeRecepcion } from "./ordenDeCarbonilla";
import type { Recepcion } from "./types";

/**
 * Los tres pasos en Odoo de una recepción que se cierra: crear la orden de
 * compra, confirmarla y validar la recepción.
 *
 * Spec: docs/superpowers/specs/2026-09-11-despacho-recepcion-de-carbonilla-design.md
 *
 * Acá vive la orquestación y nada más: qué se le manda a Odoo está en
 * `ordenDeCarbonilla.ts`, que es puro y tiene tests.
 *
 * **CADA PASO SE GUARDA APENAS OCURRE.** Si la validación del picking falla
 * después de que la orden se creó, la fila queda con su `odoo_purchase_order_id`
 * y con el error anotado, y el reintento valida lo que falta **sin crear una
 * segunda orden**. Es la lección de `empujarOrdenesDeRequerimiento`: mandarle al
 * proveedor el mismo pedido dos veces es el error más caro de todos los
 * posibles.
 *
 * **Y lo que no se puede resolver, se resuelve antes de escribir nada.** El
 * partner, la empresa, el tipo de operación y la unidad se buscan primero: si
 * falta uno, la recepción no se cierra y no queda nada a medias en la
 * contabilidad de otros. Con el camión esperando, "no se pudo, cargalo a mano
 * como siempre" es mejor que media orden.
 */

/** La unidad en la que se compra la carbonilla. Se busca por nombre exacto. */
const NOMBRE_UNIDAD = "Toneladas";

export type ResultadoDelPush =
  | { ok: true; odooNombre: string; odooOrderId: number; recepcionValidada: boolean; aviso?: string }
  | { ok: false; motivo: string };

interface FilaParaPush extends Recepcion {
  proveedor: { nombre: string } | null;
}

export async function empujarRecepcion(
  admin: SupabaseClient,
  recepcionId: string
): Promise<ResultadoDelPush> {
  const { data: recepcion } = await admin
    .from("despacho_recepciones")
    .select(
      "id, fecha, empresa_id, proveedor_id, odoo_product_id, odoo_product_nombre, peso_bruto_kg, peso_tara_kg, lugar_descarga, notas, odoo_purchase_order_id, odoo_purchase_name, odoo_picking_id, odoo_error, odoo_error_en, sheets_fila, sheets_pendiente, sheets_pendiente_en, cargado_por, cargado_en, actualizado_por, actualizado_en, proveedor:proveedores(nombre)"
    )
    .eq("id", recepcionId)
    .maybeSingle();

  if (!recepcion) return { ok: false, motivo: "Esa recepción no existe." };
  const r = recepcion as unknown as FilaParaPush;

  // ── Lo que tiene que estar antes de tocar Odoo ──────────────
  const neto = netoDeLaRecepcion(r);
  if (neto.problema) return { ok: false, motivo: neto.problema };
  if (neto.toneladas === null) {
    return { ok: false, motivo: "Faltan el bruto o la tara: sin neto no hay orden." };
  }
  if (!r.odoo_product_id) {
    return {
      ok: false,
      motivo: `No está cargado qué producto de Odoo le corresponde a ${r.proveedor?.nombre ?? "este proveedor"}.`,
    };
  }
  if (!r.empresa_id) return { ok: false, motivo: "Falta la empresa de la recepción." };

  const { data: empresa } = await admin
    .from("empresas")
    .select("nombre, odoo_company_id")
    .eq("id", r.empresa_id)
    .maybeSingle();

  const companyId = (empresa as { odoo_company_id: number | null } | null)?.odoo_company_id ?? null;
  if (!companyId) {
    return { ok: false, motivo: `La empresa ${empresa?.nombre ?? ""} no está enlazada con Odoo.` };
  }

  const { data: vinculo } = await admin
    .from("proveedores_odoo")
    .select("odoo_partner_id")
    .eq("proveedor_id", r.proveedor_id)
    .eq("empresa_id", r.empresa_id)
    .maybeSingle();

  const partnerId = (vinculo as { odoo_partner_id: number } | null)?.odoo_partner_id ?? null;
  if (!partnerId) {
    return {
      ok: false,
      motivo:
        `${r.proveedor?.nombre ?? "El proveedor"} no está enlazado con Odoo en esa empresa. ` +
        "Se enlaza por CUIT desde Administración → proveedores.",
    };
  }

  let contextoOdoo;
  let uomId: number;
  try {
    const resuelto = await resolverContextoDeOdoo([companyId]);
    if (!resuelto.ok) return { ok: false, motivo: resuelto.problemas.join(" ") };
    contextoOdoo = resuelto.contexto;

    const unidades = await buscarLeer<{ id: number; name: string }>(
      "uom.uom",
      [["name", "=", NOMBRE_UNIDAD]],
      ["name"],
      { limite: 5 }
    );
    // Como todo lo que se busca por nombre en este repo: si no está o hay más de
    // una, se informa y no se crea nada. Un id elegido entre dos es el error que
    // no se nota — la orden sale con la unidad de otra categoría.
    if (unidades.length !== 1) {
      return {
        ok: false,
        motivo: `En Odoo hay ${unidades.length} unidades llamadas "${NOMBRE_UNIDAD}": hace falta exactamente una.`,
      };
    }
    uomId = unidades[0].id;
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : mensajeDeOdoo(e as never) };
  }

  const datosDeEmpresa = contextoOdoo.porEmpresa[companyId];
  if (!datosDeEmpresa) {
    return { ok: false, motivo: `No se resolvió el tipo de operación de la empresa en Odoo.` };
  }

  // ── 1. La orden ────────────────────────────────────────────
  let ordenId = r.odoo_purchase_order_id;
  let nombre = r.odoo_purchase_name;

  if (!ordenId) {
    const vals = valoresDeLaOrdenDeRecepcion({
      odooPartnerId: partnerId,
      odooCompanyId: companyId,
      pickingTypeId: datosDeEmpresa.pickingTypeId,
      productoId: r.odoo_product_id,
      uomId,
      impuestoId: datosDeEmpresa.impuestoId,
      monedaId: contextoOdoo.monedas.ARS ?? null,
      toneladas: neto.toneladas,
      fecha: r.fecha,
      descripcion: r.odoo_product_nombre ?? "CARBONILLA",
      origen: origenDeLaRecepcion({
        fecha: r.fecha,
        brutoKg: r.peso_bruto_kg as number,
        taraKg: r.peso_tara_kg as number,
      }),
    });

    try {
      ordenId = await crearEn("purchase.order", companyId, vals);
    } catch (e) {
      return await anotarElError(admin, recepcionId, e);
    }
    // Se guarda antes de seguir: si lo que viene falla, el reintento encuentra
    // esta orden y no crea otra.
    await admin
      .from("despacho_recepciones")
      .update({ odoo_purchase_order_id: ordenId, odoo_error: null, odoo_error_en: null })
      .eq("id", recepcionId);
  }

  // ── 2. Confirmarla: ahí recibe su P##### ───────────────────
  let pickingId = r.odoo_picking_id;
  try {
    const [antes] = await llamar<{ state: string; name: string | null; picking_ids: number[] }[]>(
      "purchase.order",
      "read",
      [[ordenId], ["state", "name", "picking_ids"]]
    );

    if (antes?.state === "draft") {
      await llamar("purchase.order", "button_confirm", [[ordenId]]);
    }

    const [despues] = await llamar<{ state: string; name: string | null; picking_ids: number[] }[]>(
      "purchase.order",
      "read",
      [[ordenId], ["state", "name", "picking_ids"]]
    );
    nombre = despues?.name ?? nombre;
    pickingId = despues?.picking_ids?.[0] ?? pickingId;

    await admin
      .from("despacho_recepciones")
      .update({
        odoo_purchase_name: nombre,
        odoo_picking_id: pickingId,
        odoo_error: null,
        odoo_error_en: null,
      })
      .eq("id", recepcionId);
  } catch (e) {
    await anotarElError(admin, recepcionId, e);
    return {
      ok: true,
      odooOrderId: ordenId!,
      odooNombre: nombre ?? "",
      recepcionValidada: false,
      aviso: "La orden se creó pero no se pudo confirmar. Queda para reintentar.",
    };
  }

  // ── 3. Validar la recepción ────────────────────────────────
  if (!pickingId) {
    return {
      ok: true,
      odooOrderId: ordenId!,
      odooNombre: nombre ?? "",
      recepcionValidada: false,
      aviso: "La orden quedó confirmada pero Odoo no devolvió una recepción para validar.",
    };
  }

  try {
    const validada = await validarRecepcion(pickingId);
    if (!validada.ok) {
      await anotarElError(admin, recepcionId, new Error(validada.motivo));
      return {
        ok: true,
        odooOrderId: ordenId!,
        odooNombre: nombre ?? "",
        recepcionValidada: false,
        aviso: validada.motivo,
      };
    }
  } catch (e) {
    await anotarElError(admin, recepcionId, e);
    return {
      ok: true,
      odooOrderId: ordenId!,
      odooNombre: nombre ?? "",
      recepcionValidada: false,
      aviso: "La orden quedó confirmada; la recepción no se pudo validar y queda para reintentar.",
    };
  }

  await admin
    .from("despacho_recepciones")
    .update({ odoo_error: null, odoo_error_en: null })
    .eq("id", recepcionId);

  return {
    ok: true,
    odooOrderId: ordenId!,
    odooNombre: nombre ?? "",
    recepcionValidada: true,
    ...(neto.aviso ? { aviso: neto.aviso } : {}),
  };
}

/**
 * Validar el picking que generó la confirmación.
 *
 * Odoo no valida un movimiento sin cantidad hecha: hay que ponerla y recién ahí
 * llamar a `button_validate`. **El nombre del campo cambió entre versiones**
 * —`quantity_done` hasta la 16, `quantity` desde la 17—, así que se pregunta el
 * esquema en vez de clavar uno: una instancia que se actualiza no puede hacer
 * fallar la recepción de un camión.
 */
async function validarRecepcion(pickingId: number): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const [picking] = await llamar<{ state: string; move_ids: number[] }[]>(
    "stock.picking",
    "read",
    [[pickingId], ["state", "move_ids"]]
  );
  if (!picking) return { ok: false, motivo: "Odoo no encontró la recepción a validar." };
  if (picking.state === "done") return { ok: true };
  if (picking.state === "cancel") {
    return { ok: false, motivo: "La recepción de esa orden está cancelada en Odoo." };
  }

  const campos = await camposDe("stock.move");
  const campoCantidad = "quantity" in campos ? "quantity" : "quantity_done";

  const movimientos = await llamar<{ id: number; product_uom_qty: number }[]>(
    "stock.move",
    "read",
    [picking.move_ids, ["product_uom_qty"]]
  );

  for (const m of movimientos) {
    const valores: Record<string, unknown> = { [campoCantidad]: m.product_uom_qty };
    // Desde la 17 un movimiento además se marca como "elegido"; si el campo no
    // existe, no se manda.
    if ("picked" in campos) valores.picked = true;
    await llamar("stock.move", "write", [[m.id], valores]);
  }

  await llamar("stock.picking", "button_validate", [[pickingId]]);

  const [despues] = await llamar<{ state: string }[]>("stock.picking", "read", [[pickingId], ["state"]]);
  if (despues?.state !== "done") {
    return {
      ok: false,
      motivo:
        `La recepción quedó en "${despues?.state ?? "?"}" y no en "done". ` +
        "Probablemente Odoo pidió un paso más (un asistente): hay que validarla a mano.",
    };
  }
  return { ok: true };
}

/** Lo que dijo Odoo, sin traducir, guardado donde la pantalla lo va a mostrar. */
async function anotarElError(
  admin: SupabaseClient,
  recepcionId: string,
  e: unknown
): Promise<{ ok: false; motivo: string }> {
  const motivo = e instanceof Error ? e.message : mensajeDeOdoo(e as never);
  await admin
    .from("despacho_recepciones")
    .update({ odoo_error: motivo, odoo_error_en: new Date().toISOString() })
    .eq("id", recepcionId);
  return { ok: false, motivo };
}
