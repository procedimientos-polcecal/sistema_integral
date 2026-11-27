import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarCompras } from "@/lib/compras/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { exportarRequerimiento, nuevoCacheSheets } from "@/lib/compras/sheets";
import { leerComparativa, agregarFilas, asegurarLaColumnaDelId, urlDePlanilla } from "@/lib/compras/drive";
import { cotizacionDeHoy } from "@/lib/compras/dolar";
import { mapearEncabezados, filaParaPlanilla } from "@/lib/compras/comparativa";
import { comparativaCongelada, tienePresupuestoElegido } from "@/lib/compras/congelada";
import {
  validarLaCarga, planillaDeCadaRenglon, renglonesYaCargados, MINUTOS_DEL_FRENO,
  type Renglon,
} from "@/lib/compras/cargaDePresupuestos";

/** Escribir una planilla por renglón y drenar el master cuesta tiempo. */
export const maxDuration = 120;

/** Un `.in()` con muchos ids arma una URL que PostgREST rechaza con un 400. */
const MAXIMO_DE_RENGLONES = 100;

/** Lo que se copia del renglón a `compras_cotizaciones`, si vino. */
const CAMPOS = [
  "marca", "unidad_medida", "precio_unitario", "cantidad", "costo_envio",
  "descuento", "iva", "precio_hasta", "plazos_pago_dias", "condiciones_pago",
  "disponibilidad", "comentario", "moneda",
] as const;

/**
 * Lo que queda anotado mientras el avance a comparativa no llegó al master.
 * Si la pasada de `after()` se corta, esto es lo que encuentra el cron.
 */
const PENDIENTE_DEL_AVANCE = "el avance a comparativa todavía no se exportó al master";

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Carga de una vez la respuesta de un proveedor, que suele cubrir varios
 * pedidos del mismo artículo.
 *
 * El orden es la decisión: **se valida todo antes de escribir nada** —si un
 * pedido está congelado o sin aprobar no se guarda ninguno— y recién entonces se
 * inserta, se escribe la planilla de cada artículo con **un solo**
 * `agregarFilas` por planilla (la cuota de lectura de Google es de 60 por minuto
 * y la comparten todos los módulos), y se vincula la planilla al pedido que no
 * tenía.
 *
 * **Lo que cuesta de verdad cada planilla, para poder razonar contra esa cuota:
 * 3 o 4 lecturas y de 1 a 3 escrituras.** Las lecturas son la cabecera y los
 * valores de `leerComparativa`, la columna A de `proximaFilaLibre`, y una cuarta
 * de `asegurarColumnas` la primera vez que se escribe en esa planilla. Las
 * escrituras son el bloque de filas, más el encabezado `ID SISTEMA` y el
 * ensanchado de la hoja si la columna no existía. Lo que sí se cumple, y es lo
 * que importa, es que **nada de eso es por renglón**: siete renglones en una
 * planilla cuestan lo mismo que uno.
 *
 * Antes de insertar hay un freno contra el reenvío: ver el paso «1 bis».
 *
 * Si Drive falla, lo que se cargó **queda guardado** y el fallo vuelve en
 * `aviso_drive` con lo que dijo Google, sin traducir. No se anota ningún
 * pendiente porque no hay dónde: `compras_cotizaciones` no tiene columna de
 * pendiente y el `sheets_pendiente` del pedido es del master.
 *
 * El avance de estado (`SIN_INICIAR` a `EN_COMPARATIVA`) sí se refleja en el
 * master, por la cola de `exportarRequerimiento`, y **en una sola pasada para
 * toda la carga** dentro de `after()`: una pasada por renglón es lo que agotó la
 * cuota de lectura el 26/11/2026.
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenés permiso para gestionar la compra" }, { status: 403 });
  }

  const body = await cuerpoJson<{
    proveedor_id?: string | null;
    fecha_respuesta?: string | null;
    comparativa_drive_id?: string | null;
    renglones?: Array<Record<string, unknown>>;
  }>(request);

  const proveedorId = body.proveedor_id || null;
  const fecha = typeof body.fecha_respuesta === "string" && FECHA_ISO.test(body.fecha_respuesta)
    ? body.fecha_respuesta
    : null;
  const planillaDelEncabezado = body.comparativa_drive_id || null;
  const crudos = Array.isArray(body.renglones) ? body.renglones : [];

  if (crudos.length > MAXIMO_DE_RENGLONES) {
    return NextResponse.json(
      { error: `Una carga admite hasta ${MAXIMO_DE_RENGLONES} presupuestos` },
      { status: 400 }
    );
  }

  const renglones = crudos.map((c) => ({
    ...c,
    requerimiento_id: String(c.requerimiento_id ?? ""),
    // Un campo vacío no es un cero: llega como NaN y la validación lo nombra.
    precio_unitario: c.precio_unitario === null || c.precio_unitario === undefined || c.precio_unitario === ""
      ? Number.NaN
      : Number(c.precio_unitario),
  })) as unknown as Renglon[];

  const admin = createAdminClient();
  const ids = [...new Set(renglones.map((r) => r.requerimiento_id).filter(Boolean))];

  // ── 1. Validar todo, antes de escribir nada ───────────────────────────────
  const { data: pedidos, error: errorDePedidos } = ids.length > 0
    ? await admin
        .from("compras_requerimientos")
        // El select va en un solo literal: partido en dos, Supabase no lo puede analizar.
        .select("id, nro_ri, descripcion, estado_compra, estado_aprobacion, comparativa_drive_id, proveedor_id, hoja_origen, compras_areas(nombre)")
        .in("id", ids)
    : { data: [], error: null };
  // Sin esto, una consulta caída dejaba a todos los pedidos como «no existe»
  // y contestaba un 409 que mandaba a buscar el problema donde no estaba.
  if (errorDePedidos) {
    return NextResponse.json(
      { error: "No se pudieron leer los pedidos: " + errorDePedidos.message },
      { status: 500 }
    );
  }
  const pedidoPorId = new Map((pedidos ?? []).map((p) => [p.id as string, p]));

  const nombreDe = (id: string) => {
    const p = pedidoPorId.get(id);
    return p ? `RI ${p.nro_ri}` : `pedido ${id}`;
  };

  const problemas = validarLaCarga({ proveedorId, fecha, renglones, nombreDe });
  if (problemas.length > 0) {
    return NextResponse.json({ error: problemas.join(". "), errores: problemas }, { status: 400 });
  }

  const delPedido: string[] = [];
  for (const id of ids) {
    const p = pedidoPorId.get(id);
    if (!p) {
      delPedido.push(`El pedido ${id} no existe`);
      continue;
    }
    if (p.estado_aprobacion !== "APROBADA") {
      delPedido.push(`${nombreDe(id)} tiene que estar aprobado antes de cargar presupuestos`);
      continue;
    }
    const congelada = comparativaCongelada({
      estadoCompra: p.estado_compra as string,
      proveedorId: (p.proveedor_id ?? null) as string | null,
      hayPresupuestoElegido: await tienePresupuestoElegido(admin, id),
    });
    if (congelada) delPedido.push(`${nombreDe(id)}: la comparativa quedó congelada al aprobarse la compra`);
  }
  if (delPedido.length > 0) {
    return NextResponse.json(
      { error: delPedido.join(". ") + ". No se cargó ninguno.", errores: delPedido },
      { status: 409 }
    );
  }

  // ── 1 bis. El freno contra el doble envío ─────────────────────────────────
  //
  // La pantalla cubre el doble click, la recarga, el botón atrás y el 201. Lo
  // que no cubre son **dos pestañas** —o la misma carga en el teléfono y en la
  // computadora— y el «Ya los revisé» apretado sobre un 502 que sí había
  // guardado. Los dos insertan todo de nuevo y reescriben las filas en Drive, y
  // la comparativa pasa a compararse contra sí misma.
  //
  // No es un `unique`: la migración 026 permite a propósito dos marcas del mismo
  // proveedor para el mismo pedido y ya hay 7 pares repetidos en la base. Por
  // eso el freno lleva el precio adentro — el caso legítimo no se parece a un
  // reenvío — y una ventana corta. Si la consulta falla no se frena nada: no se
  // rechaza una carga por no poder comprobar que no es un duplicado.
  const desde = new Date(Date.now() - MINUTOS_DEL_FRENO * 60_000).toISOString();
  const { data: recientes, error: errorDeRecientes } = ids.length > 0
    ? await admin
        .from("compras_cotizaciones")
        .select("requerimiento_id, precio_unitario")
        .in("requerimiento_id", ids)
        .eq("proveedor_id", proveedorId)
        .eq("fecha_respuesta", fecha)
        .gte("created_at", desde)
    : { data: [], error: null };

  if (errorDeRecientes) {
    console.error("No se pudo comprobar si la carga es un reenvío:", errorDeRecientes.message);
  } else {
    const repetidos = renglonesYaCargados({ renglones, recientes: recientes ?? [], nombreDe });
    if (repetidos.length > 0) {
      const queHacer =
        "Parece la misma carga mandada dos veces, así que no se cargó ninguno. " +
        "Si de verdad es otra cotización del mismo proveedor —otra marca, por ejemplo—, " +
        `esperá ${MINUTOS_DEL_FRENO} minutos y volvé a mandarla, o cargala desde la ficha del pedido.`;
      return NextResponse.json(
        { error: repetidos.join(". ") + ". " + queHacer, errores: [...repetidos, queHacer] },
        { status: 409 }
      );
    }
  }

  // ── 2. Guardar: una fila por renglón ──────────────────────────────────────
  const filas = renglones.map((r) => {
    const registro: Record<string, unknown> = {
      requerimiento_id: r.requerimiento_id,
      proveedor_id: proveedorId,
      origen: "app",
      created_by: user.id,
      fecha_respuesta: fecha,
    };
    const crudo = r as unknown as Record<string, unknown>;
    for (const campo of CAMPOS) {
      // Lo que no vino no se manda: los defaults de la base (IVA 21%) son los
      // que mandan, no un cero inventado acá.
      if (crudo[campo] !== undefined) registro[campo] = crudo[campo] === "" ? null : crudo[campo];
    }
    return registro;
  });

  const { data: guardadas, error } = await admin
    .from("compras_cotizaciones")
    .insert(filas)
    .select("*, proveedores(nombre)");

  if (error || !guardadas) {
    return NextResponse.json({ error: error?.message ?? "No se pudo guardar la carga" }, { status: 400 });
  }
  const cotizacionDe = new Map(guardadas.map((c) => [c.requerimiento_id as string, c]));

  const avisos: string[] = [];

  // ── 3. El avance de estado: cargar el primer presupuesto pone el pedido en
  //       comparativa, que es el trabajo que ese estado describe.
  const avanzados = ids.filter((id) => pedidoPorId.get(id)?.estado_compra === "SIN_INICIAR");
  if (avanzados.length > 0) {
    const { error: errorDeEstado } = await admin
      .from("compras_requerimientos")
      .update({ estado_compra: "EN_COMPARATIVA" })
      .in("id", avanzados);

    if (errorDeEstado) {
      avisos.push(
        `No se pudo pasar a comparativa ${avanzados.map(nombreDe).join(", ")}: ${errorDeEstado.message}. ` +
        "Los presupuestos quedaron cargados."
      );
    } else {
      // El pendiente se anota ANTES de exportar, y `exportarRequerimiento` lo
      // limpia cuando escribe bien. Anotarlo sólo en el `catch` dejaba sin
      // rastro lo que corta `maxDuration` a mitad de la pasada: el master
      // quedaba en SIN_INICIAR para siempre. Respeta el guardarraíl de la
      // exportación: sólo si el pedido ya llegó a la planilla (`hoja_origen`),
      // porque el pendiente de uno que no llegó es del alta.
      const conPlanilla = avanzados.filter((id) => pedidoPorId.get(id)?.hoja_origen);
      if (conPlanilla.length > 0) {
        const { error: errorDePendiente } = await admin
          .from("compras_requerimientos")
          .update({
            sheets_pendiente: PENDIENTE_DEL_AVANCE,
            sheets_intentado_en: new Date().toISOString(),
          })
          .in("id", conPlanilla);
        if (errorDePendiente) {
          avisos.push(
            `No se pudo anotar que el master tiene que enterarse del avance de ${conPlanilla.map(nombreDe).join(", ")}: ` +
            errorDePendiente.message
          );
        }
      }

      // Una sola pasada para toda la carga, con un solo caché: es lo que cuida
      // la cuota de lectura.
      after(async () => {
        const cache = nuevoCacheSheets();
        for (const id of avanzados) {
          try {
            await exportarRequerimiento(id, cache);
          } catch (e) {
            const motivo = e instanceof Error ? e.message : String(e);
            console.error(`No se pudo escribir el RI ${id} en la planilla:`, motivo);
            // El motivo de verdad reemplaza al genérico, pero sólo con el
            // guardarraíl puesto: `hoja_origen` nulo es el pendiente del alta.
            await admin
              .from("compras_requerimientos")
              .update({
                sheets_pendiente: `no se pudo exportar el avance a comparativa: ${motivo}`,
                sheets_intentado_en: new Date().toISOString(),
              })
              .eq("id", id)
              .not("hoja_origen", "is", null);
          }
        }
      });
    }
  }

  // ── 4. La planilla de cada artículo: un agregarFilas por planilla ─────────
  const planillaPorRi: Record<string, string | null> = {};
  for (const id of ids) planillaPorRi[id] = (pedidoPorId.get(id)?.comparativa_drive_id ?? null) as string | null;
  const destinos = planillaDeCadaRenglon(renglones, planillaDelEncabezado, planillaPorRi);

  const sinPlanilla = ids.filter((id) => !planillaPorRi[id] && !planillaDelEncabezado);
  if (sinPlanilla.length > 0) {
    avisos.push(
      `${sinPlanilla.map(nombreDe).join(", ")}: no tiene una comparativa vinculada, ` +
      "así que no se escribió en ninguna planilla."
    );
  }

  // El dólar se pide una sola vez, y sólo si algún renglón lo necesita.
  let dolarDelDia: number | null = null;
  const enDolares = guardadas
    .filter((c) => c.moneda === "USD" && !c.cotizacion)
    .map((c) => c.requerimiento_id as string);
  if (enDolares.length > 0) {
    try {
      dolarDelDia = (await cotizacionDeHoy())?.venta ?? null;
      if (dolarDelDia === null) {
        avisos.push(`No hay cotización del dólar: no se escribió en la planilla ${enDolares.map(nombreDe).join(", ")}.`);
      }
    } catch (e) {
      avisos.push(
        `No se pudo obtener el dólar del día: no se escribió en la planilla ${enDolares.map(nombreDe).join(", ")}: ` +
        (e instanceof Error ? e.message : String(e))
      );
    }
  }

  const nombresDe = (xs: string[]) => xs.map(nombreDe).join(", ");

  for (const [planillaId, idsDeLaPlanilla] of destinos) {
    try {
      const planilla = await leerComparativa(planillaId);
      const mapeo = mapearEncabezados(planilla.encabezado);
      if (!mapeo.ok) {
        avisos.push(
          `La planilla de ${nombresDe(idsDeLaPlanilla)} no tiene la forma esperada ` +
          `(faltan ${mapeo.faltan.join(", ")}): no se escribió ahí.`
        );
        continue;
      }

      // La columna del id tiene que existir ANTES de escribir las filas.
      const idxIdSistema = await asegurarLaColumnaDelId(
        planillaId, planilla.pestana, planilla.encabezado, planilla.filas
      );

      const escritas = idsDeLaPlanilla.filter((id) => {
        const c = cotizacionDe.get(id);
        // Un dólar sin cotización no se escribe: un número en la moneda
        // equivocada es peor que no escribirlo.
        return !(c?.moneda === "USD" && !c.cotizacion && dolarDelDia === null);
      });
      if (escritas.length === 0) continue;

      // La fila inicial la decide `agregarFilas` y las fórmulas del total se
      // arman con ese mismo número.
      const primera = await agregarFilas(planillaId, planilla.pestana, (filaInicial) =>
        escritas.map((id, i) => {
          const c = cotizacionDe.get(id)!;
          const p = pedidoPorId.get(id)!;
          const area = p.compras_areas as unknown as { nombre: string } | null;
          return filaParaPlanilla({
            idx: mapeo.idx,
            numeroFila: filaInicial + i,
            nroRi: p.nro_ri as number,
            // La fecha de la respuesta del proveedor, nunca la del pedido.
            fecha: (c.fecha_respuesta as string | null) ?? hoyEnArgentina(),
            // Tal cual, sin adornos: al releer, `esEcoDelSistema` lo compara
            // contra `String(cotizacion.id)` y si no coincide se duplica.
            idCotizacion: String(c.id),
            idxIdSistema,
            area: area?.nombre ?? null,
            descripcion: p.descripcion as string | null,
            moneda: c.moneda,
            dolar: c.moneda === "USD" ? (c.cotizacion ?? dolarDelDia) : null,
            cotizacion: {
              proveedor_nombre: c.proveedores?.nombre ?? "",
              marca: c.marca,
              unidad_medida: c.unidad_medida,
              precio_unitario: c.precio_unitario,
              cantidad: c.cantidad,
              costo_envio: c.costo_envio,
              descuento: c.descuento,
              iva: c.iva,
              precio_hasta: c.precio_hasta,
              plazos_pago_dias: c.plazos_pago_dias ?? [],
              condiciones_pago: c.condiciones_pago,
              disponibilidad: c.disponibilidad,
              comentario: c.comentario,
            },
          });
        })
      );

      // Dónde quedó cada fila, y la planilla vinculada al pedido que no tenía.
      // Supabase no lanza: devuelve `{ error }`. Si `drive_fila` no se guarda, la
      // fila queda escrita en la planilla pero ni borrar ni corregir la podrían
      // vaciar después, y por eso se dice cuál.
      await Promise.all(escritas.map(async (id, i) => {
        const { error: errorDeFila } = await admin
          .from("compras_cotizaciones")
          .update({ drive_fila: primera + i })
          .eq("id", cotizacionDe.get(id)!.id);
        if (errorDeFila) {
          avisos.push(
            `${nombreDe(id)} se escribió en la fila ${primera + i} de su planilla pero no se pudo guardar ese número: ` +
            errorDeFila.message
          );
        }
        if (!planillaPorRi[id]) {
          // Nombre y enlace van con el id, como en la ruta de vincular: sin
          // ellos la ficha no tiene a dónde llevar y `vincular` lo toma por «no leído».
          const { error: errorDeVinculo } = await admin
            .from("compras_requerimientos")
            .update({
              comparativa_drive_id: planillaId,
              comparativa_nombre: planilla.nombre || null,
              comparativa_url: urlDePlanilla(planillaId),
            })
            .eq("id", id)
            .is("comparativa_drive_id", null);
          if (errorDeVinculo) {
            avisos.push(`No se pudo vincular la planilla a ${nombreDe(id)}: ${errorDeVinculo.message}`);
          }
        }
      }));
    } catch (e) {
      avisos.push(
        `No se escribió en la planilla de ${nombresDe(idsDeLaPlanilla)}: ` +
        (e instanceof Error ? e.message : String(e))
      );
    }
  }

  const avisoDrive = avisos.length > 0
    ? "La carga se guardó, pero quedó algo sin hacer: " + avisos.join(" · ")
    : null;

  return NextResponse.json(
    {
      cargadas: guardadas.length,
      cotizaciones: guardadas,
      ...(avisoDrive ? { aviso_drive: avisoDrive } : {}),
    },
    { status: 201 }
  );
}
