import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarLeer, enlaceAOdoo, idDeRelacion, llamar, mensajeDeOdoo } from "./client";
import {
  diferenciasDeImputacion,
  type LineaImputadaEnElSdg,
} from "@/lib/facturacion/lineas";

/**
 * Mirar el borrador que está en Odoo, y confirmarlo desde el SdG.
 *
 * ## Esto cambia una regla del sistema, a pedido
 *
 * Hasta acá la regla era **"el SdG propone, Odoo confirma"**: el SdG creaba el
 * borrador y una persona lo posteaba en Odoo. Confirmar desde el SdG mueve esa
 * línea, y conviene que quede escrito por qué se puede y qué implica:
 *
 * - **Un asiento posteado es inmutable.** Odoo le asigna la numeración del
 *   diario y deja de ser editable; para corregirlo hay que reabrirlo o
 *   reversarlo, que es una operación contable, no un botón. O sea que esto **no
 *   se deshace desde acá**.
 * - Por eso el posteo pide dos cosas que el borrador no pedía: que alguien lo
 *   confirme explícitamente, y que **los números cuadren con el papel**. Si el
 *   total del asiento no es el del comprobante, no se postea — postear algo que
 *   no coincide con la factura es exactamente el error que después nadie
 *   encuentra.
 * - Lo que **no** cambia: el SdG sigue sin inventar asientos. Postea el que ya
 *   había creado y que una persona miró.
 *
 * ## Y no postea un borrador desactualizado
 *
 * Costó una factura mal contabilizada: el borrador se había creado **antes** de
 * imputar las líneas, la imputación quedó guardada en el SdG, y confirmar posteó
 * el asiento viejo — sin cuenta y sin analítica, y ya inmutable. Así que ahora
 * se compara línea por línea antes de postear, y si no coinciden se dice qué
 * hacer en vez de dejar pasar algo que nadie revisó con esos números.
 */

export interface LineaDelBorrador {
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  cuenta: string | null;
  /** `EM6 - CATERPILLAR 950 G 50% · TALLER 50%`, ya resuelto a nombres. */
  analitica: string | null;
  impuestos: string[];
}

export interface BorradorDeOdoo {
  odooMoveId: number;
  nombre: string | null;
  numero: string | null;
  estado: string;
  empresa: string | null;
  proveedor: string | null;
  fecha: string | null;
  neto: number;
  impuestos: number;
  total: number;
  lineas: LineaDelBorrador[];
  adjuntos: { id: number; nombre: string; bytes: number }[];
  enlace: string | null;
}

/** El borrador tal como está en Odoo ahora, no como el SdG lo mandó. */
export async function traerElBorrador(odooMoveId: number): Promise<BorradorDeOdoo> {
  const [move] = await llamar<
    {
      id: number;
      name: string | null;
      full_voucher_name: string | false;
      state: string;
      company_id: unknown;
      partner_id: unknown;
      invoice_date: string | false;
      amount_untaxed: number;
      amount_tax: number;
      amount_total: number;
    }[]
  >("account.move", "read", [
    [odooMoveId],
    [
      "name",
      "full_voucher_name",
      "state",
      "company_id",
      "partner_id",
      "invoice_date",
      "amount_untaxed",
      "amount_tax",
      "amount_total",
    ],
  ]);

  if (!move) throw new Error(`El asiento ${odooMoveId} ya no existe en Odoo.`);

  const crudas = await buscarLeer<{
    name: string | false;
    quantity: number;
    price_unit: number;
    price_subtotal: number;
    account_id: unknown;
    tax_ids: number[];
    analytic_distribution: Record<string, number> | false;
  }>(
    "account.move.line",
    [
      ["move_id", "=", odooMoveId],
      ["display_type", "=", "product"],
    ],
    ["name", "quantity", "price_unit", "price_subtotal", "account_id", "tax_ids", "analytic_distribution"],
    { limite: 200 }
  );

  /*
   * Los nombres de las analíticas y de los impuestos se resuelven en dos
   * llamadas y no en una por línea: una factura de catorce ítems haría
   * veintiocho viajes a Odoo para mostrar una pantalla.
   */
  const idsAnaliticos = [
    ...new Set(
      crudas.flatMap((l) => (l.analytic_distribution ? Object.keys(l.analytic_distribution) : []))
    ),
  ].map(Number);

  const idsDeImpuesto = [...new Set(crudas.flatMap((l) => l.tax_ids ?? []))];

  const [analiticas, impuestos] = await Promise.all([
    idsAnaliticos.length
      ? llamar<{ id: number; name: string }[]>("account.analytic.account", "read", [
          idsAnaliticos,
          ["name"],
        ])
      : Promise.resolve([]),
    idsDeImpuesto.length
      ? llamar<{ id: number; name: string }[]>("account.tax", "read", [idsDeImpuesto, ["name"]])
      : Promise.resolve([]),
  ]);

  const nombreAnalitico = new Map(analiticas.map((a) => [a.id, a.name]));
  const nombreDeImpuesto = new Map(impuestos.map((t) => [t.id, t.name]));

  const adjuntos = await buscarLeer<{ id: number; name: string; file_size: number }>(
    "ir.attachment",
    [
      ["res_model", "=", "account.move"],
      ["res_id", "=", odooMoveId],
    ],
    ["name", "file_size"],
    { limite: 20 }
  );

  return {
    odooMoveId,
    nombre: move.name && move.name !== "/" ? move.name : null,
    numero: move.full_voucher_name || null,
    estado: move.state,
    empresa: Array.isArray(move.company_id) ? String(move.company_id[1]) : null,
    proveedor: Array.isArray(move.partner_id) ? String(move.partner_id[1]) : null,
    fecha: move.invoice_date || null,
    neto: Number(move.amount_untaxed ?? 0),
    impuestos: Number(move.amount_tax ?? 0),
    total: Number(move.amount_total ?? 0),
    lineas: crudas.map((l) => ({
      descripcion: l.name || "",
      cantidad: Number(l.quantity ?? 0),
      precioUnitario: Number(l.price_unit ?? 0),
      subtotal: Number(l.price_subtotal ?? 0),
      cuenta: Array.isArray(l.account_id) ? String(l.account_id[1]) : null,
      analitica: l.analytic_distribution
        ? Object.entries(l.analytic_distribution)
            .sort((a, b) => b[1] - a[1])
            .map(([id, pct]) => `${nombreAnalitico.get(Number(id)) ?? `#${id}`} ${pct}%`)
            .join(" · ")
        : null,
      impuestos: (l.tax_ids ?? []).map((t) => nombreDeImpuesto.get(t) ?? `#${t}`),
    })),
    adjuntos: adjuntos.map((a) => ({ id: a.id, nombre: a.name, bytes: a.file_size })),
    enlace: enlaceAOdoo("account.move", odooMoveId),
  };
}

export type ResultadoDeConfirmar =
  | { ok: true; nombre: string; total: number }
  | { ok: false; motivos: string[] };

/**
 * Postear el asiento en Odoo desde el SdG.
 *
 * Los controles de acá no son burocracia: son lo que separa "confirmar una carga
 * que alguien revisó" de "escribir en la contabilidad del grupo por accidente".
 * Un asiento posteado no se edita.
 */
export async function confirmarElBorrador(
  admin: SupabaseClient,
  facturaId: string
): Promise<ResultadoDeConfirmar> {
  const { data } = await admin
    .from("facturas_proveedor")
    .select("id, importe_total, odoo_move_id, estado")
    .eq("id", facturaId)
    .maybeSingle();

  if (!data) return { ok: false, motivos: ["No existe esa factura."] };
  if (!data.odoo_move_id) {
    return { ok: false, motivos: ["Esta factura no tiene un borrador en Odoo para confirmar."] };
  }

  let borrador: BorradorDeOdoo;
  try {
    borrador = await traerElBorrador(data.odoo_move_id as number);
  } catch (e) {
    return { ok: false, motivos: [e instanceof Error ? e.message : String(e)] };
  }

  if (borrador.estado === "posted") {
    return { ok: false, motivos: ["Ese asiento ya está posteado en Odoo."] };
  }
  if (borrador.estado !== "draft") {
    return { ok: false, motivos: [`El asiento está en estado "${borrador.estado}" y no se puede postear.`] };
  }

  /*
   * El control que importa: que lo que se va a postear sea la factura que llegó.
   * El margen es de un centavo por línea, que es lo que puede aportar el
   * redondeo de cada fila — el mismo criterio que usa el aviso del push.
   */
  const delComprobante = Math.abs(Number(data.importe_total ?? 0));
  const margen = Math.max(0.01, 0.01 * Math.max(1, borrador.lineas.length));

  if (delComprobante && Math.abs(borrador.total - delComprobante) > margen) {
    return {
      ok: false,
      motivos: [
        `El asiento suma ${borrador.total} y el comprobante dice ${delComprobante}. ` +
          `No se postea algo que no coincide con la factura: hay que corregirlo en Odoo primero.`,
      ],
    };
  }

  /*
   * Que el asiento sea lo que el SdG dice que es. El control del total no
   * alcanza: cambiar la cuenta o la analítica de una línea no mueve el total ni
   * un centavo, y es exactamente lo que se perdía.
   */
  const desactualizado = await loQueNoCoincide(admin, facturaId, borrador);
  if (desactualizado.length) {
    return {
      ok: false,
      motivos: [
        `El borrador de Odoo no tiene lo que está cargado en el sistema: ${desactualizado.join("; ")}. ` +
          `Hay que actualizar el borrador antes de confirmarlo.`,
      ],
    };
  }

  try {
    await llamar("account.move", "action_post", [[data.odoo_move_id]]);
  } catch (e) {
    const motivo = e instanceof Error ? e.message : mensajeDeOdoo(e as never);
    await admin
      .from("facturas_proveedor")
      .update({ odoo_pendiente: motivo, odoo_sincronizado_en: new Date().toISOString() })
      .eq("id", facturaId);
    return { ok: false, motivos: [motivo] };
  }

  const [posteada] = await llamar<{ name: string; state: string; amount_total: number }[]>(
    "account.move",
    "read",
    [[data.odoo_move_id], ["name", "state", "amount_total"]]
  );

  await admin
    .from("facturas_proveedor")
    .update({
      estado: "contabilizada",
      odoo_nombre: posteada?.name ?? null,
      odoo_estado: posteada?.state ?? "posted",
      odoo_pendiente: null,
      odoo_sincronizado_en: new Date().toISOString(),
    })
    .eq("id", facturaId);

  return {
    ok: true,
    nombre: posteada?.name ?? String(data.odoo_move_id),
    total: Number(posteada?.amount_total ?? borrador.total),
  };
}

/** Sirve para no repetir la conversión en la ruta. */
export { idDeRelacion };

/** Trae lo imputado en el SdG y lo compara con el asiento. Ver `diferenciasDeImputacion`. */
async function loQueNoCoincide(
  admin: SupabaseClient,
  facturaId: string,
  borrador: BorradorDeOdoo
): Promise<string[]> {
  const { data } = await admin
    .from("facturas_proveedor_lineas")
    .select("orden, descripcion, odoo_account_nombre, analitica")
    .eq("factura_id", facturaId)
    .order("orden");

  return diferenciasDeImputacion(
    (data ?? []) as unknown as LineaImputadaEnElSdg[],
    borrador.lineas
  );
}
