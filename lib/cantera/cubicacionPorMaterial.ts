/**
 * Cubicación de C1 y C3 JUNTAS, con la existencia final cargada por material
 * (desde octubre/2026).
 *
 * C1 y C3 dan chocolata y caliza, y lo que se mide a fin de mes en los
 * galpones llega por material con las dos canteras mezcladas. Lo que NO se
 * puede saber es cuánto de lo que se vuela es de cada piedra: eso aparece
 * recién cuando el camión pasa por la balanza. Por eso:
 *
 *   · el balance es el de siempre (`armarCierresCubicacion`) pero con TOTALES:
 *     voladuras de C1+C3 y acarreo de C1+C3, sin dividir por material;
 *   · la existencia final se carga por material y su suma es la que entra;
 *   · el reparto chocolata/caliza sale al final, medido (`desglosarPorMaterial`).
 *
 * El porqué completo, con lo medido, está en el encabezado de la migración
 * `20261106091322`. Lo de acá es puro: no lee la base.
 */

import type { AcarreoPorYacimiento, CierreCargado, VoladuraParaCubicacion } from "./cubicacion";

export type MaterialDeCantera = "Chocolata" | "Caliza";

export const MATERIALES_DE_CANTERA: MaterialDeCantera[] = ["Chocolata", "Caliza"];

/** Los dos yacimientos que se cierran juntos. */
export const YACIMIENTOS_JUNTOS = ["C1", "C3"];

/** La clave con que C1+C3 viaja por `armarCierresCubicacion`, en el lugar del código de yacimiento. */
export const CLAVE_C1C3 = "C1+C3";

/**
 * Primer mes que se cierra con C1 y C3 juntas. Antes de éste se ven como
 * siempre, cada una por su cuenta. Octubre porque es el mes de la primera
 * tabla de stock por material (31/10/2026); lo anterior no se puede repartir.
 */
export const MES_DE_CORTE_POR_MATERIAL = "2026-10";

export function esMaterialDeCantera(v: unknown): v is MaterialDeCantera {
  return v === "Chocolata" || v === "Caliza";
}

/**
 * De qué material es una pesada, por su `tipo`. Sólo lo que dice "caliza" o
 * "chocolata" (incluidos los finos y el descarte): cualquier otra cosa es
 * `null` y se informa aparte, no se mete en uno por parecido.
 *
 * El `tipo` NO dice el yacimiento —hay `chocolata_1` con origen C3—: el
 * yacimiento sale del origen de la pesada, el material sale del tipo.
 */
export function materialDeTipoDePesada(tipo: string | null | undefined): MaterialDeCantera | null {
  const t = (tipo ?? "").toLowerCase();
  if (t.includes("caliza")) return "Caliza";
  if (t.includes("chocolata")) return "Chocolata";
  return null;
}

/** Las voladuras de C1 y de C3 como una sola: misma forma, con la clave de las dos juntas. */
export function juntarVoladurasC1C3(voladuras: VoladuraParaCubicacion[]): VoladuraParaCubicacion[] {
  return voladuras
    .filter((v) => YACIMIENTOS_JUNTOS.includes(v.yacimiento))
    .map((v) => ({ ...v, yacimiento: CLAVE_C1C3 }));
}

/** El acarreo de C1 y de C3 sumado por mes: lo que `toneladasPorYacimientoDesdePesadas` da por separado, junto. */
export function juntarAcarreoC1C3(acarreos: AcarreoPorYacimiento[]): AcarreoPorYacimiento[] {
  const porMes = new Map<string, number>();
  for (const a of acarreos) {
    if (!YACIMIENTOS_JUNTOS.includes(a.yacimientoCodigo)) continue;
    porMes.set(a.mes, (porMes.get(a.mes) ?? 0) + a.toneladas);
  }
  return [...porMes.entries()].map(([mes, toneladas]) => ({ yacimientoCodigo: CLAVE_C1C3, mes, toneladas }));
}

export interface PesadaPorOrigenTipoMes {
  origen: string;
  tipo: string | null;
  mes: string; // "YYYY-MM"
  toneladas: number;
}

/**
 * Lo acarreado desde C1+C3, repartido por material y mes. Lo que sale de C1/C3
 * con un tipo que no es ni caliza ni chocolata va a `sinMaterial`: cuenta en
 * el balance (que usa el total por origen) pero no en el desglose, y la
 * pantalla lo avisa para que no parezca que el desglose suma de menos.
 */
export function acarreoPorMaterial(filas: PesadaPorOrigenTipoMes[]): {
  porMaterial: { material: MaterialDeCantera; mes: string; toneladas: number }[];
  sinMaterial: { mes: string; toneladas: number }[];
} {
  const total = new Map<string, number>(); // `${material}|${mes}`
  const sin = new Map<string, number>(); // mes
  for (const f of filas) {
    if (!YACIMIENTOS_JUNTOS.includes(f.origen.trim().toUpperCase())) continue;
    const material = materialDeTipoDePesada(f.tipo);
    if (material === null) {
      sin.set(f.mes, (sin.get(f.mes) ?? 0) + f.toneladas);
      continue;
    }
    const clave = `${material}|${f.mes}`;
    total.set(clave, (total.get(clave) ?? 0) + f.toneladas);
  }
  return {
    porMaterial: [...total.entries()].map(([clave, toneladas]) => {
      const [material, mes] = clave.split("|");
      return { material: material as MaterialDeCantera, mes, toneladas };
    }),
    sinMaterial: [...sin.entries()].map(([mes, toneladas]) => ({ mes, toneladas })),
  };
}

/** Una existencia final cargada: un mes, un material. */
export interface ExistenciaDeMaterial {
  mes: string; // "YYYY-MM"
  material: MaterialDeCantera;
  /** Lo medido en las canteras. */
  existenciaFinal: number;
  /** Lo medido en galpones y acopios por triturar. Null: sin medir. */
  existenciaAcopio: number | null;
}

/**
 * Los cierres de C1+C3 para `armarCierresCubicacion`: por mes, la suma de los
 * dos materiales. **Sólo cuenta un mes si están cargados los dos**: con uno
 * solo, la suma parecería una existencia completa y daría un residuo falso por
 * la mitad que falta. Si de verdad no hay caliza, se carga 0.
 *
 * El acopio es null sólo si ninguno de los dos lo midió; si uno sí, el que no
 * cuenta como 0, igual que en el resto de la cubicación.
 */
export function cierresC1C3(existencias: ExistenciaDeMaterial[]): CierreCargado[] {
  const meses = [...new Set(existencias.map((e) => e.mes))];
  const cierres: CierreCargado[] = [];
  for (const mes of meses) {
    const delMes = existencias.filter((e) => e.mes === mes);
    if (!MATERIALES_DE_CANTERA.every((m) => delMes.some((e) => e.material === m))) continue;
    const acopios = delMes.map((e) => e.existenciaAcopio);
    cierres.push({
      yacimientoCodigo: CLAVE_C1C3,
      mes,
      existenciaFinal: delMes.reduce((s, e) => s + e.existenciaFinal, 0),
      existenciaAcopio: acopios.every((a) => a === null) ? null : acopios.reduce<number>((s, a) => s + (a ?? 0), 0),
      observaciones: null,
    });
  }
  return cierres;
}

export interface DesgloseDeMaterial {
  mes: string;
  material: MaterialDeCantera;
  /** La existencia total (canteras + acopio) del mes anterior. Null si ese mes no tiene esta existencia cargada. */
  existenciaInicial: number | null;
  /** La existencia total (canteras + acopio) de este mes. Null si no está cargada. */
  existenciaFinal: number | null;
  /** Lo que se acarreó de este material desde C1+C3 en el mes. */
  acarreo: number;
  /**
   * Cuánta piedra de este material salió de la cantera en el mes, **medida al
   * revés**: existencia final − inicial + acarreo. Es la respuesta a "¿cuánto
   * de lo volado fue chocolata y cuánto caliza?", que al volar no se sabe.
   * Null si falta la existencia inicial o la final.
   */
  extraidoImplicito: number | null;
  /** La parte de este material en lo extraído de los dos. Null si falta alguno de los dos o no hay nada. */
  parteDelTotal: number | null;
}

function mesAnterior(mes: string): string {
  const [anio, m] = mes.split("-").map(Number);
  const total = anio * 12 + (m - 1) - 1;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/**
 * El reparto chocolata/caliza de cada mes, medido: para cada material, cuánto
 * salió de la cantera según lo que se acarreó y lo que cambió su existencia.
 * No sustituye al balance —que cierra con totales—: lo explica.
 */
export function desglosarPorMaterial(
  meses: string[],
  existencias: ExistenciaDeMaterial[],
  acarreos: { material: MaterialDeCantera; mes: string; toneladas: number }[]
): DesgloseDeMaterial[] {
  const total = (mes: string, material: MaterialDeCantera): number | null => {
    const e = existencias.find((x) => x.mes === mes && x.material === material);
    return e ? e.existenciaFinal + (e.existenciaAcopio ?? 0) : null;
  };

  const filas: DesgloseDeMaterial[] = [];
  for (const mes of meses) {
    const delMes = MATERIALES_DE_CANTERA.map((material): DesgloseDeMaterial => {
      const existenciaFinal = total(mes, material);
      const existenciaInicial = total(mesAnterior(mes), material);
      const acarreo = acarreos.find((a) => a.mes === mes && a.material === material)?.toneladas ?? 0;
      const extraidoImplicito =
        existenciaFinal === null || existenciaInicial === null ? null : existenciaFinal - existenciaInicial + acarreo;
      return { mes, material, existenciaInicial, existenciaFinal, acarreo, extraidoImplicito, parteDelTotal: null };
    });
    const implicitos = delMes.map((f) => f.extraidoImplicito);
    if (implicitos.every((i): i is number => i !== null)) {
      const suma = implicitos.reduce((s, i) => s + i, 0);
      if (suma > 0) for (const f of delMes) f.parteDelTotal = (f.extraidoImplicito as number) / suma;
    }
    filas.push(...delMes);
  }
  return filas;
}
