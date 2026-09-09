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
import { precioDesdeElRequerimiento } from "@/lib/compras/costoDelRequerimiento";
import type { CotizacionParaOrden, EmpresaParaOrden, Problema } from "./ordenDeCompra";

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
  /** El "Costo + IVA" que carga el encargado: total con IVA, sin el envío. */
  costo_iva: number | null;
  costo_envio: number | null;
  moneda: string | null;
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
      "id, nro_ri, descripcion, codigo, cantidad, empresa_id, paga_ambas, fecha_necesidad, proveedor_id, costo_iva, costo_envio, moneda"
    )
    .eq("id", requerimientoId)
    .maybeSingle<FilaRequerimiento>();

  if (errorRi) return { ok: false, motivos: [errorRi.message] };
  if (!ri) return { ok: false, motivos: ["No existe ese requerimiento."] };

  // La cotización elegida es de donde sale el precio: es la que ganó la
  // comparativa, no el costo estimado del requerimiento.
  const { data: cotizacion } = await admin
    .from("compras_cotizaciones")
    .select("precio_unitario, cantidad, descuento, costo_envio, moneda")
    .eq("requerimiento_id", ri.id)
    .eq("elegida", true)
    .maybeSingle();

  const previos = problemasPrevios(ri);
  if (previos.length) return await anotarPendiente(admin, ri.id, previos);

  const fuente = precioParaLaOrden(ri, cotizacion);
  if (!fuente.ok) return await anotarPendiente(admin, ri.id, [fuente.motivo]);

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
    fuente.precio,
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

    /*
     * El vínculo dice que la orden existe. Hay que **preguntarle a Odoo** si es
     * verdad, y no es paranoia: pasó el 09/09/2026. Se crearon dos órdenes en
     * producción por error, alguien las borró en Odoo, y el SdG se quedó con los
     * vínculos apuntando a órdenes inexistentes. Con eso el requerimiento quedó
     * trabado para siempre —"ya existe", decía— sin forma de volver a crearlas.
     *
     * Una orden borrada del otro lado no es un caso raro: borrar un borrador es
     * lo primero que hace cualquiera que ve una orden que no va. Si ya no está,
     * el vínculo se descarta y se crea de nuevo.
     */
    if (previa && (await existeEnOdoo(previa.odooOrderId))) {
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

/**
 * ¿La orden sigue existiendo en Odoo?
 *
 * Ante la duda contesta que **sí**: si Odoo no responde, lo peor que puede pasar
 * es que el requerimiento espere a un reintento. Contestar que no crearía una
 * segunda orden, y el proveedor recibiría el mismo pedido dos veces — que es el
 * error más caro de todos los posibles acá.
 */
async function existeEnOdoo(odooOrderId: number): Promise<boolean> {
  try {
    const filas = await buscarLeer("purchase.order", [["id", "=", odooOrderId]], ["name"]);
    return filas.length > 0;
  } catch {
    return true;
  }
}

function textoDelProblema(p: Problema): string {
  return p.detalle;
}

/**
 * Lo que hay que tener **antes** de mirar Odoo: proveedor elegido y cotización.
 *
 * Vive aparte porque el push y el ensayo tienen que dar el **mismo**
 * diagnóstico, y no lo daban. El ensayo del RI 1933 dijo "el proveedor no existe
 * en POLCECAL, hay que darlo de alta ahí" cuando la verdad era que el
 * requerimiento no tenía proveedor: el presupuesto de Casa Camino estaba
 * cargado pero nunca se eligió. Mandar a alguien a dar de alta un proveedor que
 * ya está enlazado es peor que no decir nada.
 */
function problemasPrevios(ri: Pick<FilaRequerimiento, "nro_ri" | "proveedor_id">): string[] {
  if (!ri.proveedor_id) {
    return [
      `El RI ${ri.nro_ri} no tiene proveedor. Lo carga el encargado de compras en ` +
        `Gestión de compra, o sale de confirmar la elección en la comparativa.`,
    ];
  }

  return [];
}

/**
 * De dónde sale el precio de la orden.
 *
 * Los dos caminos del grupo, en orden de preferencia:
 *
 *  1. **El presupuesto elegido**, si hay: trae el unitario neto tal como lo
 *     cotizó el proveedor, con su descuento y su moneda.
 *  2. **El "Costo + IVA" del requerimiento**, que es el camino habitual: Maxi o
 *     Nico aprueban, le informan la elección al encargado de compras, y él la
 *     registra al pasar el pedido a *pedido*. Ese campo es el total **con** IVA,
 *     así que hay que sacarle el neto — mandarlo tal cual cobraría el IVA dos
 *     veces.
 *
 * Antes sólo existía el camino 1, y como el circuito real no produce
 * presupuestos elegidos, la orden no se generaba nunca.
 */
function precioParaLaOrden(
  ri: FilaRequerimiento,
  elegida: {
    precio_unitario: number | null;
    cantidad: number | null;
    descuento: number | null;
    costo_envio: number | null;
    moneda: string | null;
  } | null
): { ok: true; precio: CotizacionParaOrden; origen: string } | { ok: false; motivo: string } {
  if (elegida) {
    return {
      ok: true,
      origen: "presupuesto elegido en la comparativa",
      precio: {
        precioUnitario: elegida.precio_unitario,
        cantidad: elegida.cantidad,
        descuento: elegida.descuento,
        costoEnvio: elegida.costo_envio,
        moneda: elegida.moneda,
      },
    };
  }

  const desdeElRi = precioDesdeElRequerimiento({
    costoIva: ri.costo_iva,
    costoEnvio: ri.costo_envio,
    cantidad: ri.cantidad,
  });

  if (!desdeElRi.ok) return { ok: false, motivo: desdeElRi.motivo };

  return {
    ok: true,
    origen: `costo + IVA cargado en el requerimiento (neto sacado con IVA ${Math.round(desdeElRi.precio.iva * 100)}%)`,
    precio: {
      precioUnitario: desdeElRi.precio.precioUnitario,
      cantidad: desdeElRi.precio.cantidad,
      // El descuento ya está dentro del costo que cargó el encargado.
      descuento: null,
      costoEnvio: desdeElRi.precio.costoEnvio,
      // `costo_iva` lo escribe `costosParaElPedido` siempre en pesos.
      moneda: "ARS",
    },
  };
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
      "id, nro_ri, descripcion, codigo, cantidad, empresa_id, paga_ambas, fecha_necesidad, proveedor_id, costo_iva, costo_envio, moneda"
    )
    .eq("id", requerimientoId)
    .maybeSingle<FilaRequerimiento>();

  if (!ri) return { error: "No existe ese requerimiento." };

  const [{ data: cotizacion }, { data: empresas }, { data: yaCreadas }] = await Promise.all([
    admin
      .from("compras_cotizaciones")
      .select("precio_unitario, cantidad, descuento, costo_envio, moneda")
      .eq("requerimiento_id", ri.id)
      .eq("elegida", true)
      .maybeSingle(),
    admin.from("empresas").select("id, nombre, odoo_company_id").order("nombre"),
    admin
      .from("compras_odoo_ordenes")
      .select("empresa_id, odoo_order_id, odoo_nombre")
      .eq("requerimiento_id", ri.id),
  ]);

  /*
   * El mismo diagnóstico que el push, y antes de mirar Odoo. Sin esto el ensayo
   * decía "el proveedor no existe en POLCECAL" cuando el requerimiento no tenía
   * proveedor ninguno, y encima consultaba `proveedores_odoo` con un uuid vacío.
   */
  const previos = problemasPrevios(ri);
  if (previos.length) {
    return { requerimiento: { nroRi: ri.nro_ri, descripcion: ri.descripcion }, yaCreadas, problemas: previos };
  }

  const fuente = precioParaLaOrden(ri, cotizacion);
  if (!fuente.ok) {
    return {
      requerimiento: { nroRi: ri.nro_ri, descripcion: ri.descripcion },
      yaCreadas,
      problemas: [fuente.motivo],
    };
  }

  const { data: enlaces } = await admin
    .from("proveedores_odoo")
    .select("empresa_id, odoo_partner_id")
    .eq("proveedor_id", ri.proveedor_id!);

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
    fuente.precio,
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

  /*
   * El ensayo dice **de dónde sale el precio** y qué va a totalizar la orden,
   * además de los vals. Con el costo cargado a mano el neto se calcula sacándole
   * el IVA, y el redondeo a los dos decimales de Odoo puede correr unos
   * centavos: eso se ve acá antes de mandar nada, no en Odoo tres semanas
   * después.
   */
  const aprobado =
    ri.costo_iva !== null ? Math.round(((ri.costo_iva ?? 0) + (ri.costo_envio ?? 0)) * 100) / 100 : null;

  return {
    requerimiento: { nroRi: ri.nro_ri, descripcion: ri.descripcion, pagaAmbas: ri.paga_ambas },
    precio: { origen: fuente.origen, ...fuente.precio, costoAprobadoEnElRi: aprobado },
    cotizacion,
    yaCreadas,
    contexto: contexto.contexto,
    // Lo que se le mandaría a Odoo, tal cual, sin mandarlo.
    armado,
  };
}
