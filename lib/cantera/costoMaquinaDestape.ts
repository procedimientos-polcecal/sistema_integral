/**
 * El costo $/h de una máquina propia de destape, a partir de números ya
 * resueltos (por `lib/cantera/costoMaquinaOdoo.ts`, que sí habla con Odoo y
 * con Taller Vial). Puro: sólo combina lo que le pasan.
 *
 * A pedido del usuario (21/09/2026): "máquina propia" dejó de ser una
 * tarifa $/h cargada a mano por equipo (nunca se llegó a cargar) y pasa a
 * ser: lo facturado a la cuenta analítica de ese equipo en Odoo, más un
 * estimado de combustible, dividido las horas de uso del mes.
 */

import type { TipoDeCombustible } from "@/lib/tallerVial/equipos";

/** El nombre real del producto de combustible en Odoo, por tipo — relevado el 21/09/2026 contra facturas reales de las cisternas. */
export const PRODUCTO_ODOO_DE_COMBUSTIBLE: Record<TipoDeCombustible, string> = {
  DIESEL_500: "DIESEL D500",
  INFINIA: "INFINIA DIESEL",
};

export interface DatosParaCostoMaquina {
  /** Lo facturado (posteado, Odoo) a la cuenta analítica de este equipo en el mes, en las dos empresas. */
  gastoAnaliticoOdoo: number;
  /** Litros cargados a ESTE equipo el mes, de Taller Vial. */
  litrosDelMes: number;
  /**
   * Lo facturado (posteado, Odoo) en el tipo de combustible de este equipo
   * (DIESEL D500 / INFINIA DIESEL) ese mes, sumando toda la flota del
   * grupo — no sólo este equipo. No incluye "IMPUESTO COMBUSTIBLE": viene
   * en una línea aparte de la factura, sin forma de repartirla entre
   * diesel y nafta sin adivinar, así que el estimado de combustible queda
   * conservador (por debajo del gasto real).
   */
  gastoCombustibleDelTipo: number;
  /** Litros cargados ese mes a TODA la flota que usa ese mismo tipo de combustible — denominador del precio implícito. */
  litrosDelTipo: number;
  /** Horas trabajadas este mes según el horómetro de Taller Vial. Null si no hay dos lecturas consecutivas ese mes para calcularlas. */
  horasDelMes: number | null;
}

export interface CostoMaquinaDelMes {
  /** null si no hay horas de uso ese mes — no hay entre qué dividir, no vale mostrar $0 (diría "gratis"). */
  costoHora: number | null;
  gastoOdoo: number;
  /** null si nadie cargó combustible de ese tipo en ningún equipo ese mes — no hay con qué estimar un precio. */
  precioImplicitoLitro: number | null;
  estimadoCombustible: number;
  horasDelMes: number | null;
}

export function costoHoraDeMaquina(d: DatosParaCostoMaquina): CostoMaquinaDelMes {
  const precioImplicitoLitro = d.litrosDelTipo > 0 ? d.gastoCombustibleDelTipo / d.litrosDelTipo : null;
  const estimadoCombustible = precioImplicitoLitro !== null ? d.litrosDelMes * precioImplicitoLitro : 0;
  const total = d.gastoAnaliticoOdoo + estimadoCombustible;
  const costoHora = d.horasDelMes !== null && d.horasDelMes > 0 ? total / d.horasDelMes : null;
  return { costoHora, gastoOdoo: d.gastoAnaliticoOdoo, precioImplicitoLitro, estimadoCombustible, horasDelMes: d.horasDelMes };
}
