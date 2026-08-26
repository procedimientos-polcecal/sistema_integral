/**
 * Lo que el tablero de mantenimiento calcula.
 *
 * Vive acá y no en la página para poder testearlo: son las cuentas que mira
 * alguien para decidir cuándo parar una máquina, y equivocarlas manda a la
 * gente a reparar el día que la planta está produciendo.
 */

import { DIAS } from "@/lib/mantenimiento/produccion";

const MESES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

/** Los meses escritos enteros, para los títulos. */
const MESES_LARGOS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/**
 * El mes de esa fecha, escrito entero.
 *
 * De una lista y no de `toLocaleDateString`: un servidor sin locale español
 * devuelve "August", y el indicador diría "OT generadas en August".
 */
export const nombreDelMes = (fecha: Date): string => MESES_LARGOS[fecha.getMonth()];

export interface Mes {
  etiqueta: string;
  /** El primer día del mes, inclusive. */
  desde: string;
  /** El primer día del mes siguiente, exclusive. */
  hasta: string;
}

/**
 * Los últimos `cuantos` meses, terminando en el de la fecha dada.
 *
 * Los límites se arman con las partes locales de la fecha, no con
 * `toISOString()`: en un servidor en UTC eso corre el primero del mes al último
 * del anterior y las órdenes se cuentan en el mes equivocado.
 */
export function ultimosMeses(hoy: Date, cuantos: number): Mes[] {
  const dosDigitos = (n: number) => String(n).padStart(2, "0");
  const primero = (a: number, m: number) => `${a}-${dosDigitos(m + 1)}-01`;

  return Array.from({ length: cuantos }, (_, i) => {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - (cuantos - 1 - i), 1);
    const a = d.getFullYear();
    const m = d.getMonth();

    return {
      // El año se marca en enero, que es donde se nota el corte.
      etiqueta: MESES[m] + (m === 0 ? ` '${String(a).slice(2)}` : ""),
      desde: primero(a, m),
      hasta: m === 11 ? primero(a + 1, 0) : primero(a, m + 1),
    };
  });
}

interface OTPendiente {
  sector_id: string;
  requiere_parada_sector?: boolean | null;
}

/** Los sectores con una OT pendiente que obliga a pararlos. */
export function sectoresAParar(ordenes: OTPendiente[]): Set<string> {
  const sectores = new Set<string>();
  for (const o of ordenes) if (o.requiere_parada_sector) sectores.add(o.sector_id);
  return sectores;
}

export interface VentanaDeReparacion {
  empresa: string;
  /** Los días de la semana que viene en que no produce ningún sector. */
  dias: string[];
  /** Cuántas OT pendientes hay en esa empresa. */
  pendientes: number;
  /** De ésas, cuántas exigen parar el sector. */
  aParar: number;
}

/**
 * Dónde se puede reparar la semana que viene sin frenar el despacho.
 *
 * Un día sirve sólo si **ningún** sector de la empresa produce: alcanza con que
 * uno esté en producción para que la planta no se pueda intervenir.
 *
 * Una empresa sin plan cargado no genera ventana. Sin plan todo parece libre, y
 * eso sería anunciar una ventana que nadie planificó.
 */
export function ventanasDeReparacion(
  sectores: { id: string; empresa: string }[],
  planes: { sector_id: string; days?: unknown }[],
  pendientes: OTPendiente[]
): VentanaDeReparacion[] {
  const planPorSector = new Map(planes.map((p) => [p.sector_id, p.days]));

  const otPorSector: Record<string, { total: number; aParar: number }> = {};
  for (const o of pendientes) {
    const cuenta = (otPorSector[o.sector_id] ??= { total: 0, aParar: 0 });
    cuenta.total += 1;
    if (o.requiere_parada_sector) cuenta.aParar += 1;
  }

  const porEmpresa: Record<string, { id: string }[]> = {};
  for (const s of sectores) (porEmpresa[s.empresa] ??= []).push(s);

  const ventanas: VentanaDeReparacion[] = [];

  for (const [empresa, deLaEmpresa] of Object.entries(porEmpresa)) {
    if (!deLaEmpresa.some((s) => planPorSector.has(s.id))) continue;

    const dias = DIAS.filter((_, i) =>
      deLaEmpresa.every((s) => {
        const plan = planPorSector.get(s.id);
        const days = Array.isArray(plan) ? plan : [];
        return (days[i] ?? "LIBRE") === "LIBRE";
      })
    );
    if (dias.length === 0) continue;

    ventanas.push({
      empresa,
      dias,
      pendientes: deLaEmpresa.reduce((a, s) => a + (otPorSector[s.id]?.total ?? 0), 0),
      aParar: deLaEmpresa.reduce((a, s) => a + (otPorSector[s.id]?.aParar ?? 0), 0),
    });
  }

  return ventanas;
}
