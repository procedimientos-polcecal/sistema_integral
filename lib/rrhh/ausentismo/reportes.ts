import { esMesValido, rangoDelMes } from "@/lib/core/fechas";
import { diasDelAnual, diasEnElMes, mesDeImputacion, type Ausencia } from "./diasDeAusencia";
import { habilesAcumulados, habilesDelMes, sabadosDelMes } from "./diasHabiles";

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
 *
 * TRES AVISOS QUE VALEN PARA LAS TRES FUNCIONES:
 *
 * - Una ausencia cuyo `empleado_id` no está en `empleados` no tiene sector ni
 *   persona a quien sumarle, así que no entra en ningún número. No se pierde en
 *   silencio: se cuenta y se devuelve en `ausenciasHuerfanas`, para que la
 *   pantalla lo diga. Sólo cuentan las que habrían aportado al reporte (las de
 *   otro mes o de otro año no lo cambian y no son una alarma). Quien llama
 *   tiene que pasar a TODOS los empleados con ausencias, también a los
 *   inactivos.
 * - Un mes que no es un "YYYY-MM" válido tira un error. `"2026-1"` no
 *   reventaría más abajo: daría un resultado equivocado en silencio.
 * - Un motivo con cero días no tiene clave en `porMotivo` ni en
 *   `totalPorMotivo`. La lista de columnas de la pantalla tiene que salir del
 *   enum `tipo_ausencia` y no de las claves del resultado, si no un mes sin
 *   licencias dejaría de mostrar esa columna.
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

function exigirMes(mes: string): void {
  if (!esMesValido(mes)) {
    throw new Error(`El mes "${mes}" no es un "AAAA-MM" válido.`);
  }
}

/**
 * Cuántas ausencias son de alguien que no está en `empleados` y habrían
 * aportado al reporte (`aportaria` decide qué es aportar en cada uno).
 */
function contarHuerfanas(
  ausencias: Ausencia[],
  empleados: EmpleadoDelReporte[],
  aportaria: (a: Ausencia) => boolean,
): number {
  const conocidos = new Set(empleados.map((e) => e.id));
  return ausencias.filter((a) => !conocidos.has(a.empleado_id) && aportaria(a)).length;
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
 * Cada fila trae su `sectorId`: el catálogo tiene sectores distintos con el
 * mismo nombre, y la pantalla necesita una clave para distinguirlos.
 */
export function reporteMensual(
  ausencias: Ausencia[],
  empleados: EmpleadoDelReporte[],
  mes: string,
): {
  filas: { sector: string; sectorId: string | null; porMotivo: Record<string, number>; total: number }[];
  totalPorMotivo: Record<string, number>;
  total: number;
  ausenciasHuerfanas: number;
} {
  exigirMes(mes);
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
    return { sector: g.sector, sectorId: g.sectorId, porMotivo, total: totalFila };
  });

  const ausenciasHuerfanas = contarHuerfanas(ausencias, empleados, (a) => diasEnElMes(a, mes) > 0);
  return { filas, totalPorMotivo, total, ausenciasHuerfanas };
}

/**
 * Anual por persona: un número por mes, el total, los hábiles acumulados y el
 * porcentual.
 *
 * Devuelve `filas` (una por empleado) y `ausenciasHuerfanas`: las ausencias de
 * alguien que no está en `empleados` y que se imputan a un mes del período.
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
  filas: {
    empleadoId: string;
    nombre: string;
    sector: string | null;
    porMes: number[];
    total: number;
    habiles: number;
    porcentual: number;
  }[];
  ausenciasHuerfanas: number;
} {
  exigirMes(hastaMes);
  if (!hastaMes.startsWith(`${anio}-`)) {
    throw new Error(`El mes "${hastaMes}" no es del año ${anio}.`);
  }
  const mesFinal = Number(hastaMes.slice(5, 7));
  const habiles = habilesAcumulados(hastaMes, feriados);
  const porEmpleado = ausenciasPorEmpleado(ausencias);

  const filas = [...empleados]
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

  const ausenciasHuerfanas = contarHuerfanas(ausencias, empleados, (a) => {
    const mes = mesDeImputacion(a);
    return mes.startsWith(`${anio}-`) && Number(mes.slice(5, 7)) <= mesFinal;
  });
  return { filas, ausenciasHuerfanas };
}

/**
 * La vigencia que cubre el mes, de las filas de un sector. Si hay más de una
 * (un solapamiento que la pantalla de carga debería impedir), gana la que
 * empezó más tarde. Una fila que no cubre el mes no se usa.
 *
 * "Cubre" es CUALQUIER SOLAPAMIENTO con el mes, no que lo cubra entero: una
 * fila que empieza el día 20 vale para todo ese mes, y una que termina el 2
 * también. Las horas son por mes y no se prorratean.
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
 * - Horas a realizar = personal × horas por empleado. De dónde salen esas
 *   horas es lo que no se deduce del código y lo que hay que saber:
 *     · SIN fila vigente en el catálogo, se CALCULAN: `(hábiles + sábados) × 8`,
 *       con los hábiles del mes menos los feriados. Es lo que la planilla hace
 *       con los sectores de planta, y varía con el mes como tiene que variar
 *       (febrero de 2026 da 176 y octubre 200).
 *     · CON fila vigente, gana la fila.
 *   El cálculo es el predeterminado y la fila es la excepción porque son cosas
 *   de naturaleza distinta: el 208 es aritmética y se puede recalcular cada
 *   mes, el 200 de los sectores de oficina es una decisión de RRHH que no sale
 *   de ninguna fórmula. Esa asimetría es la razón de que exista un catálogo.
 *   Con el catálogo vacío el reporte da el porcentual de planta para todos, en
 *   vez de un 0 que se lee igual que "nadie faltó".
 * - Quien no tiene sector nunca tiene fila, así que usa el cálculo y entra al
 *   general como cualquier otro.
 * - El general es ponderado (total perdidas / total a realizar), no el
 *   promedio de los porcentuales de cada sector. Sin personal no hay con qué
 *   dividir y da 0.
 *
 * Igual que el anual, puede pasar de 100 y no se topea: ver `reporteAnual`.
 */
export function reportePorcentual(
  ausencias: Ausencia[],
  empleados: EmpleadoDelReporte[],
  mes: string,
  horas: HorasDeSector[],
  feriados: readonly string[],
): {
  filas: {
    sector: string;
    sectorId: string | null;
    personal: number;
    horasARealizar: number;
    horasPerdidas: number;
    porcentual: number;
  }[];
  general: number;
  ausenciasHuerfanas: number;
} {
  exigirMes(mes);
  const porEmpleado = ausenciasPorEmpleado(ausencias);
  // El cálculo de planta es el mismo para todos los sectores: se hace una vez.
  const horasCalculadas = (habilesDelMes(mes, feriados) + sabadosDelMes(mes)) * HORAS_POR_DIA;
  let perdidasTotal = 0;
  let aRealizarTotal = 0;

  const filas = agruparPorSector(empleados).map((g) => {
    let dias = 0;
    for (const e of g.empleados) {
      for (const a of porEmpleado.get(e.id) ?? []) dias += diasEnElMes(a, mes);
    }
    const horasPerdidas = dias * HORAS_POR_DIA;
    const personal = g.empleados.length;
    const horasDelCatalogo = g.sectorId === null ? null : horasVigentes(horas, g.sectorId, mes);
    const horasARealizar = personal * (horasDelCatalogo ?? horasCalculadas);

    perdidasTotal += horasPerdidas;
    aRealizarTotal += horasARealizar;
    return {
      sector: g.sector,
      sectorId: g.sectorId,
      personal,
      horasARealizar,
      horasPerdidas,
      porcentual: horasARealizar > 0 ? (horasPerdidas / horasARealizar) * 100 : 0,
    };
  });

  const ausenciasHuerfanas = contarHuerfanas(ausencias, empleados, (a) => diasEnElMes(a, mes) > 0);
  return {
    filas,
    general: aRealizarTotal > 0 ? (perdidasTotal / aRealizarTotal) * 100 : 0,
    ausenciasHuerfanas,
  };
}
