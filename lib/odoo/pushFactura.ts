import type { SupabaseClient } from "@supabase/supabase-js";
import { crearEn, llamar, mensajeDeOdoo } from "./client";
import { resolverContextoDeFacturas } from "./contexto";
import { armarBorradorDeFactura } from "@/lib/facturacion/borradorEnOdoo";
import { discriminaIva } from "@/lib/facturacion/comprobante";

/**
 * Crear en Odoo, **en borrador**, la factura de proveedor que está en el buzón.
 *
 * Cierra el camino sin orden de compra, que es por donde entra casi todo: de las
 * 6.423 facturas de proveedor del grupo, la enorme mayoría se carga de cero. El
 * buzón ya leyó emisor, número, fecha e importe del QR sin que nadie los tipee;
 * esto los deja escritos del lado de contabilidad para que la carga sea revisar
 * y postear.
 *
 * **Sigue sin postear nada.** El borrador es una propuesta: la numeración
 * fiscal, los impuestos finales y el asiento los decide Odoo cuando una persona
 * confirma. Es la regla de la integración y acá tampoco se toca.
 *
 * Acá vive la orquestación —leer, resolver ids, crear, guardar el vínculo—; los
 * `vals` se arman en `lib/facturacion/borradorEnOdoo.ts`, que se prueba sin red.
 */

interface FilaDeFactura {
  id: string;
  cuit_emisor: string | null;
  tipo_comprobante: number | null;
  punto_venta: number | null;
  numero: number | null;
  fecha: string | null;
  importe_total: number | null;
  moneda: string | null;
  estado: string;
  empresa_id: string | null;
  proveedor_id: string | null;
  requerimiento_id: string | null;
  odoo_move_id: number | null;
  empresas: { nombre: string; odoo_company_id: number | null } | null;
  proveedores: { nombre: string } | null;
  compras_requerimientos: { nro_ri: number } | null;
}

export interface FacturaEmpujada {
  odooMoveId: number;
  /** `/` mientras está en borrador: Odoo numera al postear. */
  odooNombre: string | null;
  odooEstado: string;
  /** El total que quedó en Odoo, que puede diferir del comprobante por centavos. */
  totalEnOdoo: number;
  avisos: string[];
}

export type ResultadoDelPushDeFactura =
  | { ok: true; factura: FacturaEmpujada }
  | { ok: false; motivos: string[] };

/*
 * Las columnas del vínculo con Odoo se piden **acá**, antes de hablar con Odoo,
 * aunque esta consulta no las use para nada. Es a propósito: si la migración
 * todavía no se aplicó, PostgREST falla en este select y no en el update de
 * después — o sea que el borrador no llega a crearse. Al revés quedaría un
 * asiento en Odoo que el SdG no sabe que existe, y el siguiente intento lo
 * duplicaría.
 */
const SELECT =
  "id, cuit_emisor, tipo_comprobante, punto_venta, numero, fecha, importe_total, moneda, estado, " +
  "empresa_id, proveedor_id, requerimiento_id, odoo_move_id, odoo_nombre, odoo_estado, " +
  "odoo_conciliado_por, odoo_pendiente, odoo_sincronizado_en, " +
  "empresas!empresa_id(nombre, odoo_company_id), proveedores!proveedor_id(nombre), " +
  "compras_requerimientos!requerimiento_id(nro_ri)";

/**
 * Lo que impide empujar antes de hablar con Odoo.
 *
 * Se separa para poder contestarlo sin gastar un viaje de red, y porque casi
 * todos los motivos son cosas que alguien tiene que ir a arreglar a otra
 * pantalla: el mensaje dice cuál.
 */
function problemasPrevios(f: FilaDeFactura): string[] {
  const motivos: string[] = [];

  if (f.odoo_move_id) {
    motivos.push(`Esta factura ya está en Odoo (id ${f.odoo_move_id}). Crear otra la duplicaría.`);
  } else if (f.estado === "contabilizada") {
    motivos.push(
      "Esta factura ya figura como contabilizada, así que alguien la cargó en Odoo a mano. " +
        "Si hace falta el borrador igual, primero hay que sacarle ese estado."
    );
  }

  if (!f.empresa_id) {
    motivos.push("Falta decir a cuál de las dos empresas se le facturó.");
  } else if (!f.empresas?.odoo_company_id) {
    motivos.push(`La empresa ${f.empresas?.nombre ?? ""} no está mapeada a una empresa de Odoo.`);
  }

  if (!f.proveedor_id) {
    motivos.push(
      "La factura no tiene proveedor. Si el CUIT del emisor no está en el padrón, hay que darlo de alta."
    );
  }

  return motivos;
}

export async function empujarFacturaAOdoo(
  admin: SupabaseClient,
  facturaId: string
): Promise<ResultadoDelPushDeFactura> {
  const { data, error } = await admin
    .from("facturas_proveedor")
    .select(SELECT)
    .eq("id", facturaId)
    .maybeSingle();

  if (error) {
    // El caso que vale la pena distinguir: la migración del vínculo con Odoo no
    // se aplicó todavía, y el mensaje crudo de PostgREST no lo dice así.
    const falta = /column .*odoo_/i.test(error.message);
    return {
      ok: false,
      motivos: [
        falta
          ? `Falta aplicar la migración del vínculo con Odoo (20260911084048_facturacion_el_vinculo_con_odoo.sql). ${error.message}`
          : error.message,
      ],
    };
  }
  if (!data) return { ok: false, motivos: ["No existe esa factura."] };

  const factura = data as unknown as FilaDeFactura;

  const previos = problemasPrevios(factura);
  if (previos.length) return { ok: false, motivos: previos };

  const companyId = factura.empresas!.odoo_company_id!;

  const { data: enlace } = await admin
    .from("proveedores_odoo")
    .select("odoo_partner_id")
    .eq("proveedor_id", factura.proveedor_id!)
    .eq("empresa_id", factura.empresa_id!)
    .maybeSingle();

  /*
   * El proveedor puede existir en una empresa y no en la otra: hay 262 en
   * Polcecal, 237 en Polysan y sólo 147 en las dos. Decirlo con ese detalle es
   * la diferencia entre una tarea de dos minutos en Odoo y un "error al crear la
   * factura" que no se sabe por dónde agarrar.
   */
  if (!enlace?.odoo_partner_id) {
    return {
      ok: false,
      motivos: [
        `${factura.proveedores?.nombre ?? "El proveedor"} no está enlazado con Odoo en ` +
          `${factura.empresas?.nombre ?? "esa empresa"}. Hay que darlo de alta ahí, o correr el ` +
          `cruce de proveedores si ya existe.`,
      ],
    };
  }

  const contexto = await resolverContextoDeFacturas(
    [companyId],
    factura.tipo_comprobante === null ? [] : [factura.tipo_comprobante]
  );
  if (!contexto.ok) return { ok: false, motivos: contexto.problemas };

  const datos = contexto.contexto.porEmpresa[companyId];
  const moneda = factura.moneda === "USD" ? "USD" : "ARS";
  const monedaId = contexto.contexto.monedas[moneda];

  if (!monedaId) {
    return { ok: false, motivos: [`Odoo no tiene activa la moneda ${moneda}.`] };
  }

  const armado = armarBorradorDeFactura(factura, {
    partnerId: enlace.odoo_partner_id as number,
    diarioId: datos.diarioId,
    impuestoId: datos.impuestoId,
    monedaId,
    voucherTypeId:
      factura.tipo_comprobante === null
        ? null
        : (contexto.contexto.tiposPorCodigo[factura.tipo_comprobante] ?? null),
    nroRi: factura.compras_requerimientos?.nro_ri ?? null,
  });

  if (!armado.ok) return { ok: false, motivos: armado.problemas };

  const avisos: string[] = [];
  if (discriminaIva(factura.tipo_comprobante) && datos.impuestoId === null) {
    avisos.push(
      "La empresa no tiene configurado el IVA Compras 21%, así que el borrador quedó sin impuesto."
    );
  }

  let odooMoveId: number;
  try {
    odooMoveId = await crearEn("account.move", companyId, armado.borrador.vals);
  } catch (e) {
    const motivo = e instanceof Error ? e.message : mensajeDeOdoo(e as never);
    /*
     * Un fallo de escritura no es un `console.warn`: queda guardado con lo que
     * dijo Odoo, sin traducir, y se muestra en la pantalla de quien lo intentó.
     * Es la misma regla que `sheets_pendiente` y que el `odoo_pendiente` de las
     * órdenes de compra.
     */
    await admin
      .from("facturas_proveedor")
      .update({ odoo_pendiente: motivo, odoo_sincronizado_en: new Date().toISOString() })
      .eq("id", facturaId);

    return { ok: false, motivos: [motivo] };
  }

  const [creada] = await llamar<
    {
      name: string | null;
      state: string;
      amount_total: number;
      full_voucher_name: string | false;
    }[]
  >("account.move", "read", [[odooMoveId], ["name", "state", "amount_total", "full_voucher_name"]]);

  /*
   * Se relee el total en vez de confiar en la cuenta propia. `price_unit` tiene
   * dos decimales, así que reconstruir el neto desde el total con IVA no siempre
   * cierra al centavo — contra las 793 facturas A del grupo falla en 8, siempre
   * por menos de dos centavos. Es poco, y es justo el tipo de diferencia que
   * aparece meses después en una conciliación si nadie la dijo.
   */
  const totalEnOdoo = Number(creada?.amount_total ?? 0);
  const totalDelComprobante = Math.abs(Number(factura.importe_total ?? 0));
  if (Math.abs(totalEnOdoo - totalDelComprobante) > 0.01) {
    avisos.push(
      `El borrador quedó en ${totalEnOdoo} y el comprobante dice ${totalDelComprobante}: ` +
        `hay que ajustar la diferencia en Odoo antes de postear.`
    );
  }

  /*
   * Se guarda `full_voucher_name` ("FC A 0006-00010192") y no `name`: en
   * borrador el `name` es "/" y no le dice nada a nadie. Cuando la posteen, la
   * sincronizacion lo reemplaza por el BILL/2026/09/0004, que ahi si existe.
   */
  const nombreParaMostrar = creada?.full_voucher_name || creada?.name || null;

  await admin
    .from("facturas_proveedor")
    .update({
      odoo_move_id: odooMoveId,
      odoo_nombre: nombreParaMostrar,
      odoo_estado: creada?.state ?? "draft",
      odoo_conciliado_por: "push",
      odoo_pendiente: null,
      odoo_sincronizado_en: new Date().toISOString(),
      estado: "informada",
    })
    .eq("id", facturaId);

  return {
    ok: true,
    factura: {
      odooMoveId,
      odooNombre: nombreParaMostrar,
      odooEstado: creada?.state ?? "draft",
      totalEnOdoo,
      avisos,
    },
  };
}
