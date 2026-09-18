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

export interface ParteParaMaterial {
  estado: "opero" | "no_opero";
  material: string | null;
  toneladasProcesadas: number | null;
}

export interface ToneladasPorMaterial {
  material: string;
  toneladas: number;
}

/**
 * Toneladas procesadas por material, sólo días operativos — para el gráfico
 * de reparto del mes en la página de inicio. Un `material` vacío (no
 * cargado) o combinado por la importación del histórico ("Caliza +
 * Chocolata", ver `lib/trituracion/importar.ts`) se agrupa aparte como "Sin
 * clasificar" en vez de inventar a cuál de los dos asignarlo — mismo
 * criterio que "enlazar al que se parece es peor que null".
 */
export function toneladasPorMaterial(partes: ParteParaMaterial[]): ToneladasPorMaterial[] {
  const totales = new Map<string, number>();
  for (const p of partes) {
    if (p.estado !== "opero" || !p.toneladasProcesadas) continue;
    const clave = p.material && !p.material.includes(" + ") ? p.material : "Sin clasificar";
    totales.set(clave, (totales.get(clave) ?? 0) + p.toneladasProcesadas);
  }
  return [...totales.entries()]
    .map(([material, toneladas]) => ({ material, toneladas }))
    .sort((a, b) => b.toneladas - a.toneladas);
}
