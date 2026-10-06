import type { Modulo } from "@/lib/core/types";

/** Una fila de la vista `inicio_ritmo_modulos`, tal como la devuelve PostgREST. */
export interface FilaRitmo {
  modulo: string;
  ultima_fecha: string | null;
  dias_sin_cargar: number | null;
  hueco_max: number;
}

export interface Ritmo {
  /** Null cuando esa fuente nunca tuvo una fila. */
  ultimaFecha: string | null;
  /** Null cuando nunca se cargó: no es 0, es "no hay desde cuándo contar". */
  diasSinCargar: number | null;
  umbral: number;
  atrasado: boolean;
}

/**
 * Cuántos días sin cargar se toleran antes de avisar, calculado sobre la
 * historia del propio módulo: el hueco más largo que tuvo en 180 días, más uno.
 *
 * Se eligió el hueco máximo y no el p90, que es la forma obvia: con `p90 × 3`
 * se escapa Despacho, que lleva 5 días parado cuando su hueco más largo del año
 * fue de 3. Medido el 06/10/2026 — la tabla está en el test y en el spec.
 *
 * El piso de 3 es para que un módulo con dos días de historia no grite cada fin
 * de semana. El tope de 30 es para que un parate largo —enero— no le suba el
 * umbral y lo deje mudo los 180 días siguientes.
 */
export function umbralDeRitmo(huecoMax: number): number {
  return Math.max(3, Math.min(huecoMax + 1, 30));
}

/**
 * `diasSinCargar` en null es un módulo que **nunca** se cargó, y eso no es estar
 * al día: Producción tiene 0 partes desde que existe.
 */
export function estaAtrasado(diasSinCargar: number | null, umbral: number): boolean {
  if (diasSinCargar === null) return true;
  return diasSinCargar >= umbral;
}

/**
 * La cantidad con la que un aviso de ritmo entra al globo de notificaciones.
 *
 * No son los días sin cargar, y la diferencia importa: `filtrarDescartadas`
 * vuelve a mostrar un aviso cuando su cantidad superó a la que tenía al
 * descartarlo, así que un número que crece solo todas las noches haría que
 * descartarlo no sirviera de nada. Son los umbrales enteros que lleva parado:
 * descartar Trituración hoy (36 días, umbral 4 ⇒ 9) la calla hasta los 40.
 *
 * Un módulo que nunca se cargó manda 1 fijo: "Producción nunca se cargó" no es
 * novedad todos los días, y así descartarlo lo calla de verdad.
 */
export function cantidadDelAviso(diasSinCargar: number | null, umbral: number): number {
  if (diasSinCargar === null) return 1;
  return Math.floor(diasSinCargar / umbral);
}

/**
 * Las trece fuentes de la vista contra los doce módulos del sistema.
 *
 * Calidad es la única con dos: carbonilla y envases se cargan por separado y
 * tienen una sola tarjeta, que muestra **la peor de las dos**. Un módulo que no
 * tiene fila en la vista queda sin ritmo —`undefined`—, que no es lo mismo que
 * estar al día.
 */
const FUENTES_POR_MODULO: Record<Modulo, string[]> = {
  rrhh: ["rrhh"],
  mantenimiento: ["mantenimiento"],
  remises: ["remises"],
  compras: ["compras"],
  inventario: ["inventario"],
  produccion: ["produccion"],
  despacho: ["despacho"],
  facturacion: ["facturacion"],
  cantera: ["cantera"],
  calidad: ["calidad", "calidad_envases"],
  taller_vial: ["taller_vial"],
  trituracion: ["trituracion"],
};

/** El ritmo de una sola fuente, con el umbral calculado sobre su propio hueco. */
export function ritmoDeFila(fila: FilaRitmo): Ritmo {
  const umbral = umbralDeRitmo(fila.hueco_max);
  return {
    ultimaFecha: fila.ultima_fecha,
    diasSinCargar: fila.dias_sin_cargar,
    umbral,
    atrasado: estaAtrasado(fila.dias_sin_cargar, umbral),
  };
}

/**
 * Null —nunca se cargó— es lo peor; después, el que más umbrales lleva parado.
 *
 * Se compara por `días / umbral` y no por días crudos porque cada mitad tiene
 * su propio umbral: una con 20 días y umbral 26 está al día, y otra con 5 días
 * y umbral 4 no. Elegir por días crudos mostraría la primera y taparía a la
 * segunda, un dato equivocado que no se nota nunca. Con umbrales iguales la
 * razón ordena igual que los días.
 */
function peor(a: Ritmo, b: Ritmo): Ritmo {
  if (a.diasSinCargar === null) return a;
  if (b.diasSinCargar === null) return b;
  return b.diasSinCargar / b.umbral > a.diasSinCargar / a.umbral ? b : a;
}

export function ritmoPorModulo(filas: FilaRitmo[]): Partial<Record<Modulo, Ritmo>> {
  const porFuente = new Map(filas.map((f) => [f.modulo, f]));
  const resultado: Partial<Record<Modulo, Ritmo>> = {};

  for (const [modulo, fuentes] of Object.entries(FUENTES_POR_MODULO) as [Modulo, string[]][]) {
    const presentes = fuentes
      .map((f) => porFuente.get(f))
      .filter((f): f is FilaRitmo => f !== undefined)
      .map(ritmoDeFila);
    if (presentes.length === 0) continue;

    resultado[modulo] = presentes.reduce(peor);
  }
  return resultado;
}
