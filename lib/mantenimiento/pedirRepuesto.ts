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
import { ubicacionesDelEquipo, type UbicacionEnlazada } from "@/lib/compras/ubicaciones";

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

/**
 * El requerimiento que se le sugiere a quien está mirando la orden.
 *
 * La descripción y el código salen del **artículo del pañol cuando se lo
 * reconoció**, y del texto libre cuando no. Es la diferencia entre un RI que
 * dice "00473 GUANTES DE VAQUETA" y uno que dice "guantes": el primero se cruza
 * con el inventario cuando llega, el segundo no.
 *
 * La ubicación se completa **sólo si la máquina tiene una sola**. Con dos, cuál
 * es la correcta no se deduce, y elegir cualquiera pone el gasto en el lugar
 * que no es sin que nadie lo note — es la misma regla que la 042 dejó escrita
 * al enlazarlas.
 */
export function pedidoSugerido(
  repuesto: RepuestoPedido,
  disponibilidad: Disponibilidad | null,
  orden: OrdenDelPedido,
  ubicaciones: UbicacionEnlazada[]
): PedidoSugerido {
  const insumo = disponibilidad?.insumo ?? null;

  const candidatas = orden.equipment_id
    ? ubicacionesDelEquipo(ubicaciones, orden.equipment_id)
    : [];

  return {
    descripcion: insumo?.descripcion || repuesto.nombre || "",
    codigo: insumo?.codigo || repuesto.codigo || "",
    cantidad: cantidadPedida(repuesto.cantidad),
    detalle: deDondeSale(orden, disponibilidad),
    ubicacionId: candidatas.length === 1 ? candidatas[0] : "",
  };
}
