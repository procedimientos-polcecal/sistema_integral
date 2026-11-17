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
  ot_number?: number | null;
  estado?: string | null;
  descripcion?: string | null;
  equipo_raw?: string | null;
}

/** Una OT pendiente que obliga a parar el sector, con lo justo para nombrarla. */
export interface OtQueExigeParar {
  ot_number: number;
  estado: string;
  /** Qué hay que hacer. Puede venir vacía: la planilla no la obliga. */
  descripcion: string | null;
  /** El respaldo cuando no hay descripción, que es como se las nombra en planta. */
  equipo_raw: string | null;
}

/**
 * Primero la que ya se pasó de fecha: entre dos pedidos de parada, el que
 * llegó tarde es el que decide cuándo se frena la planta.
 */
const PESO_DEL_ESTADO: Record<string, number> = {
  ATRASADO: 0,
  EN_PROCESO: 1,
  POR_HACER: 2,
};

/**
 * Las OT pendientes que obligan a parar cada sector, agrupadas por sector.
 *
 * **Devuelve la lista y no un conteo** porque "parar Hidratación" es una
 * decisión que se toma mirando qué trabajo lo exige: una sola OT de media hora
 * no para una planta, y tres acumuladas sí. Un número suelto manda a quien lo
 * ve a buscar las órdenes a mano en el listado, que es lo que esta pantalla
 * tendría que ahorrarle.
 *
 * Un sector sin ninguna no aparece: las claves de lo que devuelve son los
 * sectores a parar, así que de acá sale también el conteo del indicador.
 *
 * Quedan afuera las `REALIZADO` y las `CANCELADA`, que es lo que decide quien
 * consulta: la lista llega ya filtrada por estado —con una lista blanca de los
 * abiertos, así que un estado nuevo queda afuera solo hasta que alguien lo
 * sume a mano, que es el lado seguro del error—.
 */
export function paradasExigidas(
  ordenes: OTPendiente[]
): Record<string, OtQueExigeParar[]> {
  const porSector: Record<string, OtQueExigeParar[]> = {};

  for (const o of ordenes) {
    if (!o.requiere_parada_sector) continue;
    (porSector[o.sector_id] ??= []).push({
      ot_number: o.ot_number ?? 0,
      estado: o.estado ?? "",
      descripcion: o.descripcion ?? null,
      equipo_raw: o.equipo_raw ?? null,
    });
  }

  // El número es secuencial, así que el más bajo es el que lleva más tiempo
  // esperando. Ordenar acá y no en la pantalla: la que se muestra cuando no
  // entran todas tiene que ser siempre la misma.
  for (const lista of Object.values(porSector)) {
    lista.sort(
      (a, b) =>
        (PESO_DEL_ESTADO[a.estado] ?? 9) - (PESO_DEL_ESTADO[b.estado] ?? 9) ||
        a.ot_number - b.ot_number
    );
  }

  return porSector;
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
