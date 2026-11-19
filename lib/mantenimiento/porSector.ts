/**
 * Cada cuánto falla un **sector**, cuánto cuesta levantarlo y qué tan probable
 * es que aguante una semana.
 *
 * Es el hermano de `mtbf.ts` y `mttr.ts` un nivel más arriba, y la diferencia
 * de nivel es la mitad de lo que hay que entender antes de tocar esto:
 *
 * **El MTBF de un sector es «cada cuánto falla algo acá dentro», no cada
 * cuánto falla una máquina.** Planta filler 1 tiene 184 correctivas en el
 * último año y su MTBF da 1,9 días; ninguna de sus máquinas falla cada dos
 * días. El número correcto se lee mal si se lo lee como el de un equipo, así
 * que la pantalla lo dice en su tooltip y esto lo dice acá.
 *
 * ── POR QUÉ ESTO EXISTE SI YA ESTÁN LOS DOS DE EQUIPO ─────────────────────
 *
 * Porque la planta se decide por sector: se para Hidratación, no una bomba, y
 * se manda el taller a Filler 1, no a una válvula. Y porque el sector se puede
 * contestar con **más** datos que el equipo: medido el 19/11/2026, de las 981
 * correctivas de la ventana **las 981 tienen `sector_id`** y 18 no tienen
 * equipo enlazado. Agregar por sector no tira esas 18; el MTBF por equipo
 * tiene que tirarlas.
 *
 * ── LOS DÍAS OBSERVADOS SE CUENTAN POR SECTOR ─────────────────────────────
 *
 * `mtbf.ts` cuenta desde la primera falla **del conjunto**; acá se cuenta
 * desde la primera falla **de cada sector**, que es la misma regla bajada un
 * nivel. Medido: Trituración 2 lleva 282 días de historia y Filler 3, 325.
 * Dividir por 365 le inventaría a Trituración 2 casi tres meses de buen
 * funcionamiento que nadie miró, que es justo lo que el encabezado de
 * `mtbf.ts` explica para el otro nivel.
 *
 * ── EL MTTR NO REUSA `reparacionesDeLaVentana()`, Y ES A PROPÓSITO ────────
 *
 * Esa función descarta las correctivas sin `equipment_id` (`afuera.sinEquipo`)
 * por una razón que acá no existe: allá el promedio se le imputa a un equipo y
 * una orden sin equipo no se le puede imputar a ninguno. Para un sector el
 * dato que hace falta es `sector_id`, que esas órdenes sí tienen. Lo que
 * cambia, medido el 19/11/2026: **sólo Taller**, que pasa de «—» a 3
 * reparaciones y 6,0 h, y Servicios auxiliares, que pasa de 0 a 2 y sigue bajo
 * el piso. Sí se reusa `esDeUnTercero()`, porque «lo hizo un tercero» tiene
 * que querer decir lo mismo en los dos lados.
 *
 * ── EL MTTF ES DERIVADO, NO MEDIDO ───────────────────────────────────────
 *
 * MTTF = MTBF − MTTR, que es lo que se pidió. Con el MTTR de este sistema
 * —horas de **trabajo**, no horas de parada; el porqué medido está en el
 * encabezado de `mttr.ts`— la resta mueve el número un 5 % o menos: Filler 1
 * pasa de 1,9 a 1,8 días. Quien lo lea tiene que saber que no es una segunda
 * medición independiente, y por eso la pantalla lo dice.
 *
 * Todas las fechas viajan como texto `YYYY-MM-DD` y se comparan como texto:
 * pasar por `toISOString()` corre el día en un servidor en UTC.
 */
import { sumarDias } from "@/lib/core/fechas";
import { ultimosMeses } from "./dashboard";
import { fechaDeFalla, VENTANA_DIAS, MINIMO_OBSERVADO, confiabilidad } from "./mtbf";
import { esDeUnTercero, MINIMO_REPARACIONES } from "./mttr";

/**
 * A cuántos días se publica la confiabilidad de un sector.
 *
 * Siete, que es la semana con la que se programa el taller. **No reusa
 * `PLAZOS` de `mtbf.ts`**, que son los 7 y 30 de la ficha de un equipo: son
 * dos escalas distintas y atarlas haría que cambiar una cambie la otra sin
 * querer. A 30 días esto daría 0,0 % en los siete sectores que más fallan
 * —medido—, o sea una columna de ceros que no ordena nada.
 */
export const PLAZO_DEL_SECTOR = 7;

const MS_POR_DIA = 86_400_000;

/** Los días corridos de un `YYYY-MM-DD`, sin pasar por la zona horaria. */
function numeroDeDia(fecha: string): number {
  const [a, m, d] = fecha.split("-").map(Number);
  return Date.UTC(a, m - 1, d) / MS_POR_DIA;
}

/** Una orden como la necesita esta cuenta. */
export interface OtDeSector {
  ot_number: number;
  tipo: string | null;
  fecha: string | null;
  fecha_ejecucion: string | null;
  sector_id: string | null;
  horas: number | null;
  contratista: string | null;
}

/** Un mes de la serie de un sector. */
export interface PuntoMensual {
  etiqueta: string;
  /** Fallas del sector en ese mes calendario. */
  fallas: number;
  /** Confiabilidad al cierre de ese mes. `null` cuando no alcanza a medirse. */
  confiabilidad: number | null;
}

/** Un mes de la serie de órdenes, abierta por sector. */
export interface OrdenesDelMes {
  etiqueta: string;
  /** Cuántas órdenes de todos los tipos, por id de sector. */
  porSector: Record<string, number>;
}

export interface FilaDeSector {
  sectorId: string;
  fallas: number;
  /** Días entre la primera falla **de este sector** y `hasta`, inclusive. */
  diasObservados: number;
  /** Días. `null` cuando la ventana observada no llega a `MINIMO_OBSERVADO`. */
  mtbf: number | null;
  /** Las correctivas propias con horas: las que entran al promedio. */
  reparaciones: number;
  /** Horas. `null` bajo `MINIMO_REPARACIONES`: hay cuenta, todavía no promedio. */
  mttr: number | null;
  /**
   * Días de marcha entre fallas, descontando lo que llevó repararlas.
   *
   * Derivado de los dos de arriba, así que `null` si falta cualquiera.
   */
  mttf: number | null;
  /** Probabilidad 0..1 de aguantar `PLAZO_DEL_SECTOR` días. `null` sin mtbf. */
  confiabilidad: number | null;
  /** La falla más reciente del sector. */
  ultima: string;
  porMes: PuntoMensual[];
}

export interface IndicadoresPorSector {
  /** Ordenadas por mtbf ascendente —el que menos aguanta arriba—; las null al final. */
  filas: FilaDeSector[];
  ordenesPorMes: OrdenesDelMes[];
  /** La etiqueta del mes en curso, que va marcado como incompleto. */
  mesEnCurso: string;
  /**
   * Correctivas de la ventana sin sector.
   *
   * Va en el resultado y no en un `console.warn` por el mismo argumento que
   * `sinAtribuir` en `mtbf.ts`: quien lee el número tiene derecho a saber
   * sobre qué parte de las correctivas se calculó.
   */
  sinSector: number;
}

/** Una falla ya fechada, con lo que necesitan las dos cuentas. */
interface FallaDeSector {
  sectorId: string;
  fecha: string;
  horas: number | null;
  esDeTercero: boolean;
}

/**
 * Las correctivas fechadas, en la ventana que se pida.
 *
 * Se exporta para que la serie mensual pueda pedir ventanas más viejas que el
 * año sin volver a decidir qué es una falla ni cuándo pasó.
 */
function fallasEntre(
  ordenes: OtDeSector[],
  desde: string,
  hasta: string
): { fallas: FallaDeSector[]; sinSector: number } {
  const fallas: FallaDeSector[] = [];
  let sinSector = 0;

  for (const ot of ordenes) {
    if (ot.tipo !== "CORRECTIVO") continue;
    const fecha = fechaDeFalla(ot);
    // Lo ejecutado después de `hasta` queda afuera: hay órdenes con fechas del
    // futuro por errores de carga y no son fallas que ya ocurrieron.
    if (fecha === null || fecha < desde || fecha > hasta) continue;

    if (ot.sector_id === null) {
      sinSector += 1;
      continue;
    }

    fallas.push({
      sectorId: ot.sector_id,
      fecha,
      // Cero horas no es «duró cero»: es que no se cargó. Una reparación que
      // existe duró algo, aunque sea diez minutos.
      horas: ot.horas !== null && ot.horas > 0 ? ot.horas : null,
      esDeTercero: esDeUnTercero(ot),
    });
  }

  return { fallas, sinSector };
}

const promedio = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

export function indicadoresPorSector(
  ordenes: OtDeSector[],
  hasta: string
): IndicadoresPorSector {
  const desde = sumarDias(hasta, -(VENTANA_DIAS - 1));
  const { fallas, sinSector } = fallasEntre(ordenes, desde, hasta);

  const meses = ultimosMeses(new Date(hasta + "T00:00:00"), 12);
  const mesEnCurso = meses[meses.length - 1].etiqueta;

  const porSector = new Map<string, FallaDeSector[]>();
  for (const f of fallas) {
    const suyas = porSector.get(f.sectorId) ?? [];
    suyas.push(f);
    porSector.set(f.sectorId, suyas);
  }

  const filas: FilaDeSector[] = [...porSector.entries()].map(([sectorId, suyas]) => {
    const fechas = suyas.map((f) => f.fecha);
    const primera = fechas.reduce((min, f) => (f < min ? f : min), fechas[0]);
    const diasObservados = numeroDeDia(hasta) - numeroDeDia(primera) + 1;
    const mtbf = diasObservados >= MINIMO_OBSERVADO ? diasObservados / suyas.length : null;

    const propias = suyas.filter((f) => !f.esDeTercero && f.horas !== null);
    const mttr =
      propias.length >= MINIMO_REPARACIONES
        ? promedio(propias.map((f) => f.horas as number))
        : null;

    return {
      sectorId,
      fallas: suyas.length,
      diasObservados,
      mtbf,
      reparaciones: propias.length,
      mttr,
      // Recortado en cero: un sector cuyo MTTR superara al MTBF daría un
      // número negativo, que en pantalla no se entiende. Cero se lee como «no
      // llega a arrancar entre reparación y reparación», que es lo que estaría
      // pasando. Hoy no ocurre —el margen más chico es Filler 1, 1,9 días
      // contra 0,12— pero la cuenta no depende de que eso siga así.
      mttf: mtbf === null || mttr === null ? null : Math.max(0, mtbf - mttr / 24),
      confiabilidad: mtbf === null ? null : confiabilidad(mtbf, PLAZO_DEL_SECTOR),
      ultima: fechas.reduce((max, f) => (f > max ? f : max), fechas[0]),
      porMes: [],
    };
  });

  filas.sort((a, b) => {
    if (a.mtbf === null && b.mtbf === null) return b.fallas - a.fallas;
    if (a.mtbf === null) return 1;
    if (b.mtbf === null) return -1;
    return a.mtbf - b.mtbf;
  });

  return { filas, ordenesPorMes: [], mesEnCurso, sinSector };
}
