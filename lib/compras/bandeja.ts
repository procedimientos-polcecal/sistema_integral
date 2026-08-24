/**
 * La bandeja de aprobación y las reglas de la lista de aprobadores.
 *
 * Todo lo que se puede decidir sin consultar la base vive acá, para poder
 * testearlo sin credenciales.
 */

import { ordenarRequerimientos } from "@/lib/compras/constants";
import type { Prioridad } from "@/lib/compras/types";

export type Permitido = { ok: true } | { ok: false; motivo: string };

/**
 * Sin nadie en la lista no se aprueba nada y el circuito se traba entero: ni
 * los requerimientos pasan a comparativa ni las compras se aprueban.
 *
 * Y desde que aprobar dejó de depender del nivel, no hay un administrador que
 * pueda rescatar la situación aprobando él: la lista es el único camino.
 */
export function puedeQuitarDeLaLista(cuantosHay: number): Permitido {
  if (cuantosHay > 1) return { ok: true };
  return {
    ok: false,
    motivo:
      "No se puede sacar al último de la lista: sin nadie que apruebe, " +
      "ningún requerimiento avanza y ninguna compra se aprueba.",
  };
}

interface EnBandeja {
  nro_ri: number;
  compra_asignada_a: string | null;
  prioridad: Prioridad | null;
  fecha: string;
  updated_at: string;
}

/**
 * Separa lo que espera la decisión de quien mira de lo que espera a otro.
 *
 * Ver la cola del otro sirve para saber si algo está demorado, y tenerla aparte
 * evita confundir "lo que tengo que hacer" con "lo que estoy esperando". Lo que
 * no tiene a nadie asignado cae abajo: no es de nadie todavía.
 */
export function repartirBandeja<T extends EnBandeja>(
  items: T[],
  usuarioId: string
): { mios: T[]; deOtros: T[] } {
  const mios = items.filter((r) => r.compra_asignada_a === usuarioId);
  const deOtros = items.filter((r) => r.compra_asignada_a !== usuarioId);

  return {
    mios: ordenarRequerimientos(mios, "prioridad"),
    deOtros: ordenarRequerimientos(deOtros, "prioridad"),
  };
}
