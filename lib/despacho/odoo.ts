import { buscarLeer, idDeRelacion, nombreDeRelacion, type Registro } from "@/lib/odoo/client";
import { separarCodigoYNombre } from "./clasificacion";
import type { RemitoDeOdoo } from "./types";

/**
 * Los remitos de salida de Odoo, que es de donde sale la mitad de una orden de
 * carga: cliente, producto y cantidad.
 *
 * **Acá el SdG sólo lee.** No crea remitos, no los valida, no toca un
 * `stock.picking`. Es la regla de `docs/ODOO-INTEGRACION.md`: el SdG propone y
 * Odoo confirma, y en este circuito no propone nada — la orden de carga vive del
 * lado del SdG porque en Odoo no tiene dónde (121 campos en `stock.picking`, un
 * único campo de Studio y es de otra cosa; la instancia es de un partner y no
 * admite módulos propios).
 *
 * TRES COSAS QUE NO SE NEGOCIAN
 *
 * 1. **No se filtra por estado.** Polcecal valida casi todo (552 `done` y 1
 *    `draft` en 90 días) pero Polysan deja colgado (19 `confirmed`, 20 `draft`),
 *    y el camión llega igual. Un filtro por `done` dejaría al encargado sin el
 *    remito que tiene en la mano. Los cancelados sí se sacan: ése no viaja.
 * 2. **El estado viaja hasta la pantalla.** Que un remito esté en draft es algo
 *    que quien da de alta la orden tiene que ver, no algo que se le esconda.
 * 3. **No se pide un día: se pide una ventana.** El primer diseño filtraba por
 *    `scheduled_date` del día, y eso deja afuera un remito de cada diez: se
 *    midió contra la base y **131 de 1.383 remitos tienen `scheduled_date` de un
 *    día distinto al de su creación** (105 de Polysan). Un camión cuyo remito
 *    quedó fechado otro día obligaría al encargado a cargarlo "sin remito",
 *    perdiendo el enlace justo cuando existe. Con siete días la lista son ~84
 *    remitos, que entran de una y se filtran en la pantalla.
 */

/** Sin `picking_type_code = outgoing` entran las recepciones y los traslados internos. */
const SALIDAS = ["picking_type_code", "=", "outgoing"] as const;

const CAMPOS = [
  "name",
  "partner_id",
  "origin",
  "scheduled_date",
  "date_done",
  "state",
  "company_id",
  "move_ids",
];

/** Cuántos días para atrás mira la lista del alta, por defecto. */
export const DIAS_DE_LA_VENTANA = 7;

/**
 * El rango de `scheduled_date` que se le pide a Odoo, en UTC.
 *
 * Va aparte y es pura para poder probarla: acá viven dos corrimientos que si se
 * equivocan no fallan, sólo devuelven la lista de otro día.
 *
 * - **Las tres horas de Argentina.** Odoo guarda los `datetime` en UTC, así que
 *   un día de calendario argentino va de las 03:00 UTC de ese día a las 02:59
 *   del siguiente. Pedirlo en hora local traería los de la noche anterior.
 * - **Un día para adelante.** Administración a veces emite el remito el día
 *   antes, y ese camión llega mañana: si la ventana termina hoy, su remito no
 *   está en la lista.
 */
export function rangoDeLaVentana(
  fecha: string,
  dias = DIAS_DE_LA_VENTANA
): { desde: string; hasta: string } {
  return {
    desde: `${sumarDias(fecha, -(dias - 1))} 03:00:00`,
    hasta: `${sumarDias(fecha, 2)} 02:59:59`,
  };
}

/**
 * Los remitos de salida de la ventana, con el producto y la cantidad de su
 * primera línea.
 *
 * `fecha` es un día de calendario de Argentina ("YYYY-MM-DD"). Se busca por
 * `scheduled_date`, que es la fecha con la que el remito se programó;
 * `date_done` no sirve porque los de Polysan que quedan en `confirmed` no la
 * tienen.
 *
 * Vienen **los más nuevos primero**: el camión que está en la puerta es casi
 * siempre de los últimos, y así el encargado no scrollea.
 */
export async function remitosParaElAlta(
  fecha: string,
  dias = DIAS_DE_LA_VENTANA
): Promise<RemitoDeOdoo[]> {
  const { desde, hasta } = rangoDeLaVentana(fecha, dias);

  const pickings = await buscarLeer<Registro>(
    "stock.picking",
    [
      SALIDAS,
      ["state", "!=", "cancel"],
      ["scheduled_date", ">=", desde],
      ["scheduled_date", "<=", hasta],
    ],
    CAMPOS,
    { orden: "scheduled_date desc", limite: 400 }
  );

  const lineas = await primeraLineaDeCadaRemito(pickings);

  return pickings.map((p) => {
    const linea = lineas.get(p.id);
    const producto = separarCodigoYNombre(nombreDeRelacion(linea?.product_id) ?? false);
    return {
      picking_id: p.id,
      nombre: String(p.name ?? ""),
      cliente: nombreDeRelacion(p.partner_id) ?? "",
      pedido: typeof p.origin === "string" && p.origin !== "" ? p.origin : null,
      odoo_company_id: idDeRelacion(p.company_id) ?? 0,
      estado: String(p.state ?? ""),
      producto: producto.nombre,
      odoo_product_id: linea ? idDeRelacion(linea.product_id) : null,
      cantidad: linea ? numeroDeOdoo(linea.product_uom_qty) : null,
      unidad: linea ? nombreDeRelacion(linea.product_uom) : null,
    };
  });
}

/**
 * Las líneas de los remitos, en **una** llamada.
 *
 * Un `stock.move.read` por remito serían 25 viajes a un Odoo que tarda, y el
 * cliente corta a los 30 segundos. Se piden todas juntas con un `in` sobre
 * `picking_id` —25 ids, muy lejos de la URL que PostgREST rechaza, y acá además
 * es JSON-RPC por POST, así que el límite no aplica— y se agrupan en memoria.
 *
 * Se guarda **la primera línea de cada remito y no la suma**: un remito de
 * despacho es un camión con un producto, y el papel del talonario tilda un
 * material. Si algún día aparece uno con dos productos, la orden va a mostrar el
 * primero y el remito completo sigue estando en Odoo — sumar dos productos
 * distintos en una cantidad sería inventar un número.
 */
async function primeraLineaDeCadaRemito(pickings: Registro[]): Promise<Map<number, Registro>> {
  const ids = pickings.map((p) => p.id);
  if (ids.length === 0) return new Map();

  const movimientos = await buscarLeer<Registro>(
    "stock.move",
    [["picking_id", "in", ids]],
    ["picking_id", "product_id", "product_uom_qty", "product_uom"],
    { orden: "id asc", limite: 1000 }
  );

  const porRemito = new Map<number, Registro>();
  for (const m of movimientos) {
    const remito = idDeRelacion(m.picking_id);
    if (remito !== null && !porRemito.has(remito)) porRemito.set(remito, m);
  }
  return porRemito;
}

/**
 * Los productos que Odoo tiene en remitos de salida, para la pantalla de mapeo.
 *
 * Se leen de `product.product` y no de `product.template`: la línea del remito
 * apunta a la variante, y es el id que guarda `despacho_productos`.
 */
export async function productosDeOdoo(ids: number[]): Promise<
  { odoo_product_id: number; codigo: string | null; nombre: string }[]
> {
  if (ids.length === 0) return [];
  const filas = await buscarLeer<Registro>(
    "product.product",
    [["id", "in", ids]],
    ["default_code", "name"],
    { limite: 1000 }
  );
  return filas.map((f) => ({
    odoo_product_id: f.id,
    codigo: typeof f.default_code === "string" && f.default_code !== "" ? f.default_code : null,
    // El nombre de esta base viene con espacios al final: "CAL EN TOLVA ".
    nombre: String(f.name ?? "").trim(),
  }));
}

/** Odoo devuelve `false` para lo ausente, y `Number(false)` es 0. */
function numeroDeOdoo(valor: unknown): number | null {
  return typeof valor === "number" ? valor : null;
}

/** Días sobre el texto de la fecha, para no arrastrar husos. */
function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
