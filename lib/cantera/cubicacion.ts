/**
 * Cubicación mensual por yacimiento: el balance físico de la planilla real
 * "CUBICACIÓN CANTERA" (pestaña "CIERRE CANTERAS"), reproducido acá.
 *
 * De las cuatro cantidades del balance, tres salen de datos que el SdG ya
 * tiene (fases 1 y 2): las voladuras del mes por yacimiento —agrupadas por
 * **fin de perforación**, no por fecha de voladura, que es como cierra la
 * planilla real— y el acarreo del mes por yacimiento, que sale de
 * `toneladasPorYacimientoDesdePesadas` (`./pesadas.ts`). La cuarta,
 * "Existencia final", es una medición física a fin de mes que nadie puede
 * calcular: es el único dato que se carga a mano, en `cantera_cubicaciones`.
 *
 * Todo lo de acá es puro: no lee la base ni Sheets. Quien llama arma los
 * arreglos de entrada con lo que ya trajo de `consultas.ts`.
 */

export type LecturaDeCubicacion = "CIERRA" | "ACEPTABLE" | "REVISAR" | "SIN ACTIVIDAD";

/** Hasta acá el residuo es ruido de balanza/medición, no un problema real. */
const UMBRAL_CIERRA = 0.05;
/** Entre este umbral y el anterior, para vigilar; más allá, revisar. */
const UMBRAL_ACEPTABLE = 0.10;

export interface VoladuraParaCubicacion {
  /** Código del yacimiento (D1, D6, C1, C3). */
  yacimiento: string;
  /** "YYYY-MM-DD", o null si todavía no terminó de perforarse. */
  perfFin: string | null;
  toneladas: number | null;
  /** Metros perforados (o volados, si se cargaron aparte) — para el factor t/m. */
  metros: number | null;
}

/** Toneladas acarreadas de un yacimiento en un mes — misma forma que devuelve `toneladasPorYacimientoDesdePesadas`. */
export interface AcarreoPorYacimiento {
  yacimientoCodigo: string;
  mes: string; // "YYYY-MM"
  toneladas: number;
}

/** Un cierre ya cargado a mano: sólo lo que no se puede calcular. */
export interface CierreCargado {
  yacimientoCodigo: string;
  mes: string; // "YYYY-MM"
  existenciaFinal: number;
  observaciones: string | null;
}

export interface FilaCierreCubicacion {
  mes: string; // "YYYY-MM"
  yacimientoCodigo: string;
  /** Existencia final del mes anterior. Null si ese mes no tiene un cierre cargado — no se inventa un cero. */
  existenciaInicial: number | null;
  voladuras: number;
  acarreo: number;
  stockTeorico: number | null;
  existenciaFinal: number | null;
  observaciones: string | null;
  /** Stock teórico − existencia final. Positivo: sobra piedra sin explicar; negativo: falta. */
  residuo: number | null;
  /** Residuo sobre lo volado, no sobre el stock — ver la nota en el módulo. */
  porcentajeSobreVoladuras: number | null;
  metros: number | null;
  /** Toneladas voladas / metros perforados este mes. */
  factorNominal: number | null;
  /** El factor t/m que haría cerrar el balance exacto, dado lo que se acarreó y cómo se movió el stock. */
  factorImplicito: number | null;
  /** factorImplicito / factorNominal − 1. */
  desvioFactor: number | null;
  lectura: LecturaDeCubicacion | null;
}

/**
 * El cierre de un yacimiento en un mes puntual — la cuenta de una sola fila
 * de "CIERRE CANTERAS". No decide qué mes es "el mes anterior": recibe la
 * existencia inicial ya resuelta, para que la cadena entre meses la arme
 * `armarCierresCubicacion` una sola vez.
 */
export function cerrarCubicacionDelMes(
  mes: string,
  yacimientoCodigo: string,
  voladuras: VoladuraParaCubicacion[],
  acarreoDelMes: number,
  existenciaInicial: number | null,
  cierreCargado: CierreCargado | null
): FilaCierreCubicacion {
  const deEsteYacimientoYMes = voladuras.filter(
    (v) => v.yacimiento === yacimientoCodigo && (v.perfFin ?? "").startsWith(mes)
  );
  const toneladasVoladas = deEsteYacimientoYMes.reduce((s, v) => s + (v.toneladas ?? 0), 0);
  const metros = deEsteYacimientoYMes.reduce((s, v) => s + (v.metros ?? 0), 0);

  const existenciaFinal = cierreCargado?.existenciaFinal ?? null;
  const stockTeorico = existenciaInicial == null ? null : existenciaInicial + toneladasVoladas - acarreoDelMes;
  const residuo = stockTeorico == null || existenciaFinal == null ? null : stockTeorico - existenciaFinal;
  const porcentajeSobreVoladuras =
    residuo == null || toneladasVoladas === 0 ? null : residuo / toneladasVoladas;

  const factorNominal = metros === 0 ? null : toneladasVoladas / metros;
  const factorImplicito =
    metros === 0 || existenciaFinal == null || existenciaInicial == null
      ? null
      : (acarreoDelMes + existenciaFinal - existenciaInicial) / metros;
  const desvioFactor =
    factorNominal == null || factorImplicito == null ? null : factorImplicito / factorNominal - 1;

  let lectura: LecturaDeCubicacion | null = null;
  if (existenciaFinal != null) {
    if (toneladasVoladas === 0) lectura = "SIN ACTIVIDAD";
    else if (porcentajeSobreVoladuras != null) {
      const abs = Math.abs(porcentajeSobreVoladuras);
      lectura = abs <= UMBRAL_CIERRA ? "CIERRA" : abs <= UMBRAL_ACEPTABLE ? "ACEPTABLE" : "REVISAR";
    }
  }

  return {
    mes,
    yacimientoCodigo,
    existenciaInicial,
    voladuras: toneladasVoladas,
    acarreo: acarreoDelMes,
    stockTeorico,
    existenciaFinal,
    observaciones: cierreCargado?.observaciones ?? null,
    residuo,
    porcentajeSobreVoladuras,
    metros: metros === 0 ? null : metros,
    factorNominal,
    factorImplicito,
    desvioFactor,
    lectura,
  };
}

/** "2026-07" + 1 = "2026-08"; envuelve el año. */
function mesSiguiente(mes: string): string {
  const [anio, m] = mes.split("-").map(Number);
  const total = anio * 12 + (m - 1) + 1;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/**
 * Todos los meses entre el primero y el último cierre cargado (de cualquier
 * yacimiento), sin huecos — para que un mes sin cierre en ningún yacimiento
 * siga contando como "un mes que pasó" y corte la cadena del que sigue, en
 * vez de desaparecer de la cuenta.
 */
function rangoDeMeses(mesesConCierre: string[]): string[] {
  if (mesesConCierre.length === 0) return [];
  const ordenados = [...mesesConCierre].sort();
  const primero = ordenados[0];
  const ultimo = ordenados[ordenados.length - 1];
  const meses: string[] = [];
  for (let mes = primero; mes <= ultimo; mes = mesSiguiente(mes)) meses.push(mes);
  return meses;
}

/**
 * La tabla completa, un yacimiento a la vez: encadena la existencia inicial
 * de cada mes con la final del anterior. Si un mes no tiene cierre cargado,
 * el que sigue pierde la cadena —queda sin existencia inicial— en vez de
 * arrastrar un número de dos meses atrás como si nada hubiera pasado en el
 * medio. Por eso el rango de meses no sale de los que están cargados: sale
 * de **todos** los meses entre el primero y el último, cargados o no
 * (`rangoDeMeses`), para no saltearse justo el mes que cortaría la cadena.
 */
export function armarCierresCubicacion(
  yacimientos: string[],
  voladuras: VoladuraParaCubicacion[],
  acarreos: AcarreoPorYacimiento[],
  cierresCargados: CierreCargado[]
): FilaCierreCubicacion[] {
  const meses = rangoDeMeses(cierresCargados.map((c) => c.mes));
  const filas: FilaCierreCubicacion[] = [];

  for (const yacimientoCodigo of yacimientos) {
    let existenciaAnterior: number | null = null;
    for (const mes of meses) {
      const cierreCargado = cierresCargados.find((c) => c.yacimientoCodigo === yacimientoCodigo && c.mes === mes) ?? null;
      const acarreoDelMes = acarreos.find((a) => a.yacimientoCodigo === yacimientoCodigo && a.mes === mes)?.toneladas ?? 0;
      const fila = cerrarCubicacionDelMes(mes, yacimientoCodigo, voladuras, acarreoDelMes, existenciaAnterior, cierreCargado);
      filas.push(fila);
      existenciaAnterior = cierreCargado?.existenciaFinal ?? null;
    }
  }

  return filas;
}
