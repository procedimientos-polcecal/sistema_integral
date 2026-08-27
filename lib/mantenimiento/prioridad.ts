/**
 * En qué orden conviene hacer las órdenes de trabajo.
 *
 * Hay dos órdenes y el manual gana: el sugerido sale de lo que dicen los datos
 * —qué está atrasado, qué es urgente, qué espera hace más— y el manual sale de
 * lo que sabe quien reparte el trabajo, que a veces es otra cosa: que el
 * repuesto llega el jueves, que hay que aprovechar que el sector está parado.
 *
 * Se ordenan **las pendientes**, no todas. De las 1.741 órdenes cargadas hay 32
 * esperando algo; poner en fila las 1.709 que ya se hicieron no le sirve a
 * nadie.
 */

import { estaAtrasada, type Atrasable } from "@/lib/mantenimiento/alertas";

/** Los estados en los que la orden todavía espera algo de alguien. */
export const ESTA_PENDIENTE = ["ATRASADO", "EN_PROCESO", "POR_HACER"] as const;

/** Cuánto pesa cada prioridad. Lo que no se reconoce queda en el medio. */
const PESO_PRIORIDAD: Record<string, number> = { ALTA: 3, MEDIA: 2, BAJA: 1 };
const peso = (prioridad: string | null | undefined): number =>
  PESO_PRIORIDAD[String(prioridad ?? "").toUpperCase()] ?? 2;

export interface Ordenable extends Atrasable {
  id: string;
  ot_number?: number | null;
  prioridad?: string | null;
  fecha?: string | null;
  orden_manual?: number | null;
}

/**
 * El orden que sugieren los datos.
 *
 * Primero lo atrasado —ya se pasó de fecha, no importa con qué prioridad
 * nació—, después lo urgente, y entre iguales lo que espera hace más.
 */
export function ordenSugerido<T extends Ordenable>(ordenes: T[], hoy: string): T[] {
  return [...ordenes].sort((a, b) => {
    const atrasoA = estaAtrasada(a, hoy) ? 1 : 0;
    const atrasoB = estaAtrasada(b, hoy) ? 1 : 0;
    if (atrasoA !== atrasoB) return atrasoB - atrasoA;

    const prioridad = peso(b.prioridad) - peso(a.prioridad);
    if (prioridad !== 0) return prioridad;

    // La más vieja primero. Las fechas `aaaa-mm-dd` se comparan como texto.
    return String(a.fecha ?? "").localeCompare(String(b.fecha ?? ""));
  });
}

/**
 * Mueve un elemento de una posición a otra.
 *
 * Devuelve una lista nueva: la que está en pantalla se reemplaza entera, y
 * mutar la de React deja la vista sin actualizar.
 */
export function moverEnLista<T>(lista: T[], desde: number, hasta: number): T[] {
  if (
    desde === hasta ||
    desde < 0 || desde >= lista.length ||
    hasta < 0 || hasta >= lista.length
  ) {
    return lista;
  }

  const copia = [...lista];
  const [movido] = copia.splice(desde, 1);
  copia.splice(hasta, 0, movido);
  return copia;
}

/** La lista tal como quedó, lista para guardar. */
export function asignarOrden(lista: { id: string }[]): { id: string; orden: number }[] {
  return lista.map((o, i) => ({ id: o.id, orden: i }));
}

/**
 * El orden final: primero lo que alguien puso a mano, después el resto.
 *
 * Las que nadie ordenó van después y entre ellas vale el orden sugerido. Así
 * poner tres órdenes arriba no obliga a ordenar las otras veintinueve.
 *
 * Si dos quedaron con el mismo número —pasa al ordenar una lista filtrada,
 * porque las de afuera conservan el suyo— desempata el número de OT, que es
 * estable y no depende de en qué orden llegaron.
 */
export function aplicarOrdenManual<T extends Ordenable>(ordenes: T[], hoy: string): T[] {
  const sugerido = ordenSugerido(ordenes, hoy);
  const posicion = new Map(sugerido.map((o, i) => [o.id, i]));

  return [...ordenes].sort((a, b) => {
    const ordenA = a.orden_manual ?? null;
    const ordenB = b.orden_manual ?? null;

    if (ordenA !== null && ordenB !== null) {
      return ordenA - ordenB || (a.ot_number ?? 0) - (b.ot_number ?? 0);
    }
    // La ordenada a mano va antes que la que nadie tocó.
    if (ordenA !== null) return -1;
    if (ordenB !== null) return 1;

    return (posicion.get(a.id) ?? 0) - (posicion.get(b.id) ?? 0);
  });
}
