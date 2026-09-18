/**
 * El resumen mensual por planta: días operativos, toneladas, horas y
 * disponibilidad — la versión generada de las pestañas `AGOSTO`/`Informe
 * Mensual`/`julio`, que hoy se arman a mano. Puro: recibe los partes ya
 * despejados (`ParteHoras` + `ParteDespejado`, de `lib/trituracion/horas.ts`)
 * y no toca la base.
 */

import { despejarParte, type ParteDespejado, type ParteHoras } from "./horas";

export interface ParteParaResumen extends ParteHoras {
  fecha: string; // "YYYY-MM-DD"
  estado: "opero" | "no_opero";
}

export interface ResumenMensual {
  diasOperativos: number;
  diasNoOperativos: number;
  toneladasTotal: number;
  horasTeoricasTotal: number;
  horasRealesTotal: number;
  horasParadasTotal: number;
  /** null si ningún día del mes tiene horas teóricas contra qué dividir. */
  disponibilidadPromedio: number | null;
  /** null si no hay horas reales totales positivas. */
  productividadRealPromedio: number | null;
}

export function resumenMensual(partes: ParteParaResumen[]): ResumenMensual {
  const operativos = partes.filter((p) => p.estado === "opero");
  const despejados: ParteDespejado[] = operativos.map((p) => despejarParte(p));

  const horasTeoricasTotal = despejados.reduce((s, d) => s + (d.horasTeoricas ?? 0), 0);
  const horasRealesTotal = despejados.reduce((s, d) => s + (d.horasRealesTrabajadas ?? 0), 0);
  const horasParadasTotal = despejados.reduce((s, d) => s + d.horasParadasTotal, 0);
  const toneladasTotal = operativos.reduce((s, p) => s + (p.toneladasProcesadas ?? 0), 0);

  return {
    diasOperativos: operativos.length,
    diasNoOperativos: partes.length - operativos.length,
    toneladasTotal,
    horasTeoricasTotal,
    horasRealesTotal,
    horasParadasTotal,
    disponibilidadPromedio: horasTeoricasTotal > 0 ? horasRealesTotal / horasTeoricasTotal : null,
    productividadRealPromedio: horasRealesTotal > 0 ? toneladasTotal / horasRealesTotal : null,
  };
}

/** Los últimos `cantidad` meses hasta `mesHasta` inclusive, de más viejo a más nuevo. Mismo criterio que `lib/tallerVial/combustible.ts`. */
export function ultimosMeses(mesHasta: string, cantidad: number): string[] {
  const [anio, m] = mesHasta.split("-").map(Number);
  const meses: string[] = [];
  for (let i = cantidad - 1; i >= 0; i--) {
    const total = anio * 12 + (m - 1) - i;
    meses.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`);
  }
  return meses;
}
