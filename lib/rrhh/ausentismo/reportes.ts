import { rangoDelMes } from "@/lib/core/fechas";
import { diasDelAnual, diasEnElMes, mesDeImputacion, type Ausencia } from "./diasDeAusencia";
import { habilesAcumulados } from "./diasHabiles";

/**
 * Los tres reportes que RRHH hoy saca de la planilla de Google. Son funciones
 * puras: reciben las ausencias, los empleados y los catálogos ya leídos, y
 * devuelven los números. Quien las llama lee las tablas.
 *
 * LAS DOS REGLAS DE CONTAR DÍAS NO SE MEZCLAN, Y NO COINCIDEN A PROPÓSITO
 * (el porqué está en el encabezado de `diasDeAusencia.ts`):
 *
 * - `reporteMensual` y `reportePorcentual` usan `diasEnElMes`: inclusive y
 *   prorrateado entre meses.
 * - `reporteAnual` usa `diasDelAnual` + `mesDeImputacion`: exclusive, y la
 *   ausencia entera al mes en que empieza.
 *
 * Si alguien iguala las dos, cambian cifras que RRHH ya conoce.
 *
 * LA TARDANZA CUENTA COMO DÍA, igual que en la planilla (que tiene su columna).
 * En otras pantallas del sistema una tardanza no hace ausente a nadie, porque
 * la persona vino a trabajar; acá no se filtra por tipo, y eso es copiar la
 * planilla, no un descuido.
 *
 * NADIE DESAPARECE POR NO TENER SECTOR. `sector_id` puede ser null; esa persona
 * se agrupa bajo `SIN_SECTOR` en vez de caerse del reporte, que es lo que
 * pasaría en silencio con un `Map` por `sectorId` que descartara el null.
 *
 * Los porcentuales salen en escala 0–100 (117,5 y no 1,175), y sin redondear:
 * redondear es de quien los muestra.
 */

export const SIN_SECTOR = "Sin sector";

export interface EmpleadoDelReporte {
  id: string;
  nombre: string;
  apellido: string;
  sectorId: string | null;
  sector: string | null;
}

export interface HorasDeSector {
  sectorId: string;
  horasPorEmpleado: number;
  desde: string; // "YYYY-MM-DD"
  hasta: string | null;
}

/** Horas que se pierden por un día de ausencia. */
const HORAS_POR_DIA = 8;

/** Las filas se ordenan por nombre de sector y "Sin sector" va al final. */
function compararSectores(a: string, b: string): number {
  if (a === b) return 0;
  if (a === SIN_SECTOR) return 1;
  if (b === SIN_SECTOR) return -1;
  return a.localeCompare(b, "es");
}

/**
 * Agrupa los empleados por `sectorId`, con una clave aparte para quien no
 * tiene. El nombre visible es el del sector, o `SIN_SECTOR`.
 */
function agruparPorSector(empleados: EmpleadoDelReporte[]) {
  const grupos = new Map<string, { sector: string; sectorId: string | null; empleados: EmpleadoDelReporte[] }>();
  for (const e of empleados) {
    const clave = e.sectorId ?? "\0sin-sector";
    let g = grupos.get(clave);
    if (!g) {
      g = { sector: e.sector ?? SIN_SECTOR, sectorId: e.sectorId, empleados: [] };
      grupos.set(clave, g);
    }
    g.empleados.push(e);
  }
  return [...grupos.values()].sort((a, b) => compararSectores(a.sector, b.sector));
}

/** Las ausencias de cada empleado, para no recorrer la lista entera por cada uno. */
function ausenciasPorEmpleado(ausencias: Ausencia[]): Map<string, Ausencia[]> {
  const mapa = new Map<string, Ausencia[]>();
  for (const a of ausencias) {
    const lista = mapa.get(a.empleado_id);
    if (lista) lista.push(a);
    else mapa.set(a.empleado_id, [a]);
  }
  return mapa;
}

/**
 * Mensual: sector × motivo, con totales. Agregado, sin nombres.
 *
 * Una ausencia de alguien que no está en `empleados` no tiene sector y no
 * entra: quien llama tiene que pasar a todos los empleados con ausencias.
 */
export function reporteMensual(
  ausencias: Ausencia[],
  empleados: EmpleadoDelReporte[],
  mes: string,
): {
  filas: { sector: string; porMotivo: Record<string, number>; total: number }[];
  totalPorMotivo: Record<string, number>;
  total: number;
} {
  const porEmpleado = ausenciasPorEmpleado(ausencias);
  const totalPorMotivo: Record<string, number> = {};
  let total = 0;

  const filas = agruparPorSector(empleados).map((g) => {
    const porMotivo: Record<string, number> = {};
    let totalFila = 0;
    for (const e of g.empleados) {
      for (const a of porEmpleado.get(e.id) ?? []) {
        const dias = diasEnElMes(a, mes);
        if (dias === 0) continue;
        porMotivo[a.tipo] = (porMotivo[a.tipo] ?? 0) + dias;
        totalPorMotivo[a.tipo] = (totalPorMotivo[a.tipo] ?? 0) + dias;
        totalFila += dias;
        total += dias;
      }
    }
    return { sector: g.sector, porMotivo, total: totalFila };
  });

  return { filas, totalPorMotivo, total };
}

/**
 * Anual por persona: un número por mes, el total, los hábiles acumulados y el
 * porcentual.
 *
 * `porMes` tiene siempre 12 posiciones (enero es la 0). Los meses posteriores a
 * `hastaMes` quedan en 0 y no entran en el total, porque el denominador
 * (`habiles`) sólo llega hasta ahí. `hastaMes` tiene que ser del año `anio`:
 * un año distinto es un error de quien llama y no se arregla en silencio.
 *
 * Una ausencia que empieza en otro año no aparece: se imputa al mes de su
 * `fecha_desde` y sólo a ése.
 *
 * EL PORCENTUAL PUEDE PASAR DE 100 Y NO SE TOPEA. El numerador cuenta días de
 * calendario (fines de semana incluidos, porque se pidió que los números de
 * RRHH no se muevan) y el denominador cuenta días hábiles. Medido: 141 días
 * contra los 120 hábiles de junio de 2026 es 117,5 %. Es incómodo, pero un
 * número tapado sería inventado; la pantalla explica la mezcla.
 */
export function reporteAnual(
  ausencias: Ausencia[],
  empleados: EmpleadoDelReporte[],
  anio: number,
  hastaMes: string,
  feriados: readonly string[],
): {
  empleadoId: string;
  nombre: string;
  sector: string | null;
  porMes: number[];
  total: number;
  habiles: number;
  porcentual: number;
}[] {
  if (!hastaMes.startsWith(`${anio}-`)) {
    throw new Error(`El mes "${hastaMes}" no es del año ${anio}.`);
  }
  const mesFinal = Number(hastaMes.slice(5, 7));
  const habiles = habilesAcumulados(hastaMes, feriados);
  const porEmpleado = ausenciasPorEmpleado(ausencias);

  return [...empleados]
    .sort(
      (a, b) =>
        a.apellido.localeCompare(b.apellido, "es") || a.nombre.localeCompare(b.nombre, "es"),
    )
    .map((e) => {
      const porMes = new Array<number>(12).fill(0);
      for (const a of porEmpleado.get(e.id) ?? []) {
        const mes = mesDeImputacion(a);
        if (!mes.startsWith(`${anio}-`)) continue;
        const numeroDeMes = Number(mes.slice(5, 7));
        if (numeroDeMes > mesFinal) continue;
        porMes[numeroDeMes - 1] += diasDelAnual(a);
      }
      const total = porMes.reduce((suma, n) => suma + n, 0);
      return {
        empleadoId: e.id,
        nombre: `${e.apellido}, ${e.nombre}`,
        sector: e.sector,
        porMes,
        total,
        habiles,
        // Sin tope: ver arriba. Sin hábiles no hay con qué dividir.
        porcentual: habiles > 0 ? (total / habiles) * 100 : 0,
      };
    });
}

/**
 * La vigencia que cubre el mes, de las filas de un sector. Si hay más de una
 * (un solapamiento que la pantalla de carga debería impedir), gana la que
 * empezó más tarde. Una fila que no cubre el mes no se usa.
 */
function horasVigentes(horas: HorasDeSector[], sectorId: string, mes: string): number | null {
  const { primerDia, ultimoDia } = rangoDelMes(mes);
  let elegida: HorasDeSector | null = null;
  for (const h of horas) {
    if (h.sectorId !== sectorId) continue;
    if (h.desde > ultimoDia) continue;
    if (h.hasta !== null && h.hasta < primerDia) continue;
    if (elegida === null || h.desde > elegida.desde) elegida = h;
  }
  return elegida ? elegida.horasPorEmpleado : null;
}

/**
 * El porcentual: horas perdidas sobre horas a realizar, por sector y general.
 *
 * - Horas perdidas = días (regla del mensual) × 8.
 * - Horas a realizar = personal × `horasPorEmpleado` vigente en el mes. Las
 *   horas por empleado salen del catálogo y no de una fórmula: en la planilla
 *   los sectores de oficina llevan un 200 escrito a mano, que es una decisión
 *   de RRHH. Por eso `feriados` no se usa acá: se mantiene en la firma porque
 *   la pantalla se la pasa a los tres reportes por igual.
 * - Un sector sin horas vigentes (o sin sector, que nunca las tiene) aparece
 *   con sus horas perdidas y `horasARealizar` en 0, y su porcentual es 0 para
 *   no dividir por cero. No entra en el general, ni en el numerador ni en el
 *   denominador, para que el general sea un cociente entre cosas comparables.
 * - El general es ponderado (total perdidas / total a realizar), no el
 *   promedio de los porcentuales de cada sector.
 *
 * Igual que el anual, puede pasar de 100 y no se topea.
 */
export function reportePorcentual(
  ausencias: Ausencia[],
  empleados: EmpleadoDelReporte[],
  mes: string,
  horas: HorasDeSector[],
  _feriados: readonly string[],
): {
  filas: { sector: string; personal: number; horasARealizar: number; horasPerdidas: number; porcentual: number }[];
  general: number;
} {
  const porEmpleado = ausenciasPorEmpleado(ausencias);
  let perdidasConHoras = 0;
  let aRealizarTotal = 0;

  const filas = agruparPorSector(empleados).map((g) => {
    let dias = 0;
    for (const e of g.empleados) {
      for (const a of porEmpleado.get(e.id) ?? []) dias += diasEnElMes(a, mes);
    }
    const horasPerdidas = dias * HORAS_POR_DIA;
    const personal = g.empleados.length;
    const horasPorEmpleado = g.sectorId === null ? null : horasVigentes(horas, g.sectorId, mes);
    const horasARealizar = horasPorEmpleado === null ? 0 : personal * horasPorEmpleado;

    if (horasARealizar > 0) {
      perdidasConHoras += horasPerdidas;
      aRealizarTotal += horasARealizar;
    }
    return {
      sector: g.sector,
      personal,
      horasARealizar,
      horasPerdidas,
      porcentual: horasARealizar > 0 ? (horasPerdidas / horasARealizar) * 100 : 0,
    };
  });

  return { filas, general: aRealizarTotal > 0 ? (perdidasConHoras / aRealizarTotal) * 100 : 0 };
}
