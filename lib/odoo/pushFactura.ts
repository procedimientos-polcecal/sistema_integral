import type { SupabaseClient } from "@supabase/supabase-js";
import { crearEn, llamar, mensajeDeOdoo } from "./client";
import { resolverContextoDeFacturas } from "./contexto";
import { armarBorradorDeFactura, type BorradorArmado } from "@/lib/facturacion/borradorEnOdoo";
import { discriminaIva } from "@/lib/facturacion/comprobante";
import type { LineaDeFactura } from "@/lib/facturacion/lineas";
import { resolverElEmisor } from "./emisor";

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
  odoo_attachment_id: number | null;
  odoo_partner_id: number | null;
  detalle_leido: string | null;
  archivo_url: string | null;
  archivo_nombre: string | null;
  empresas: { nombre: string; odoo_company_id: number | null } | null;
  proveedores: { nombre: string } | null;
  compras_requerimientos: { nro_ri: number } | null;
}

export interface FacturaEmpujada {
  odooMoveId: number;
  /** Cuántas líneas de detalle llevó. 0 = una sola por el total. */
  lineas: number;
  /** Si el PDF quedó adjunto al asiento. */
  adjunto: boolean;
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
  "odoo_conciliado_por, odoo_pendiente, odoo_sincronizado_en, detalle_leido, odoo_attachment_id, " +
  "odoo_partner_id, odoo_partner_nombre, " +
  "archivo_url, archivo_nombre, " +
  "empresas!empresa_id(nombre, odoo_company_id), proveedores!proveedor_id(nombre), " +
  "compras_requerimientos!requerimiento_id(nro_ri)";

/**
 * Lo que le falta a la factura para poder armar un borrador.
 *
 * Se separa para poder contestarlo sin gastar un viaje de red, y porque casi
 * todos los motivos son cosas que alguien tiene que ir a arreglar a otra
 * pantalla: el mensaje dice cuál. Sirve igual para crear el borrador y para
 * actualizarlo; lo que cambia entre los dos —si el asiento tiene que existir o
 * no— lo mira cada uno.
 */
function problemasDeDatos(f: FilaDeFactura): string[] {
  const motivos: string[] = [];

  if (!f.empresa_id) {
    motivos.push("Falta decir a cuál de las dos empresas se le facturó.");
  } else if (!f.empresas?.odoo_company_id) {
    motivos.push(`La empresa ${f.empresas?.nombre ?? ""} no está mapeada a una empresa de Odoo.`);
  }

  /*
   * El proveedor del SdG **ya no es obligatorio**. Lo que la factura de Odoo
   * necesita es su propio `partner`, y eso se resuelve por CUIT contra Odoo —ver
   * `resolverElEmisor`—. Exigir el padrón del SdG dejaba afuera al 56% de las
   * facturas que entran.
   */
  if (!f.cuit_emisor && !f.proveedor_id) {
    motivos.push(
      "La factura no tiene ni CUIT del emisor ni proveedor, así que no hay con qué reconocer a quién facturó."
    );
  }

  return motivos;
}

/** Todo lo que hace falta para crear o reescribir el borrador de una factura. */
interface BorradorPreparado {
  factura: FilaDeFactura;
  companyId: number;
  lineas: LineaDeFactura[];
  borrador: BorradorArmado;
  avisos: string[];
}

type ResultadoDePreparar =
  | { ok: true; preparado: BorradorPreparado }
  | { ok: false; motivos: string[] };

/**
 * Leer la factura y armar los `vals`, sin escribir nada en Odoo.
 *
 * Lo comparten **crear** el borrador y **actualizarlo**: los dos mandan
 * exactamente lo mismo, y que salga de un solo lugar es lo que garantiza que un
 * borrador actualizado quede igual que uno recién creado. Si esto estuviera
 * duplicado, la imputación se perdería en una de las dos ramas y nadie lo
 * notaría hasta ver el asiento.
 */
async function prepararElBorrador(
  admin: SupabaseClient,
  facturaId: string
): Promise<ResultadoDePreparar> {
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
          ? `Falta aplicar una migración de Facturación: la base todavía no tiene esa columna. ${error.message}`
          : error.message,
      ],
    };
  }
  if (!data) return { ok: false, motivos: ["No existe esa factura."] };

  const factura = data as unknown as FilaDeFactura;

  const previos = problemasDeDatos(factura);
  if (previos.length) return { ok: false, motivos: previos };

  const companyId = factura.empresas!.odoo_company_id!;

  /*
   * A quién se le factura, en dos pasos:
   *
   * 1. **El enlace curado**, si la factura tiene proveedor del SdG y alguien ya
   *    lo emparejó con un partner de esa empresa. Es una decisión humana y gana.
   * 2. **El CUIT contra Odoo**, que es el caso mayoritario: el 56% de las
   *    facturas de 2026 vienen de alguien que no está en el padrón del SdG.
   */
  let partnerId: number | null = null;

  if (factura.proveedor_id) {
    const { data: enlace } = await admin
      .from("proveedores_odoo")
      .select("odoo_partner_id")
      .eq("proveedor_id", factura.proveedor_id)
      .eq("empresa_id", factura.empresa_id!)
      .maybeSingle();
    partnerId = (enlace?.odoo_partner_id as number | undefined) ?? null;
  }

  if (partnerId === null) {
    const emisor = await resolverElEmisor(factura.cuit_emisor, companyId);
    if (!emisor.partner) {
      return {
        ok: false,
        motivos: [
          `No se pudo reconocer al emisor en ${factura.empresas?.nombre ?? "esa empresa"}: ${emisor.motivo}` +
            (emisor.candidatos.length
              ? ` Candidatos: ${emisor.candidatos.map((c) => `${c.nombre} (#${c.id})`).join(", ")}.`
              : ""),
        ],
      };
    }
    partnerId = emisor.partner.id;

    /*
     * Se guarda a quién se reconoció para que el buzón lo muestre sin volver a
     * preguntarle a Odoo. El valor es para leer: el push lo resuelve de nuevo
     * cada vez, porque la empresa de la factura puede cambiar y el partner es
     * por empresa.
     */
    await admin
      .from("facturas_proveedor")
      .update({ odoo_partner_id: partnerId, odoo_partner_nombre: emisor.partner.nombre })
      .eq("id", facturaId);
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

  /*
   * El detalle **sólo si cuadra**. Una lectura que no cierra contra el neto es
   * peor que no tener detalle: el borrador saldría por un importe que no es el
   * de la factura, y eso lo tendría que descubrir alguien a mano.
   */
  let lineas: LineaDeFactura[] = [];
  if (factura.detalle_leido === "cuadra") {
    const { data } = await admin
      .from("facturas_proveedor_lineas")
      .select("*")
      .eq("factura_id", facturaId)
      .order("orden");
    lineas = (data ?? []) as unknown as LineaDeFactura[];
  }

  const armado = armarBorradorDeFactura(factura, {
    partnerId,
    diarioId: datos.diarioId,
    impuestoId: datos.impuestoId,
    monedaId,
    voucherTypeId:
      factura.tipo_comprobante === null
        ? null
        : (contexto.contexto.tiposPorCodigo[factura.tipo_comprobante] ?? null),
    nroRi: factura.compras_requerimientos?.nro_ri ?? null,
    lineas,
  });

  if (!armado.ok) return { ok: false, motivos: armado.problemas };

  const avisos: string[] = [];
  if (discriminaIva(factura.tipo_comprobante) && datos.impuestoId === null) {
    avisos.push(
      "La empresa no tiene configurado el IVA Compras 21%, así que el borrador quedó sin impuesto."
    );
  }

  return {
    ok: true,
    preparado: { factura, companyId, lineas, borrador: armado.borrador, avisos },
  };
}

/**
 * Crear el borrador en Odoo.
 *
 * Se niega si la factura ya tiene asiento: para eso está
 * `actualizarElBorradorEnOdoo`, que reescribe el que hay en vez de duplicarlo.
 */
export async function empujarFacturaAOdoo(
  admin: SupabaseClient,
  facturaId: string
): Promise<ResultadoDelPushDeFactura> {
  const preparado = await prepararElBorrador(admin, facturaId);
  if (!preparado.ok) return preparado;

  const { factura, companyId, lineas, borrador, avisos } = preparado.preparado;

  if (factura.odoo_move_id) {
    return {
      ok: false,
      motivos: [
        `Esta factura ya está en Odoo (id ${factura.odoo_move_id}). Crear otra la duplicaría: ` +
          `si lo que hace falta es mandarle los cambios, hay que actualizar ese borrador.`,
      ],
    };
  }
  if (factura.estado === "contabilizada") {
    return {
      ok: false,
      motivos: [
        "Esta factura ya figura como contabilizada, así que alguien la cargó en Odoo a mano. " +
          "Si hace falta el borrador igual, primero hay que sacarle ese estado.",
      ],
    };
  }

  let odooMoveId: number;
  try {
    odooMoveId = await crearEn("account.move", companyId, borrador.vals);
  } catch (e) {
    return { ok: false, motivos: [await anotarElFallo(admin, facturaId, e)] };
  }

  return await cerrarElPush(admin, facturaId, factura, odooMoveId, lineas, borrador, avisos, {
    esNuevo: true,
  });
}

/**
 * Reescribir en Odoo el borrador que ya existe, con lo que dice el SdG ahora.
 *
 * **Es la acción que faltaba, y su ausencia costó una factura mal contabilizada.**
 * El circuito natural es cargar la factura, crear el borrador para verlo, y
 * recién ahí imputar cada línea con su cuenta y su distribución analítica. Con
 * sólo "crear", esas correcciones quedaban en el SdG y nunca llegaban al asiento:
 * el borrador seguía siendo el de antes de imputar, y confirmarlo posteaba eso.
 *
 * Manda **los mismos `vals` que usaría un borrador nuevo** —salen de la misma
 * función— y reemplaza las líneas enteras con `(5, 0, 0)`. Reemplazar y no
 * parchear es a propósito: una línea que se borró del detalle tiene que
 * desaparecer del asiento, y emparejar línea por línea entre dos sistemas es
 * justo donde se cuelan los duplicados.
 *
 * Sólo sobre un borrador. Un asiento posteado es inmutable y esto no lo toca.
 */
export async function actualizarElBorradorEnOdoo(
  admin: SupabaseClient,
  facturaId: string
): Promise<ResultadoDelPushDeFactura> {
  const preparado = await prepararElBorrador(admin, facturaId);
  if (!preparado.ok) return preparado;

  const { factura, companyId, lineas, borrador, avisos } = preparado.preparado;

  if (!factura.odoo_move_id) {
    return { ok: false, motivos: ["Esta factura todavía no tiene un borrador en Odoo."] };
  }

  const [enOdoo] = await llamar<{ id: number; state: string }[]>("account.move", "read", [
    [factura.odoo_move_id],
    ["state"],
  ]).catch(() => []);

  if (!enOdoo) {
    return {
      ok: false,
      motivos: [`El asiento ${factura.odoo_move_id} ya no existe en Odoo.`],
    };
  }
  if (enOdoo.state !== "draft") {
    return {
      ok: false,
      motivos: [
        `Ese asiento está ${enOdoo.state === "posted" ? "posteado" : `en estado "${enOdoo.state}"`} ` +
          `y ya no se puede cambiar. Para corregirlo hay que volverlo a borrador en Odoo.`,
      ],
    };
  }

  try {
    await llamar(
      "account.move",
      "write",
      [
        [factura.odoo_move_id],
        {
          ...borrador.vals,
          // `(5, 0, 0)` borra las líneas que había antes de poner las nuevas.
          invoice_line_ids: [[5, 0, 0], ...(borrador.vals.invoice_line_ids as unknown[])],
        },
      ],
      { context: { allowed_company_ids: [companyId] } }
    );
  } catch (e) {
    return { ok: false, motivos: [await anotarElFallo(admin, facturaId, e)] };
  }

  return await cerrarElPush(
    admin,
    facturaId,
    factura,
    factura.odoo_move_id,
    lineas,
    borrador,
    avisos,
    { esNuevo: false }
  );
}

/**
 * Un fallo de escritura no es un `console.warn`: queda guardado con lo que dijo
 * Odoo, sin traducir, y se muestra en la pantalla de quien lo intentó. Es la
 * misma regla que `sheets_pendiente` y que el `odoo_pendiente` de las órdenes.
 */
async function anotarElFallo(
  admin: SupabaseClient,
  facturaId: string,
  e: unknown
): Promise<string> {
  const motivo = e instanceof Error ? e.message : mensajeDeOdoo(e as never);
  await admin
    .from("facturas_proveedor")
    .update({ odoo_pendiente: motivo, odoo_sincronizado_en: new Date().toISOString() })
    .eq("id", facturaId);
  return motivo;
}

/** Releer lo que quedó en Odoo, adjuntar el PDF si falta, y guardar el vínculo. */
async function cerrarElPush(
  admin: SupabaseClient,
  facturaId: string,
  factura: FilaDeFactura,
  odooMoveId: number,
  lineas: LineaDeFactura[],
  borrador: BorradorArmado,
  avisos: string[],
  opciones: { esNuevo: boolean }
): Promise<ResultadoDelPushDeFactura> {
  const [enOdoo] = await llamar<
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
  const totalEnOdoo = Number(enOdoo?.amount_total ?? 0);
  const totalDelComprobante = Math.abs(Number(factura.importe_total ?? 0));
  /*
   * El margen crece con la cantidad de líneas porque cada una puede aportar su
   * centavo de redondeo. Con margen fijo, toda factura de cuatro ítems traería
   * un aviso, y un aviso que aparece siempre deja de leerse.
   */
  const margen = Math.max(0.01, 0.01 * Math.max(1, lineas.length));
  if (Math.abs(totalEnOdoo - totalDelComprobante) > margen) {
    avisos.push(
      `El borrador quedó en ${totalEnOdoo} y el comprobante dice ${totalDelComprobante}: ` +
        `hay que ajustar la diferencia en Odoo antes de postear.`
    );
  }

  /*
   * Se guarda `full_voucher_name` ("FC A 0006-00010192") y no `name`: en
   * borrador el `name` es "/" y no le dice nada a nadie. Cuando la posteen, la
   * sincronización lo reemplaza por el BILL/2026/09/0004, que ahí sí existe.
   */
  const nombreParaMostrar = enOdoo?.full_voucher_name || enOdoo?.name || null;

  // Al actualizar, el PDF ya está adjunto salvo que la vez anterior fallara.
  const adjunto = factura.odoo_attachment_id
    ? factura.odoo_attachment_id
    : await adjuntarElArchivo(admin, factura, odooMoveId, avisos);

  await admin
    .from("facturas_proveedor")
    .update({
      odoo_move_id: odooMoveId,
      odoo_nombre: nombreParaMostrar,
      ...(adjunto ? { odoo_attachment_id: adjunto } : {}),
      odoo_estado: enOdoo?.state ?? "draft",
      ...(opciones.esNuevo ? { odoo_conciliado_por: "push", estado: "informada" } : {}),
      odoo_pendiente: null,
      odoo_sincronizado_en: new Date().toISOString(),
    })
    .eq("id", facturaId);

  return {
    ok: true,
    factura: {
      odooMoveId,
      lineas: borrador.lineas,
      adjunto: adjunto !== null,
      odooNombre: nombreParaMostrar,
      odooEstado: enOdoo?.state ?? "draft",
      totalEnOdoo,
      avisos,
    },
  };
}

/**
 * Subir el PDF del buzón como adjunto del asiento.
 *
 * Es el mismo archivo que el sistema escaneó, así que quien revisa el borrador
 * en Odoo tiene el comprobante a mano sin salir de ahí — que es medio trabajo de
 * revisar una factura.
 *
 * **No frena el push si falla.** El borrador ya existe y vale por sí solo; un
 * adjunto que no subió se avisa y se puede reintentar. Al revés —perder el
 * borrador porque el archivo pesaba de más— sería cambiar lo importante por lo
 * accesorio.
 */
async function adjuntarElArchivo(
  admin: SupabaseClient,
  factura: FilaDeFactura,
  odooMoveId: number,
  avisos: string[]
): Promise<number | null> {
  if (!factura.archivo_url) return null;

  try {
    const { data, error } = await admin.storage
      .from("facturas-proveedor")
      .download(factura.archivo_url);

    if (error || !data) throw new Error(error?.message ?? "no se pudo bajar el archivo");

    const base64 = Buffer.from(await data.arrayBuffer()).toString("base64");

    return await llamar<number>("ir.attachment", "create", [
      {
        name: factura.archivo_nombre || `${factura.cuit_emisor}.pdf`,
        type: "binary",
        datas: base64,
        res_model: "account.move",
        res_id: odooMoveId,
        mimetype: data.type || "application/pdf",
      },
    ]);
  } catch (e) {
    avisos.push(
      `El borrador se creó pero el PDF no se pudo adjuntar: ${e instanceof Error ? e.message : String(e)}`
    );
    return null;
  }
}
