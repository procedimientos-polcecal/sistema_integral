/**
 * Crear en Odoo la orden de compra de un requerimiento aprobado.
 *
 * Etapa 1 del spec de facturación: si la orden existe, contabilidad genera la
 * factura **desde** la orden en vez de tipearla de cero, que es lo que hace lenta
 * la carga hoy.
 *
 * Acá vive la orquestación —leer, armar, crear, guardar el vínculo— y nada más.
 * Las decisiones están en `ordenDeCompra.ts` (qué se le manda a Odoo) y en
 * `contexto.ts` (con qué ids), las dos testeables aparte.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarLeer, crearEn, mensajeDeOdoo } from "./client";
import { resolverContextoDeOdoo } from "./contexto";
import { armarOrdenes } from "./ordenDeCompra";
import type { EmpresaParaOrden, Problema } from "./ordenDeCompra";

export interface OrdenCreada {
  empresa: string;
  odooOrderId: number;
  odooNombre: string | null;
  porcentaje: number;
  /** `true` si ya existía de antes y no se creó nada. */
  yaExistia: boolean;
}

export type ResultadoDelPush =
  | { ok: true; ordenes: OrdenCreada[] }
  | { ok: false; motivos: string[] };

interface FilaRequerimiento {
  id: string;
  nro_ri: number;
  descripcion: string;
  codigo: string | null;
  cantidad: number | null;
  empresa_id: string | null;
  paga_ambas: boolean;
  fecha_necesidad: string | null;
  proveedor_id: string | null;
}

interface FilaEmpresa {
  id: string;
  nombre: string;
  odoo_company_id: number | null;
}

/**
 * Empuja la orden (o las dos) de un requerimiento.
 *
 * Es idempotente por construcción: **el vínculo se guarda inmediatamente después
 * de cada creación**, antes de intentar la siguiente. Si el proceso se corta
 * entre las dos órdenes de un requerimiento compartido, un reintento encuentra la
 * primera y sólo crea la que falta. Sin eso, el reintento le manda al proveedor
 * el mismo pedido dos veces, que es el error más caro de todos los posibles acá.
 */
export async function empujarOrdenesDeRequerimiento(
  admin: SupabaseClient,
  requerimientoId: string
): Promise<ResultadoDelPush> {
  const { data: ri, error: errorRi } = await admin
    .from("compras_requerimientos")
    .select(
      "id, nro_ri, descripcion, codigo, cantidad, empresa_id, paga_ambas, fecha_necesidad, proveedor_id"
    )
    .eq("id", requerimientoId)
    .maybeSingle<FilaRequerimiento>();

  if (errorRi) return { ok: false, motivos: [errorRi.message] };
  if (!ri) return { ok: false, motivos: ["No existe ese requerimiento."] };

  if (!ri.proveedor_id) {
    return await anotarPendiente(admin, ri.id, [
      `El RI ${ri.nro_ri} no tiene proveedor elegido: sin proveedor no hay orden de compra posible.`,
    ]);
  }

  // La cotización elegida es de donde sale el precio: es la que ganó la
  // comparativa, no el costo estimado del requerimiento.
  const { data: cotizacion } = await admin
    .from("compras_cotizaciones")
    .select("precio_unitario, cantidad, descuento, costo_envio, moneda")
    .eq("requerimiento_id", ri.id)
    .eq("elegida", true)
    .maybeSingle();

  if (!cotizacion) {
    return await anotarPendiente(admin, ri.id, [
      `El RI ${ri.nro_ri} no tiene cotización elegida en la comparativa.`,
    ]);
  }

  // Qué empresas: la del RI, o las dos si lo pagan las dos.
  const { data: todasLasEmpresas } = await admin
    .from("empresas")
    .select("id, nombre, odoo_company_id")
    .order("nombre");

  const empresasDelRi = (todasLasEmpresas ?? []).filter((e: FilaEmpresa) =>
    ri.paga_ambas ? true : e.id === ri.empresa_id
  ) as FilaEmpresa[];

  if (!empresasDelRi.length) {
    return await anotarPendiente(admin, ri.id, [
      `El RI ${ri.nro_ri} no tiene empresa definida y tampoco está marcado como AMBAS.`,
    ]);
  }

  const sinMapear = empresasDelRi.filter((e) => e.odoo_company_id === null);
  if (sinMapear.length) {
    return await anotarPendiente(admin, ri.id, [
      `Falta el mapeo con Odoo de ${sinMapear.map((e) => e.nombre).join(" y ")} ` +
        `(empresas.odoo_company_id está en null).`,
    ]);
  }

  // Los enlaces del proveedor, por empresa.
  const { data: enlaces } = await admin
    .from("proveedores_odoo")
    .select("empresa_id, odoo_partner_id")
    .eq("proveedor_id", ri.proveedor_id);

  const partnerPorEmpresa = new Map<string, number>(
    (enlaces ?? []).map((e) => [e.empresa_id as string, e.odoo_partner_id as number])
  );

  // Lo que ya se creó antes, para no duplicar.
  const { data: yaCreadas } = await admin
    .from("compras_odoo_ordenes")
    .select("empresa_id, odoo_order_id, odoo_nombre, porcentaje")
    .eq("requerimiento_id", ri.id);

  const existentes = new Map(
    (yaCreadas ?? []).map((o) => [
      o.empresa_id as string,
      {
        odooOrderId: o.odoo_order_id as number,
        odooNombre: (o.odoo_nombre ?? null) as string | null,
        porcentaje: o.porcentaje as number,
      },
    ])
  );

  const contexto = await resolverContextoDeOdoo(
    empresasDelRi.map((e) => e.odoo_company_id!)
  );
  if (!contexto.ok) return await anotarPendiente(admin, ri.id, contexto.problemas);

  const paraOrden: EmpresaParaOrden[] = empresasDelRi.map((e) => {
    const datos = contexto.contexto.porEmpresa[e.odoo_company_id!];
    return {
      id: e.id,
      nombre: e.nombre,
      odooCompanyId: e.odoo_company_id!,
      odooPartnerId: partnerPorEmpresa.get(e.id) ?? null,
      pickingTypeId: datos.pickingTypeId,
      impuestoId: datos.impuestoId,
    };
  });

  const armado = armarOrdenes(
    {
      nroRi: ri.nro_ri,
      descripcion: ri.descripcion,
      codigo: ri.codigo,
      cantidad: ri.cantidad,
      empresaId: ri.empresa_id,
      pagaAmbas: ri.paga_ambas,
      fechaNecesidad: ri.fecha_necesidad,
    },
    {
      precioUnitario: cotizacion.precio_unitario,
      cantidad: cotizacion.cantidad,
      descuento: cotizacion.descuento,
      costoEnvio: cotizacion.costo_envio,
      moneda: cotizacion.moneda,
    },
    paraOrden,
    {
      monedas: contexto.contexto.monedas,
      productoGenericoId: contexto.contexto.productoGenericoId,
      uomId: contexto.contexto.uomId,
      ahora: new Date(),
    }
  );

  if (!armado.ok) {
    return await anotarPendiente(admin, ri.id, armado.problemas.map(textoDelProblema));
  }

  const creadas: OrdenCreada[] = [];

  for (const orden of armado.ordenes) {
    const previa = existentes.get(orden.empresaId);
    if (previa) {
      creadas.push({
        empresa: orden.empresaNombre,
        odooOrderId: previa.odooOrderId,
        odooNombre: previa.odooNombre,
        porcentaje: previa.porcentaje,
        yaExistia: true,
      });
      continue;
    }

    let odooOrderId: number;
    try {
      odooOrderId = await crearEn(
        "purchase.order",
        orden.vals.company_id as number,
        orden.vals
      );
    } catch (e) {
      /*
       * Se anota el pendiente con lo que dijo Odoo **sin traducir**, igual que
       * `sheets_pendiente` con Google. Si ya se creó una de las dos órdenes, su
       * vínculo quedó guardado arriba: el reintento no la duplica.
       */
      const detalle = e instanceof Error ? e.message : String(e);
      await anotarPendiente(admin, ri.id, [
        `No se pudo crear la orden de ${orden.empresaNombre} en Odoo: ${detalle}`,
      ]);
      return {
        ok: false,
        motivos: [`No se pudo crear la orden de ${orden.empresaNombre} en Odoo: ${detalle}`],
      };
    }

    // El nombre (`P02416`) es lo que hay que decirle a contabilidad. Se lee
    // ahora y se guarda: pedirlo después es un viaje de red para mostrar un
    // texto que ya tuvimos a mano.
    let odooNombre: string | null = null;
    try {
      const [leida] = await buscarLeer<{ id: number; name: string }>(
        "purchase.order",
        [["id", "=", odooOrderId]],
        ["name"]
      );
      odooNombre = leida?.name ?? null;
    } catch {
      // Que no se pueda leer el nombre no invalida la orden: ya está creada.
    }

    const { error: errorVinculo } = await admin.from("compras_odoo_ordenes").upsert(
      {
        requerimiento_id: ri.id,
        empresa_id: orden.empresaId,
        odoo_order_id: odooOrderId,
        odoo_nombre: odooNombre,
        porcentaje: orden.porcentaje,
      },
      { onConflict: "requerimiento_id,empresa_id" }
    );

    if (errorVinculo) {
      /*
       * La orden existe en Odoo pero el vínculo no se guardó. Es el peor estado
       * posible —un reintento crearía una segunda orden—, así que se dice con el
       * número de orden a la vista para poder resolverlo a mano.
       */
      const aviso =
        `La orden ${odooNombre ?? odooOrderId} se creó en Odoo (${orden.empresaNombre}) ` +
        `pero no se pudo guardar el vínculo: ${errorVinculo.message}. ` +
        `No reintentar sin revisar, o se duplica la orden.`;
      await anotarPendiente(admin, ri.id, [aviso]);
      return { ok: false, motivos: [aviso] };
    }

    creadas.push({
      empresa: orden.empresaNombre,
      odooOrderId,
      odooNombre,
      porcentaje: orden.porcentaje,
      yaExistia: false,
    });
  }

  // Salió bien: si había un pendiente de un intento anterior, ya no aplica.
  await admin
    .from("compras_requerimientos")
    .update({ odoo_pendiente: null })
    .eq("id", ri.id);

  return { ok: true, ordenes: creadas };
}

function textoDelProblema(p: Problema): string {
  return p.detalle;
}

/**
 * Guarda el pendiente en el requerimiento y devuelve el fallo.
 *
 * El pendiente no es decoración: un requerimiento aprobado cuya orden no llegó a
 * Odoo es una divergencia que no avisa sola. Quien aprobó tiene que poder verlo
 * en la pantalla del RI.
 */
async function anotarPendiente(
  admin: SupabaseClient,
  requerimientoId: string,
  motivos: string[]
): Promise<{ ok: false; motivos: string[] }> {
  await admin
    .from("compras_requerimientos")
    .update({ odoo_pendiente: motivos.join(" | ") })
    .eq("id", requerimientoId);

  return { ok: false, motivos };
}

/** Lo mismo, pero sin crear nada: para poder mirarlo antes de mandarlo. */
export async function ensayarOrdenesDeRequerimiento(
  admin: SupabaseClient,
  requerimientoId: string
): Promise<unknown> {
  const { data: ri } = await admin
    .from("compras_requerimientos")
    .select(
      "id, nro_ri, descripcion, codigo, cantidad, empresa_id, paga_ambas, fecha_necesidad, proveedor_id"
    )
    .eq("id", requerimientoId)
    .maybeSingle<FilaRequerimiento>();

  if (!ri) return { error: "No existe ese requerimiento." };

  const [{ data: cotizacion }, { data: empresas }, { data: enlaces }, { data: yaCreadas }] =
    await Promise.all([
      admin
        .from("compras_cotizaciones")
        .select("precio_unitario, cantidad, descuento, costo_envio, moneda")
        .eq("requerimiento_id", ri.id)
        .eq("elegida", true)
        .maybeSingle(),
      admin.from("empresas").select("id, nombre, odoo_company_id").order("nombre"),
      admin
        .from("proveedores_odoo")
        .select("empresa_id, odoo_partner_id")
        .eq("proveedor_id", ri.proveedor_id ?? ""),
      admin
        .from("compras_odoo_ordenes")
        .select("empresa_id, odoo_order_id, odoo_nombre")
        .eq("requerimiento_id", ri.id),
    ]);

  const empresasDelRi = ((empresas ?? []) as FilaEmpresa[]).filter((e) =>
    ri.paga_ambas ? true : e.id === ri.empresa_id
  );

  const contexto = await resolverContextoDeOdoo(
    empresasDelRi.map((e) => e.odoo_company_id).filter((x): x is number => x !== null)
  );

  if (!contexto.ok) {
    return { requerimiento: ri, cotizacion, yaCreadas, problemas: contexto.problemas };
  }

  const partnerPorEmpresa = new Map<string, number>(
    (enlaces ?? []).map((e) => [e.empresa_id as string, e.odoo_partner_id as number])
  );

  const armado = armarOrdenes(
    {
      nroRi: ri.nro_ri,
      descripcion: ri.descripcion,
      codigo: ri.codigo,
      cantidad: ri.cantidad,
      empresaId: ri.empresa_id,
      pagaAmbas: ri.paga_ambas,
      fechaNecesidad: ri.fecha_necesidad,
    },
    {
      precioUnitario: cotizacion?.precio_unitario ?? null,
      cantidad: cotizacion?.cantidad ?? null,
      descuento: cotizacion?.descuento ?? null,
      costoEnvio: cotizacion?.costo_envio ?? null,
      moneda: cotizacion?.moneda ?? null,
    },
    empresasDelRi.map((e) => ({
      id: e.id,
      nombre: e.nombre,
      odooCompanyId: e.odoo_company_id!,
      odooPartnerId: partnerPorEmpresa.get(e.id) ?? null,
      pickingTypeId: contexto.contexto.porEmpresa[e.odoo_company_id!]?.pickingTypeId ?? 0,
      impuestoId: contexto.contexto.porEmpresa[e.odoo_company_id!]?.impuestoId ?? null,
    })),
    {
      monedas: contexto.contexto.monedas,
      productoGenericoId: contexto.contexto.productoGenericoId,
      uomId: contexto.contexto.uomId,
      ahora: new Date(),
    }
  );

  return {
    requerimiento: { nroRi: ri.nro_ri, descripcion: ri.descripcion, pagaAmbas: ri.paga_ambas },
    cotizacion,
    yaCreadas,
    contexto: contexto.contexto,
    // Lo que se le mandaría a Odoo, tal cual, sin mandarlo.
    armado,
  };
}
