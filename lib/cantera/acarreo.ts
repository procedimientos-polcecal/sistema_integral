/**
 * Acarreo: cuánto transportó cada fletero por mes, y cuánto se le paga.
 *
 * Relevado en vivo contra la planilla real de balanza/transporte
 * ("Ingreso de Datos", "Tarifas", "Resumen", "Acarreo"). Los 19 tipos de acá
 * son exactamente los renglones que tiene cada fletero en esa pestaña; la
 * unidad de cada uno (tonelada/hora/viaje) sale de mirar la columna "Tarifa
 * ($/tn o $/hr)" de la pestaña Tarifas.
 *
 * `yacimientoCodigo` es informativo (de qué cantera sale típicamente ese
 * material) y no lo usa "toneladas por yacimiento" — esa cuenta va por el
 * `ORIGEN` real de cada pesada (`toneladasPorYacimientoDesdePesadas` en
 * `pesadas.ts`), que no es ambiguo ni siquiera para "Caliza": una pesada de
 * caliza con origen C1 es de C1. Enlazar por el nombre del material, en
 * cambio, sí era una apuesta —tanto C1 como C3 dan caliza— y encima quedó
 * mal (el bug real que encontró el usuario comparando contra la planilla).
 */

export type UnidadDeAcarreo = "tonelada" | "hora" | "viaje";

export interface TipoDeAcarreo {
  codigo: string;
  etiqueta: string;
  unidad: UnidadDeAcarreo;
  /** El código corto del yacimiento del que suele salir (`D1`, `D6`, `C1`, `C3`), o `null` si no es uno solo. Sólo informativo, ver el comentario de arriba. */
  yacimientoCodigo: string | null;
}

export const TIPOS_DE_ACARREO: readonly TipoDeAcarreo[] = [
  { codigo: "dolomita_d1", etiqueta: "Dolomita D1", unidad: "tonelada", yacimientoCodigo: "D1" },
  { codigo: "dolomita_d6", etiqueta: "Dolomita D6", unidad: "tonelada", yacimientoCodigo: "D6" },
  { codigo: "chocolata_1", etiqueta: "Chocolata 1", unidad: "tonelada", yacimientoCodigo: "C1" },
  { codigo: "chocolata_3", etiqueta: "Chocolata 3", unidad: "tonelada", yacimientoCodigo: "C3" },
  { codigo: "caliza", etiqueta: "Caliza", unidad: "tonelada", yacimientoCodigo: null },
  { codigo: "arcilla", etiqueta: "Arcilla", unidad: "tonelada", yacimientoCodigo: null },
  { codigo: "finos_dolomita", etiqueta: "Finos Dolomita", unidad: "tonelada", yacimientoCodigo: null },
  { codigo: "descarte_dolomita", etiqueta: "Descarte Dolomita", unidad: "tonelada", yacimientoCodigo: null },
  { codigo: "finos_chocolata", etiqueta: "Finos Chocolata", unidad: "tonelada", yacimientoCodigo: null },
  { codigo: "descarte_chocolata", etiqueta: "Descarte Chocolata", unidad: "tonelada", yacimientoCodigo: null },
  { codigo: "material_a_pavone", etiqueta: "Material a Pavone (Arena)", unidad: "tonelada", yacimientoCodigo: null },
  { codigo: "finos_caliza", etiqueta: "Finos Caliza", unidad: "tonelada", yacimientoCodigo: null },
  { codigo: "material_desde_pavone", etiqueta: "Material desde Pavone / Serjen", unidad: "tonelada", yacimientoCodigo: null },
  { codigo: "estabilizado_a_cantera", etiqueta: "Estabilizado a Cantera", unidad: "tonelada", yacimientoCodigo: null },
  { codigo: "viajes_estabilizado", etiqueta: "Viajes de estabilizado", unidad: "viaje", yacimientoCodigo: null },
  { codigo: "horas_destape", etiqueta: "Horas destape", unidad: "hora", yacimientoCodigo: null },
  { codigo: "viaje_de_bloques", etiqueta: "Viaje de bloques", unidad: "viaje", yacimientoCodigo: null },
  { codigo: "hora_bochones", etiqueta: "Hora movimiento bochones pozo", unidad: "hora", yacimientoCodigo: null },
  { codigo: "materiales_pezzuchi", etiqueta: "Materiales Pezzuchi", unidad: "tonelada", yacimientoCodigo: null },
] as const;

const POR_CODIGO = new Map(TIPOS_DE_ACARREO.map((t) => [t.codigo, t]));

export function tipoDeAcarreo(codigo: string): TipoDeAcarreo | null {
  return POR_CODIGO.get(codigo) ?? null;
}

export function esTipoDeAcarreoValido(v: unknown): v is string {
  return typeof v === "string" && POR_CODIGO.has(v);
}

export const ETIQUETA_UNIDAD: Record<UnidadDeAcarreo, string> = {
  tonelada: "tn",
  hora: "hs",
  viaje: "viajes",
};

export interface TarifaAcarreo {
  tipo: string;
  desde: string; // "YYYY-MM-DD"
  hasta: string | null;
  tarifa: number;
}

/**
 * La tarifa de un tipo vigente en un mes dado (`"YYYY-MM"` o cualquier fecha
 * de ese mes). Cambian cada dos meses en la planilla real, así que "la
 * tarifa de julio" y "la tarifa de agosto" pueden ser la misma fila o no.
 *
 * Si dos vigencias se solapan (la base no lo impide, sólo evita que dos
 * empiecen el mismo día), gana la de `desde` más reciente: es la corrección
 * más nueva, no la carga más vieja.
 */
export function tarifaVigente(tarifas: TarifaAcarreo[], tipo: string, mes: string): TarifaAcarreo | null {
  const fecha = mes.length === 7 ? `${mes}-01` : mes;
  const candidatas = tarifas
    .filter((t) => t.tipo === tipo && t.desde <= fecha && (t.hasta === null || t.hasta >= fecha))
    .sort((a, b) => (a.desde < b.desde ? 1 : -1));
  return candidatas[0] ?? null;
}

/** `cantidad × tarifa`, o `null` si no hay tarifa vigente ese mes. */
export function montoAcarreo(cantidad: number | null, tarifa: TarifaAcarreo | null): number | null {
  if (cantidad === null || !isFinite(cantidad)) return null;
  if (tarifa === null) return null;
  return cantidad * tarifa.tarifa;
}

export interface AcarreoPlano {
  fleteroId: string;
  tipo: string;
  mes: string; // "YYYY-MM-DD", primer día
  cantidad: number;
}

export interface FilaResumenFletero {
  fleteroId: string;
  mes: string;
  /** Por tipo: cantidad cargada y monto calculado (null si no hay tarifa). */
  porTipo: { tipo: string; cantidad: number; monto: number | null }[];
  totalMonto: number;
  /** Tipos con cantidad cargada pero sin tarifa vigente ese mes — para avisar, no para ocultar. */
  sinTarifa: string[];
}

/** El resumen mensual de un fletero: lo mismo que la columna de un mes en "Resumen". */
export function resumenPorFletero(
  acarreos: AcarreoPlano[],
  tarifas: TarifaAcarreo[],
  fleteroId: string,
  mes: string
): FilaResumenFletero {
  const deEsteFleteroYMes = acarreos.filter((a) => a.fleteroId === fleteroId && a.mes.slice(0, 7) === mes.slice(0, 7));

  const porTipo = deEsteFleteroYMes.map((a) => {
    const tarifa = tarifaVigente(tarifas, a.tipo, mes);
    return { tipo: a.tipo, cantidad: a.cantidad, monto: montoAcarreo(a.cantidad, tarifa) };
  });

  return {
    fleteroId,
    mes,
    porTipo,
    totalMonto: porTipo.reduce((s, p) => s + (p.monto ?? 0), 0),
    sinTarifa: porTipo.filter((p) => p.monto === null).map((p) => p.tipo),
  };
}

export interface FilaToneladasPorYacimiento {
  yacimientoCodigo: string;
  mes: string;
  toneladas: number;
}

/**
 * Toneladas por yacimiento y mes: `toneladasPorYacimientoDesdePesadas` de
 * `pesadas.ts`, no una función de acá.
 *
 * La primera versión de esto sumaba por el **tipo** de material (Dolomita
 * D1 → yacimiento D1) y sólo entre los acarreos ya atribuidos a un fletero —
 * las dos decisiones estaban mal. El usuario detectó el número raro contra
 * la planilla real: faltaban justo las pesadas con fletero sin resolver
 * (354 de 7510, un mes se caía D1 de 4074 t reales a 3060 t), porque "de qué
 * yacimiento vino la piedra" no tiene nada que ver con quién la llevó. Y el
 * **origen** de la pesada —que si está en "Datos"— resuelve además la
 * ambigüedad de "Caliza" sin adivinar: una pesada de caliza con origen C1 es
 * de C1, no hace falta excluirla.
 */
