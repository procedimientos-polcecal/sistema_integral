/**
 * Las filas tal como van a la planilla de cantera — pura conversión, sin red.
 *
 * Acá manda el sistema, no la planilla (igual que Producción y Despacho): lo
 * que arma esto es lo que `espejo.ts` escribe. Los encabezados reales de las
 * tres pestañas, relevados contra la planilla en vivo, son la fuente de este
 * orden de columnas — cambiar el orden acá sin tocar la planilla desalinea
 * todo lo que se escriba de acá en más.
 */

import { montoBochon, montoPerforacion, montoVoladura, cruce, type LecturaDeCruce } from "./costos";
import { toneladasEstimadas } from "./toneladas";
import { metrosYPozos } from "./tramos";
import type { Bochon, Voladura, Yacimiento } from "./types";

/** "8/9/2026": d/m, como escribe la planilla. Nunca m/d — eso dio vuelta 885 fechas en Compras. */
export function fechaComoSeEscribe(fecha: string | null): string {
  if (!fecha) return "";
  const m = fecha.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${Number(m[3])}/${Number(m[2])}/${m[1]}`;
}

/** Un número tal como lo entiende `USER_ENTERED`: punto decimal, sin separador de miles ni signo $. */
function numeroComoSeEscribe(v: number | null): string {
  return v == null || !isFinite(v) ? "" : String(v);
}

/**
 * "COINCIDE" / "NO COINCIDE", como ya escribía la columna "Coincide" —
 * confirmado contra filas reales de la planilla (V01D626: "NO COINCIDE").
 * Vacío si todavía no hay con qué comparar.
 */
export function coincideComoSeEscribe(lectura: LecturaDeCruce): string {
  if (lectura === "coincide") return "COINCIDE";
  if (lectura === "revisar") return "NO COINCIDE";
  return "";
}

/** Un renglón de consumo ya resuelto (con el nombre del insumo), lo mínimo que necesita este archivo. */
export interface RenglonPlano {
  insumo: string | null;
  cantidad: number | null;
  precio_usd: number | null;
  tipo: string | null;
}

/**
 * La columna "Explosivos" de VOLADURAS: antes se tipeaba a mano
 * ("emulex: 235 - anfo premium: 845"). Ahora que ese campo se sacó del
 * editor —el monto sale de la grilla de consumos, no de este texto—, se arma
 * solo a partir de los mismos renglones, para que quien sólo mira la
 * planilla siga viendo qué se cargó.
 *
 * Sólo entran los de tipo "detonador" —el nombre confunde, pero es la
 * categoría del explosivo a granel (emulex, anfo), no de los detonadores
 * como dispositivo—, que es lo que esa columna venía listando: los
 * accesorios (`otros_insumos`) y el servicio (`voladura`) quedan afuera,
 * verificado contra la fila real de V01D626.
 */
export function resumenExplosivos(consumos: RenglonPlano[]): string {
  return consumos
    .filter((c) => c.tipo === "detonador" && c.insumo)
    .map((c) => `${c.insumo}${c.cantidad != null ? `: ${numeroComoSeEscribe(c.cantidad)}` : ""}`)
    .join(" - ");
}

export const COLUMNAS_PERFORACION = 13;
export const COLUMNAS_VOLADURAS = 19;
export const COLUMNAS_BOCHONES = 13;

/** La fila de PERFORACIÓN para una voladura, A a M. */
export function filaPerforacion(v: Voladura, yac: Yacimiento | null): string[] {
  const perf = metrosYPozos(v.perf_tramos, v.pozos, v.metros_por_pozo);
  const montoPerf = montoPerforacion({
    metros: perf.metros,
    precioUsdM: v.perf_precio_usd_m,
    tc: v.perf_tc_usd,
    nochesSereno: v.perf_noches_sereno,
    montoNoche: v.perf_monto_noche,
  });
  const profundidadProm = perf.pozos && perf.metros != null ? perf.metros / perf.pozos : null;

  return [
    v.codigo,
    fechaComoSeEscribe(v.perf_inicio),
    fechaComoSeEscribe(v.perf_fin),
    yac?.codigo ?? "",
    numeroComoSeEscribe(profundidadProm),
    numeroComoSeEscribe(perf.pozos),
    numeroComoSeEscribe(perf.metros),
    numeroComoSeEscribe(v.perf_tc_usd),
    numeroComoSeEscribe(v.perf_precio_usd_m),
    numeroComoSeEscribe(montoPerf),
    v.perf_odoo_ref ?? "",
    coincideComoSeEscribe(cruce(montoPerf, v.perf_odoo_importe).lectura),
    v.observaciones ?? "",
  ];
}

/** La fila de VOLADURAS para una voladura, A a S. */
export function filaVoladura(v: Voladura, yac: Yacimiento | null, consumos: RenglonPlano[]): string[] {
  const perf = metrosYPozos(v.perf_tramos, v.pozos, v.metros_por_pozo);
  const vol = metrosYPozos(v.vol_tramos, v.vol_pozos, v.vol_metros_por_pozo);
  const metrosVol = vol.metros ?? perf.metros;
  const pozosVol = vol.pozos ?? perf.pozos;

  const montoVol = montoVoladura(consumos, v.vol_tc_usd);
  const burdenEfectivo = v.vol_burden_m ?? v.burden_m ?? yac?.burden_m ?? null;
  const espaciamEfectivo = v.vol_espaciamiento_m ?? v.espaciamiento_m ?? yac?.espaciamiento_m ?? null;
  const densidadEfectiva = v.densidad_t_m3 ?? yac?.densidad_t_m3 ?? null;
  // La fórmula no reproduce la columna histórica —ya documentado en
  // `informe.ts`—, así que acá se prioriza `toneladas_planilla` igual que en
  // el informe: el objetivo del espejo es que la planilla se siga viendo
  // como siempre, no forzar el número calculado sobre un historial que no
  // cierra por el mismo motivo (malla real vs. malla de diseño). Sólo cae en
  // la fórmula para lo que se cargue de acá en más y todavía no la tenga.
  const toneladas =
    v.toneladas_planilla ??
    toneladasEstimadas({ metros: metrosVol, densidad: densidadEfectiva, burden: burdenEfectivo, espaciamiento: espaciamEfectivo });
  // "Factor t/m" es la constante de la malla —toneladas por metro perforado,
  // densidad × burden × espaciamiento— y no `toneladas/metros` de esta
  // voladura puntual: verificado contra la planilla real (V01D625 y V01D626
  // dan 18,55 los dos, con toneladas bien distintas entre sí). Dividir
  // habría escrito un número que cambia voladura a voladura encima de un
  // parámetro de diseño que no debería moverse.
  const factorTM =
    densidadEfectiva != null && burdenEfectivo != null && espaciamEfectivo != null
      ? densidadEfectiva * burdenEfectivo * espaciamEfectivo
      : null;

  return [
    v.codigo,
    fechaComoSeEscribe(v.vol_fecha_carga),
    fechaComoSeEscribe(v.vol_fecha),
    yac?.codigo ?? "",
    numeroComoSeEscribe(perf.pozos),
    numeroComoSeEscribe(perf.metros),
    numeroComoSeEscribe(toneladas),
    resumenExplosivos(consumos),
    numeroComoSeEscribe(v.vol_tc_usd),
    numeroComoSeEscribe(montoVol),
    v.vol_odoo_ref ?? "",
    coincideComoSeEscribe(cruce(montoVol, v.vol_odoo_importe).lectura),
    v.observaciones ?? "",
    numeroComoSeEscribe(pozosVol),
    numeroComoSeEscribe(metrosVol),
    numeroComoSeEscribe(burdenEfectivo),
    numeroComoSeEscribe(espaciamEfectivo),
    numeroComoSeEscribe(densidadEfectiva),
    numeroComoSeEscribe(factorTM),
  ];
}

/** La fila de BOCHONES para un bochón, A a M. */
export function filaBochon(b: Bochon, yac: Yacimiento | null): string[] {
  const monto = montoBochon({
    cantidad: b.cantidad,
    metrosPerforados: b.metros_perforados,
    precioUsdM: b.precio_usd_m,
    tc: b.tc_usd,
  });

  return [
    b.codigo,
    fechaComoSeEscribe(b.inicio),
    fechaComoSeEscribe(b.fin),
    numeroComoSeEscribe(b.precio_usd_m),
    yac?.codigo ?? "",
    b.voladura_codigo ?? "",
    // Los encabezados de la planilla vienen así de cruzados desde siempre
    // ("Metros perf." guarda ≤1m, "Perforaciones" la cantidad de bochones) —
    // confirmado con el usuario y ya documentado en `costos.ts`. Se escribe en
    // las mismas columnas de las que se leyó al importar, no en las que dice
    // el título.
    numeroComoSeEscribe(b.metros_perforados),
    numeroComoSeEscribe(b.cantidad),
    numeroComoSeEscribe(b.tc_usd),
    numeroComoSeEscribe(monto),
    b.odoo_ref ?? "",
    coincideComoSeEscribe(cruce(monto, b.odoo_importe).lectura),
    b.observaciones ?? "",
  ];
}
