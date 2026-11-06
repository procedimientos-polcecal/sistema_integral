/**
 * Cada cuánto falla una máquina, y qué tan probable es que aguante.
 *
 * MTBF = días observados / cantidad de fallas. Dos decisiones lo sostienen:
 *
 * - **La fecha de una falla es `fecha_ejecucion`, no `fecha`.** `fecha` es
 *   cuándo se cargó la orden en la planilla; hay órdenes cargadas semanas
 *   después de que la máquina se rompió, y contarlas por carga mueve la falla
 *   al mes equivocado. `fecha` queda sólo de respaldo.
 *
 * - **El denominador son los días observados, no los 365 de la ventana.** El
 *   historial no empieza hace un año: si la primera falla registrada es de
 *   enero, dividir por 365 inventa tres meses de buen funcionamiento que nadie
 *   midió y hace parecer confiable lo que sólo es poco observado. Se cuenta
 *   desde la primera falla de la ventana hasta `hasta`, inclusive.
 *
 * La confiabilidad es la exponencial, R(t) = e^(-t/MTBF): supone una tasa de
 * falla constante. Es una aproximación declarada, no una medición.
 *
 * Todas las fechas viajan como texto `YYYY-MM-DD` y se comparan como texto.
 * Pasar por `toISOString()` corre el día en un servidor en UTC.
 */
import { ultimosMeses } from "./dashboard";

export const VENTANA_DIAS = 365;
export const PLAZOS = [7, 30] as const;
export const DIAS_RECIENTE = 90;
export const MIN_FALLAS_PARA_AVISO = 6;
export const FACTOR_AVISO = 2;
/** Bajo este piso de días observados, el MTBF no se publica. */
export const MINIMO_OBSERVADO = 14;

export interface OtCruda {
  ot_number: number;
  tipo: string | null;
  fecha: string | null;
  fecha_ejecucion: string | null;
  equipment_id: string | null;
  equipo_raw: string | null;
  especialidad: string | null;
}

export interface Falla {
  otNumber: number;
  equipmentId: string | null;
  equipoRaw: string | null;
  fecha: string;
  especialidad: string | null;
}

export interface RitmoCambiado {
  /** null cuando no falló en los últimos 90 días. */
  mtbfReciente: number | null;
  /** null cuando `mtbfReciente` es null: la mejora no tiene factor. */
  factor: number | null;
  direccion: "mejoro" | "empeoro";
}

export interface FilaMtbf {
  equipmentId: string;
  fallas: number;
  /** null cuando la ventana observada es menor a MINIMO_OBSERVADO. */
  mtbf: number | null;
  /** Probabilidades 0..1, en el orden de PLAZOS. null si mtbf es null. */
  confiabilidades: (number | null)[];
  ultima: string;
  porEspecialidad: { especialidad: string; cantidad: number }[];
  /**
   * Los últimos 12 meses calendario. **La suma puede ser menor que `fallas`**:
   * la ventana son 365 días y arranca a mitad de un mes, así que las fallas de
   * esos días sueltos no tienen barra. `fallasAntesDelGrafico()` de
   * `mtbfVista.ts` dice cuántas son, para que la pantalla lo aclare.
   */
  porMes: { etiqueta: string; cantidad: number }[];
  ritmo: RitmoCambiado | null;
}

export interface Mtbf {
  /** Ordenadas por mtbf ascendente; las de mtbf null van al final. */
  filas: FilaMtbf[];
  /** Días entre la primera falla de la ventana y `hasta`, inclusive. 0 si no hay fallas. */
  diasObservados: number;
  /** Correctivas de la ventana sin equipo enlazado. */
  sinAtribuir: Falla[];
  /** La etiqueta del mes en curso, que va marcado como incompleto. */
  mesEnCurso: string;
}

const MS_POR_DIA = 86_400_000;

/** Los días corridos de un `YYYY-MM-DD`, sin pasar por la zona horaria. */
function numeroDeDia(fecha: string): number {
  const [a, m, d] = fecha.split("-").map(Number);
  return Date.UTC(a, m - 1, d) / MS_POR_DIA;
}

/** `fecha` menos `dias` días, como `YYYY-MM-DD`. */
function restarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split("-").map(Number);
  const r = new Date(Date.UTC(a, m - 1, d - dias));
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${r.getUTCFullYear()}-${dos(r.getUTCMonth() + 1)}-${dos(r.getUTCDate())}`;
}

/** Un día de la planilla, o null si no hay nada utilizable. */
function soloElDia(valor: string | null | undefined): string | null {
  const dia = String(valor ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : null;
}

/**
 * Cuándo se rompió la máquina: la ejecución, y sólo si falta, la carga.
 */
export function fechaDeFalla(ot: OtCruda): string | null {
  return soloElDia(ot.fecha_ejecucion) ?? soloElDia(ot.fecha);
}

/**
 * Las correctivas de los últimos VENTANA_DIAS días hasta `hasta`, inclusive.
 *
 * Lo ejecutado después de `hasta` queda afuera: hay órdenes con fechas del
 * futuro por errores de carga y no son fallas que ya ocurrieron. Las que no
 * tienen equipo se conservan, porque son fallas igual y hay que poder decirlo.
 */
export function fallasDeLaVentana(ordenes: OtCruda[], hasta: string): Falla[] {
  const desde = restarDias(hasta, VENTANA_DIAS - 1);
  const fallas: Falla[] = [];

  for (const ot of ordenes) {
    if (ot.tipo !== "CORRECTIVO") continue;
    const fecha = fechaDeFalla(ot);
    if (fecha === null || fecha < desde || fecha > hasta) continue;
    fallas.push({
      otNumber: ot.ot_number,
      equipmentId: ot.equipment_id,
      equipoRaw: ot.equipo_raw,
      fecha,
      especialidad: ot.especialidad,
    });
  }

  return fallas;
}

/** Probabilidad de aguantar `dias` días sin fallar, con tasa de falla constante. */
export function confiabilidad(mtbf: number, dias: number): number {
  return Math.exp(-dias / mtbf);
}

/**
 * Si el ritmo de los últimos DIAS_RECIENTE días se despegó del de toda la
 * ventana. Con pocas fallas el promedio es ruido, así que no se opina.
 */
function ritmoDe(
  fechas: string[],
  mtbf: number | null,
  hasta: string,
  diasObservados: number
): RitmoCambiado | null {
  if (mtbf === null || fechas.length < MIN_FALLAS_PARA_AVISO) return null;

  const desde = restarDias(hasta, DIAS_RECIENTE - 1);
  const recientes = fechas.filter((f) => f >= desde).length;

  if (recientes === 0) return { mtbfReciente: null, factor: null, direccion: "mejoro" };

  // Si se observó menos que DIAS_RECIENTE, dividir por 90 compara contra una
  // ventana que nadie miró: con 6 fallas en 20 días daría "mejoró" sin que el
  // ritmo haya cambiado. Los días recientes nunca superan los observados.
  const mtbfReciente = Math.min(DIAS_RECIENTE, diasObservados) / recientes;
  const factor = mtbfReciente / mtbf;

  // El límite se compara por productos y no contra `factor`. Un ritmo que
  // matemáticamente duplica al de la ventana puede dar 1,9999999999999998 al
  // dividir dos veces en punto flotante, y entonces el aviso no sale justo en
  // el caso del enunciado. Con los días enteros de hoy no ocurre —se probaron
  // los ~12.000 casos de hasta 400 días y 2.000 fallas, y ninguno falla—, pero
  // el spec deja escrito que el día que Producción cargue horas de marcha el
  // denominador deja de ser entero. El aviso es la mitad del valor de la ficha:
  // no vale la pena que dependa de eso.
  if (mtbfReciente >= FACTOR_AVISO * mtbf) return { mtbfReciente, factor, direccion: "mejoro" };
  if (mtbfReciente * FACTOR_AVISO <= mtbf) return { mtbfReciente, factor, direccion: "empeoro" };
  return null;
}

export function calcularMtbf(ordenes: OtCruda[], hasta: string): Mtbf {
  const fallas = fallasDeLaVentana(ordenes, hasta);
  const meses = ultimosMeses(new Date(hasta + "T00:00:00"), 12);
  const mesEnCurso = meses[meses.length - 1].etiqueta;

  if (fallas.length === 0) {
    return { filas: [], diasObservados: 0, sinAtribuir: [], mesEnCurso };
  }

  const primera = fallas.reduce((min, f) => (f.fecha < min ? f.fecha : min), fallas[0].fecha);
  const diasObservados = numeroDeDia(hasta) - numeroDeDia(primera) + 1;
  const publicable = diasObservados >= MINIMO_OBSERVADO;

  const sinAtribuir: Falla[] = [];
  const porEquipo = new Map<string, Falla[]>();
  for (const f of fallas) {
    if (f.equipmentId === null) {
      sinAtribuir.push(f);
      continue;
    }
    const lista = porEquipo.get(f.equipmentId) ?? [];
    lista.push(f);
    porEquipo.set(f.equipmentId, lista);
  }

  const filas: FilaMtbf[] = [...porEquipo.entries()].map(([equipmentId, propias]) => {
    const mtbf = publicable ? diasObservados / propias.length : null;
    const fechas = propias.map((f) => f.fecha);

    const especialidades = new Map<string, number>();
    for (const f of propias) {
      const nombre = f.especialidad ?? "Sin especialidad";
      especialidades.set(nombre, (especialidades.get(nombre) ?? 0) + 1);
    }

    return {
      equipmentId,
      fallas: propias.length,
      mtbf,
      confiabilidades: PLAZOS.map((dias) => (mtbf === null ? null : confiabilidad(mtbf, dias))),
      ultima: fechas.reduce((max, f) => (f > max ? f : max), fechas[0]),
      porEspecialidad: [...especialidades.entries()]
        .map(([especialidad, cantidad]) => ({ especialidad, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad || a.especialidad.localeCompare(b.especialidad)),
      porMes: meses.map((mes) => ({
        etiqueta: mes.etiqueta,
        cantidad: fechas.filter((f) => f >= mes.desde && f < mes.hasta).length,
      })),
      ritmo: ritmoDe(fechas, mtbf, hasta, diasObservados),
    };
  });

  filas.sort((a, b) => {
    if (a.mtbf === null && b.mtbf === null) return b.fallas - a.fallas;
    if (a.mtbf === null) return 1;
    if (b.mtbf === null) return -1;
    return a.mtbf - b.mtbf;
  });

  return { filas, diasObservados, sinAtribuir, mesEnCurso };
}
