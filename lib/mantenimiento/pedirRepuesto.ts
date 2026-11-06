/**
 * Pedir a Compras un repuesto que el pañol no tiene.
 *
 * La orden de trabajo ya consulta si hay stock. Cuando no hay, lo que sigue es
 * un requerimiento — y hasta ahora eso significaba abrir otra pantalla y
 * volver a escribir el nombre, el código y la cantidad que ya estaban acá. Ese
 * retipeo es donde el código se pierde y el RI termina diciendo "rodamiento"
 * a secas, que después nadie puede cruzar con nada.
 *
 * Acá se arma lo que el formulario de requerimiento va a mostrar ya completo.
 * **No lo envía**: quien pide revisa y confirma. El área y quién paga no se
 * adivinan —son decisiones de quien pide, y elegirlas por él es cómo un pedido
 * de Mantenimiento entra como si fuera de Producción—.
 */

import type { Disponibilidad, EstadoDeStock } from "@/lib/mantenimiento/stock";
import {
  ubicacionesDelEquipo, ubicacionesDelSector, type UbicacionEnlazada,
} from "@/lib/compras/ubicaciones";

/**
 * En qué casos tiene sentido ofrecer el pedido.
 *
 * `sin_dato` queda **afuera a propósito**. Es la celda de stock vacía: nadie lo
 * contó, y eso no es lo mismo que no haber. Sugerir un pedido ahí es
 * exactamente el error que el resto del sistema evita —"vacío no es cero, y
 * confundirlos manda a comprar algo que puede estar"—. Quien igual lo quiera
 * pedir tiene Mis pedidos.
 *
 * `bajo_minimo` sí entra: alcanza para este trabajo pero hay que reponer, y el
 * momento de darse cuenta es este.
 */
export function convienePedir(estado: EstadoDeStock): boolean {
  return estado === "no_hay" || estado === "no_esta" || estado === "bajo_minimo";
}

/** Lo que hace falta saber de la orden para armar el pedido. */
export interface OrdenDelPedido {
  ot_number: number | null;
  descripcion: string | null;
  equipment_id: string | null;
  equipo_raw: string | null;
  /** El sector de planta de la orden, para cuando la máquina no basta. */
  sector_id: string | null;
}

/** Un repuesto de la lista de la orden. */
export interface RepuestoPedido {
  nombre: string;
  codigo: string | null;
  /** Como se anotó: texto libre, porque en la planilla lo es. */
  cantidad: string | null;
}

/** Los campos del formulario de requerimiento, ya completos. */
export interface PedidoSugerido {
  descripcion: string;
  codigo: string;
  cantidad: string;
  detalle: string;
  /** La ubicación del catálogo de Compras, cuando se la puede saber. */
  ubicacionId: string;
  /** La máquina de la orden, para que el gasto quede contra ella. */
  equipoId: string;
  /** Mantenimiento, cuando el catálogo tiene un área con ese nombre. */
  areaId: string;
}

/**
 * La cantidad, si de lo anotado sale un número.
 *
 * El campo es texto libre —"2", "2 u.", "un juego"— porque la planilla lo es.
 * Lo que no tiene número queda vacío en vez de inventarse un 1: el formulario
 * lo deja poner a mano, y un 1 puesto por el sistema se firma sin mirarlo.
 */
export function cantidadPedida(texto: string | null | undefined): string {
  const m = String(texto ?? "").match(/\d+(?:[.,]\d+)?/);
  return m ? m[0].replace(",", ".") : "";
}

/**
 * De dónde sale el pedido, en una línea.
 *
 * Va al detalle y no a la descripción porque la descripción es qué se pide, y
 * mezclarlas deja los RI con el número de OT adentro del nombre del repuesto —
 * que es como después no se pueden agrupar dos pedidos del mismo material.
 *
 * Se dice cuánto quedaba en el pañol cuando se lo miró. Quien aprueba decide
 * distinto si no hay ninguno que si quedan dos, y hoy tiene que preguntarlo.
 */
export function deDondeSale(orden: OrdenDelPedido, d: Disponibilidad | null): string {
  const partes: string[] = [];

  if (orden.ot_number !== null) {
    partes.push(
      orden.descripcion
        ? `Para la OT ${orden.ot_number} — ${orden.descripcion}`
        : `Para la OT ${orden.ot_number}`
    );
  }
  if (orden.equipo_raw) partes.push(`Equipo: ${orden.equipo_raw}`);

  if (d?.estado === "no_esta") {
    partes.push("No está en el inventario del pañol");
  } else if (d?.insumo && d.insumo.stock !== null) {
    partes.push(`En el pañol quedan ${d.insumo.stock}`);
  }

  return partes.join(". ");
}

/** La única de la lista, o vacío. Con dos no se elige: ver abajo. */
const laUnica = (ids: string[]): string => (ids.length === 1 ? ids[0] : "");

/**
 * Dónde se necesita, según la orden.
 *
 * **Primero la de la máquina y después la del sector.** La del equipo es más
 * precisa: dice Filler 1 → *Molienda* en vez de Filler 1 a secas. La del sector
 * entra cuando la máquina no tiene ninguna enlazada, que al 18/10/2026 es el
 * caso de buena parte de las órdenes: de 40 abiertas, 34 tienen un sector que
 * llega a una ubicación y sin este paso salían con el campo vacío.
 *
 * Con dos no se elige ninguna, en los dos niveles. Filler 1 y Filler 2 tienen
 * *Molienda* y *Silos* cada uno, y elegir cualquiera pone el gasto en el lugar
 * que no es sin que nadie lo note — es la misma regla que la 042 dejó escrita
 * al enlazarlas, y la misma que el área del usuario.
 *
 * Y una máquina con dos **no cae al sector**: eso sería resolver una
 * ambigüedad fina saltando a una respuesta más gruesa, y cargarle el gasto al
 * sector entero cuando la máquina tiene centro propio es ponerlo en otro
 * lado, no en uno menos preciso.
 */
export function ubicacionDeLaOrden(
  orden: OrdenDelPedido,
  ubicaciones: UbicacionEnlazada[]
): string {
  const deLaMaquina = orden.equipment_id
    ? ubicacionesDelEquipo(ubicaciones, orden.equipment_id)
    : [];

  // Si la máquina tiene ubicaciones propias, la respuesta sale de ahí **aunque
  // sean dos y quede vacía**. Caer al sector en ese caso sería resolver una
  // ambigüedad fina saltando a lo grueso: la máquina tiene centro propio, y
  // cargarle el gasto al sector entero es ponerlo en otro lado, no en uno
  // menos preciso.
  if (deLaMaquina.length > 0) return laUnica(deLaMaquina);

  return orden.sector_id ? laUnica(ubicacionesDelSector(ubicaciones, orden.sector_id)) : "";
}

/**
 * El área de un pedido que nace de una orden de trabajo.
 *
 * **Siempre Mantenimiento**, y eso da vuelta lo que dice el formulario: *"el
 * área y quién paga no se pueden precargar y es a propósito; elegirlas por él
 * es cómo un pedido de Mantenimiento entra como si fuera de Producción"*. Esa
 * razón vale contra **adivinar**, y acá no se adivina: un repuesto que falta
 * para una OT es un pedido de Mantenimiento por construcción, lo pida quien lo
 * pida. Se puede cambiar igual.
 *
 * Se busca por nombre porque es un catálogo que mantiene una persona. Si
 * alguien lo renombra, deja de precargarse y el campo se elige a mano: no se
 * cae a otra área, que es lo que le escondería el pedido a quien lo espera.
 */
export function areaDeMantenimiento(
  areas: readonly { id: string; nombre: string }[]
): string {
  return areas.find((a) => a.nombre.trim().toUpperCase() === "MANTENIMIENTO")?.id ?? "";
}

/**
 * El requerimiento que se le sugiere a quien está mirando la orden.
 *
 * La descripción y el código salen del **artículo del pañol cuando se lo
 * reconoció**, y del texto libre cuando no. Es la diferencia entre un RI que
 * dice "00473 GUANTES DE VAQUETA" y uno que dice "guantes": el primero se cruza
 * con el inventario cuando llega, el segundo no.
 *
 * El resto —dónde, qué máquina, qué área— sale de la orden, que ya lo sabe.
 * Quién paga no se calcula acá: lo deduce el formulario del sector de la
 * ubicación, con la función que ya usa cuando alguien la elige a mano.
 */
export function pedidoSugerido(
  repuesto: RepuestoPedido,
  disponibilidad: Disponibilidad | null,
  orden: OrdenDelPedido,
  ubicaciones: UbicacionEnlazada[],
  areas: readonly { id: string; nombre: string }[] = []
): PedidoSugerido {
  const insumo = disponibilidad?.insumo ?? null;

  return {
    descripcion: insumo?.descripcion || repuesto.nombre || "",
    codigo: insumo?.codigo || repuesto.codigo || "",
    cantidad: cantidadPedida(repuesto.cantidad),
    detalle: deDondeSale(orden, disponibilidad),
    ubicacionId: ubicacionDeLaOrden(orden, ubicaciones),
    equipoId: orden.equipment_id ?? "",
    areaId: areaDeMantenimiento(areas),
  };
}
