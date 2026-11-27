/**
 * La carga de la respuesta de un proveedor que cubre varios pedidos.
 *
 * Tres funciones puras, para poder probar lo que la ruta decide sin Supabase ni
 * Google. La ruta (`app/api/compras/presupuestos`) las usa en este orden:
 * valida todo, y recién después escribe.
 */

export type Renglon = {
  requerimiento_id: string;
  precio_unitario: number;
  cantidad: number | null;
  marca: string | null;
  unidad_medida: string | null;
  descuento: number;
  iva: number;
  /** Las cuotas en días: la columna es `integer[]`, no un número. */
  plazos_pago_dias: number[] | null;
  condiciones_pago: string | null;
  disponibilidad: string | null;
  comentario: string | null;
  costo_envio: number | null;
  precio_hasta: string | null;
  moneda: string | null;
};

/**
 * Los problemas de la carga, **todos juntos**: quien la arma en la pantalla
 * corrige de una vez y no descubre el segundo error después de arreglar el
 * primero.
 *
 * `nombreDe` sólo sirve para decir «RI 1865» en vez de un id; sin él se nombra
 * el id, que es lo único que esta función sabe del pedido.
 */
export function validarLaCarga(args: {
  proveedorId: string | null;
  fecha: string | null;
  renglones: Renglon[];
  nombreDe?: (requerimientoId: string) => string;
}): string[] {
  const { proveedorId, fecha, renglones } = args;
  const nombre = args.nombreDe ?? ((id: string) => `pedido ${id}`);
  const problemas: string[] = [];

  if (!proveedorId) problemas.push("Hay que elegir el proveedor");
  if (!fecha) problemas.push("Hay que indicar la fecha de la respuesta");
  if (renglones.length === 0) problemas.push("Hay que cargar al menos un presupuesto");

  const sinPedido = renglones.filter((r) => !r.requerimiento_id).length;
  if (sinPedido > 0) {
    problemas.push(
      sinPedido === 1
        ? "Hay un presupuesto sin pedido: falta elegir a qué pedido corresponde"
        : `Hay ${sinPedido} presupuestos sin pedido: falta elegir a qué pedido corresponde cada uno`
    );
  }

  const vistos = new Set<string>();
  const repetidos = new Set<string>();
  for (const r of renglones) {
    if (!r.requerimiento_id) continue;
    if (vistos.has(r.requerimiento_id)) repetidos.add(r.requerimiento_id);
    vistos.add(r.requerimiento_id);
  }
  for (const id of repetidos) {
    problemas.push(`El ${nombre(id)} figura dos veces en la carga`);
  }

  for (const r of renglones) {
    if (!r.requerimiento_id) continue;
    if (typeof r.precio_unitario !== "number" || !Number.isFinite(r.precio_unitario) || r.precio_unitario < 0) {
      problemas.push(`Falta el precio unitario del ${nombre(r.requerimiento_id)}`);
    }
  }

  return problemas;
}

/** Cuánto tiempo atrás se mira para decidir que una carga es la misma. */
export const MINUTOS_DEL_FRENO = 2;

/** Lo que hace falta de una cotización recién insertada para compararla. */
export interface CotizacionReciente {
  requerimiento_id: string;
  /** `numeric` puede volver como texto según el cliente de PostgREST. */
  precio_unitario: number | string | null;
}

/**
 * Qué renglones de esta carga son idénticos a uno insertado recién.
 *
 * **El freno contra el doble envío, del lado del servidor.** La pantalla cubre
 * el doble click, la recarga, el botón atrás y el 201, pero no cubre dos
 * pestañas abiertas —o la misma carga hecha en el teléfono y en la
 * computadora—, ni el «Ya los revisé» apretado sobre un 502 que en realidad
 * había guardado. Los dos insertan todo de nuevo y reescriben las filas en
 * Drive, y la comparativa pasa a compararse contra sí misma: el anti-objetivo
 * escrito en el spec.
 *
 * **No es un `unique`, a propósito.** La migración 026 sacó
 * `unique(requerimiento_id, proveedor_id)` porque el mismo proveedor puede
 * cotizar dos marcas para el mismo pedido —hay 7 pares repetidos en la base—, y
 * esos dos presupuestos tienen precios distintos. Por eso la comparación lleva
 * el precio adentro: el caso legítimo no se parece a un reenvío.
 *
 * `recientes` ya viene filtrado por proveedor, fecha de respuesta y ventana de
 * tiempo; acá se cruza lo que queda.
 */
export function renglonesYaCargados(args: {
  renglones: Renglon[];
  recientes: CotizacionReciente[];
  nombreDe?: (requerimientoId: string) => string;
}): string[] {
  const nombre = args.nombreDe ?? ((id: string) => `pedido ${id}`);

  const yaEstan = new Map<string, Set<number>>();
  for (const c of args.recientes) {
    if (c.precio_unitario === null) continue;
    const precio = Number(c.precio_unitario);
    if (!Number.isFinite(precio)) continue;
    const precios = yaEstan.get(c.requerimiento_id) ?? new Set<number>();
    precios.add(precio);
    yaEstan.set(c.requerimiento_id, precios);
  }

  const problemas: string[] = [];
  for (const r of args.renglones) {
    if (!r.requerimiento_id) continue;
    if (!yaEstan.get(r.requerimiento_id)?.has(Number(r.precio_unitario))) continue;
    problemas.push(
      `${nombre(r.requerimiento_id)}: ya hay un presupuesto de este proveedor con el mismo ` +
      `precio (${r.precio_unitario}) y la misma fecha, cargado hace menos de ` +
      `${MINUTOS_DEL_FRENO} minutos`
    );
  }
  return problemas;
}

/**
 * Agrupa los pedidos por la planilla de comparativa donde va su fila.
 *
 * Un pedido que ya tiene planilla escribe en la suya y no en la del encabezado:
 * una respuesta puede cubrir artículos que se comparan en libros distintos
 * (el 4% que cruza artículos). Sin planilla propia usa la del encabezado, y si
 * tampoco hay, no va a ninguna —la ruta lo avisa, no lo inventa—.
 *
 * Devuelve ids de pedido por id de planilla, en el orden en que llegaron.
 */
export function planillaDeCadaRenglon(
  renglones: Renglon[],
  planillaDelEncabezado: string | null,
  planillaPorRi: Record<string, string | null | undefined>
): Map<string, string[]> {
  const porPlanilla = new Map<string, string[]>();
  for (const r of renglones) {
    const destino = planillaPorRi[r.requerimiento_id] || planillaDelEncabezado;
    if (!destino) continue;
    const lista = porPlanilla.get(destino) ?? [];
    lista.push(r.requerimiento_id);
    porPlanilla.set(destino, lista);
  }
  return porPlanilla;
}
