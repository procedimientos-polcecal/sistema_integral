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
import { ultimosMeses, type Mes } from "./dashboard";
import {
  fechaDeFalla, VENTANA_DIAS, MINIMO_OBSERVADO, DIAS_RECIENTE, confiabilidad,
} from "./mtbf";
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

/**
 * Cuántas fallas necesita un punto de la serie mensual para publicarse.
 *
 * Mismo espíritu que `MINIMO_REPARACIONES`: con una o dos, «el promedio» es
 * esa falla. El punto queda en `null` y el gráfico deja el hueco, que es lo
 * que `connectNulls={false}` existe para dibujar.
 */
export const MINIMO_FALLAS_DEL_MES = 3;

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
  /** `null` cuando la orden no tiene sector: se cuenta aparte. */
  sectorId: string | null;
  fecha: string;
  horas: number | null;
  esDeTercero: boolean;
}

/**
 * Las correctivas fechadas, en la ventana que se pida.
 *
 * La ventana es un parámetro y no `VENTANA_DIAS` porque acá se piden dos: la
 * del año, que es la de los números grandes, y una más ancha para que el
 * primer punto de la serie mensual tenga sus 90 días de atrás.
 */
function fallasEntre(
  ordenes: OtDeSector[],
  desde: string,
  hasta: string
): FallaDeSector[] {
  const fallas: FallaDeSector[] = [];

  for (const ot of ordenes) {
    if (ot.tipo !== "CORRECTIVO") continue;
    const fecha = fechaDeFalla(ot);
    // Lo ejecutado después de `hasta` queda afuera: hay órdenes con fechas del
    // futuro por errores de carga y no son fallas que ya ocurrieron.
    if (fecha === null || fecha < desde || fecha > hasta) continue;

    fallas.push({
      sectorId: ot.sector_id,
      fecha,
      // Cero horas no es «duró cero»: es que no se cargó. Una reparación que
      // existe duró algo, aunque sea diez minutos.
      horas: ot.horas !== null && ot.horas > 0 ? ot.horas : null,
      esDeTercero: esDeUnTercero(ot),
    });
  }

  return fallas;
}

const promedio = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * La confiabilidad de un conjunto de fallas que termina en `fin`.
 *
 * Devuelve `null` en vez de un número cuando lo que hay no alcanza para
 * medir: menos de `MINIMO_FALLAS_DEL_MES` fallas, o menos de
 * `MINIMO_OBSERVADO` días entre la primera y el corte.
 */
function confiabilidadDeLaVentana(fechas: string[], fin: string): number | null {
  if (fechas.length < MINIMO_FALLAS_DEL_MES) return null;

  const primera = fechas.reduce((min, f) => (f < min ? f : min), fechas[0]);
  const observados = numeroDeDia(fin) - numeroDeDia(primera) + 1;
  if (observados < MINIMO_OBSERVADO) return null;

  return confiabilidad(observados / fechas.length, PLAZO_DEL_SECTOR);
}

/**
 * Dónde termina cada mes para la serie.
 *
 * El último corta en `hasta` y no en el fin del mes, porque el mes no terminó:
 * contar las fallas de diecinueve días contra treinta baja el ritmo sin que
 * haya pasado nada.
 */
function cortesDeLosMeses(meses: Mes[], hasta: string): string[] {
  return meses.map((m, i) =>
    i === meses.length - 1 ? hasta : sumarDias(m.hasta, -1)
  );
}

export function indicadoresPorSector(
  ordenes: OtDeSector[],
  hasta: string
): IndicadoresPorSector {
  const desde = sumarDias(hasta, -(VENTANA_DIAS - 1));
  const meses = ultimosMeses(new Date(hasta + "T00:00:00"), 12);
  const mesEnCurso = meses[meses.length - 1].etiqueta;
  const cortes = cortesDeLosMeses(meses, hasta);

  // ── POR QUÉ LA SERIE MENSUAL MIRA 90 DÍAS Y NO EL MES ────────────────────
  //
  // Un mes suelto tiene muy pocas fallas y el número salta. Medido el
  // 19/11/2026: Planta filler 1 lleva 2 fallas en noviembre contra 10 a 25 por
  // mes el resto del año, así que con el mes solo el sector que peor anda
  // cierra el año en 33 % cuando su confiabilidad anual es 2,5 %. El salto se
  // repite todos los meses, siempre en el último punto, y se lee como una
  // mejora que no pasó. Con la ventana móvil ese mismo punto da 8 %.
  //
  // Hay dos razones más. El dato llega tarde: 10 de las 70 correctivas
  // ejecutadas en agosto se cargaron en un mes posterior (p90 de 16 días), así
  // que el penúltimo punto también nace corto. Y con el mes solo hay huecos de
  // verdad — Trituración 3 no falló ni en octubre ni en noviembre, o sea que
  // su línea se cortaba justo en los dos meses que alguien va a mirar. Con los
  // 90 días no queda un solo hueco en doce meses por ocho sectores.
  //
  // 90 es `DIAS_RECIENTE`, que ya es lo que este módulo llama «el ritmo
  // reciente»; con 180 la línea queda tan plana que no dice nada.
  const desdeAmplio = sumarDias(cortes[0], -(DIAS_RECIENTE - 1));
  const todas = fallasEntre(ordenes, desdeAmplio < desde ? desdeAmplio : desde, hasta);

  const sinSector = todas.filter((f) => f.sectorId === null && f.fecha >= desde).length;

  const porSector = new Map<string, FallaDeSector[]>();
  for (const f of todas) {
    if (f.sectorId === null) continue;
    const suyas = porSector.get(f.sectorId) ?? [];
    suyas.push(f);
    porSector.set(f.sectorId, suyas);
  }

  const filas: FilaDeSector[] = [];
  for (const [sectorId, todasLasSuyas] of porSector) {
    // La fila habla del año: las fallas más viejas están para que el primer
    // punto de la serie tenga con qué, no para engordar el MTBF.
    const suyas = todasLasSuyas.filter((f) => f.fecha >= desde);
    if (suyas.length === 0) continue;

    const fechas = suyas.map((f) => f.fecha);
    const primera = fechas.reduce((min, f) => (f < min ? f : min), fechas[0]);
    const diasObservados = numeroDeDia(hasta) - numeroDeDia(primera) + 1;
    const mtbf = diasObservados >= MINIMO_OBSERVADO ? diasObservados / suyas.length : null;

    const propias = suyas.filter((f) => !f.esDeTercero && f.horas !== null);
    const mttr =
      propias.length >= MINIMO_REPARACIONES
        ? promedio(propias.map((f) => f.horas as number))
        : null;

    filas.push({
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
      porMes: meses.map((mes, i) => {
        const fin = cortes[i];
        const ventana = sumarDias(fin, -(DIAS_RECIENTE - 1));
        return {
          etiqueta: mes.etiqueta,
          // Las fallas son las del mes calendario y la confiabilidad mira
          // noventa días: son dos ventanas distintas en el mismo punto, a
          // propósito. La barra dice qué pasó ese mes; la línea, cómo viene.
          fallas: todasLasSuyas.filter((f) => f.fecha >= mes.desde && f.fecha < mes.hasta).length,
          confiabilidad: confiabilidadDeLaVentana(
            todasLasSuyas.filter((f) => f.fecha >= ventana && f.fecha <= fin).map((f) => f.fecha),
            fin
          ),
        };
      }),
    });
  }

  filas.sort((a, b) => {
    if (a.mtbf === null && b.mtbf === null) return b.fallas - a.fallas;
    if (a.mtbf === null) return 1;
    if (b.mtbf === null) return -1;
    return a.mtbf - b.mtbf;
  });

  return { filas, ordenesPorMes: ordenesPorMes(ordenes, meses), mesEnCurso, sinSector };
}

/**
 * Cuántas órdenes se generaron cada mes, abiertas por sector.
 *
 * **Cuenta por `fecha` y no por la ejecución**, al revés que todo lo de
 * arriba. No es una inconsistencia: este gráfico va al lado del de «OT
 * generadas por mes» que ya está en el tablero, y ése cuenta por `fecha`.
 * Medido el 19/11/2026, 618 de 2.532 órdenes (24 %) caen en un mes distinto
 * según cuál de las dos fechas se use —noviembre da 202 por carga contra 159
 * por ejecución—, así que dos gráficos de órdenes por mes con fechas
 * distintas tendrían barras que no suman y nada lo diría.
 *
 * Una orden sin sector no entra: son 1 de 2.531 y no hay columna donde
 * ponerla. Las correctivas sin sector sí se cuentan, en `sinSector`.
 */
function ordenesPorMes(ordenes: OtDeSector[], meses: Mes[]): OrdenesDelMes[] {
  const vacios = meses.map((m) => ({ etiqueta: m.etiqueta, porSector: {} as Record<string, number> }));

  for (const ot of ordenes) {
    if (ot.sector_id === null) continue;
    const fecha = String(ot.fecha ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) continue;

    const i = meses.findIndex((m) => fecha >= m.desde && fecha < m.hasta);
    if (i === -1) continue;

    vacios[i].porSector[ot.sector_id] = (vacios[i].porSector[ot.sector_id] ?? 0) + 1;
  }

  return vacios;
}
