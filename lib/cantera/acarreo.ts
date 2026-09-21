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
  // Corregido el 21/09/2026 a pedido del usuario: "viaje_de_bloques" se
  // carga en HORAS, no en cantidad de viajes — el nombre confunde. El monto
  // (cantidad × tarifa) no cambia: la tarifa ya estaba pensada en $/hora.
  { codigo: "viaje_de_bloques", etiqueta: "Viaje de bloques", unidad: "hora", yacimientoCodigo: null },
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

/**
 * El resumen mensual de un fletero: lo mismo que la columna de un mes en
 * "Resumen". Suma por tipo antes de calcular el monto —desde que
 * `cantera_acarreos` pasó a ser una fila por día (20260921092307), un mismo
 * fletero+tipo+mes puede traer varias filas (una por día cargado), y ya no
 * vale asumir una sola como antes.
 */
export function resumenPorFletero(
  acarreos: AcarreoPlano[],
  tarifas: TarifaAcarreo[],
  fleteroId: string,
  mes: string
): FilaResumenFletero {
  const deEsteFleteroYMes = acarreos.filter((a) => a.fleteroId === fleteroId && a.mes.slice(0, 7) === mes.slice(0, 7));

  const cantidadPorTipo = new Map<string, number>();
  for (const a of deEsteFleteroYMes) {
    cantidadPorTipo.set(a.tipo, (cantidadPorTipo.get(a.tipo) ?? 0) + a.cantidad);
  }

  const porTipo = [...cantidadPorTipo.entries()].map(([tipo, cantidad]) => {
    const tarifa = tarifaVigente(tarifas, tipo, mes);
    return { tipo, cantidad, monto: montoAcarreo(cantidad, tarifa) };
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

export interface FilaTotalPorTipo {
  tipo: string;
  etiqueta: string;
  unidad: UnidadDeAcarreo;
  cantidad: number;
}

/**
 * El total de la empresa en un mes, por tipo de material o actividad —la
 * pestaña "RESUMEN ANUAL DE MATERIALES" de la planilla real, que junta a
 * todos los fleteros por renglón. A diferencia de `resumenPorFletero`, no
 * hace falta saber quién hizo cada viaje: recibe cualquier lista con
 * `{tipo, mes, cantidad}` —tanto `cantera_acarreos` como las pesadas ya
 * agrupadas por tipo y mes (`agruparPesadasPorTipoMes` de `pesadas.ts`, que
 * a propósito no filtra por fletero, por la misma razón que
 * `toneladasPorYacimientoDesdePesadas`— y suma todo junto.
 *
 * Sólo entran los tipos con algo cargado ese mes: el usuario pidió ver "todo
 * lo que sea distinto a 0", no las diecinueve filas siempre.
 */
export function totalesPorTipo(
  entradas: { tipo: string; mes: string; cantidad: number }[],
  mes: string
): FilaTotalPorTipo[] {
  const totales = new Map<string, number>();
  for (const e of entradas) {
    if (e.mes.slice(0, 7) !== mes.slice(0, 7)) continue;
    totales.set(e.tipo, (totales.get(e.tipo) ?? 0) + e.cantidad);
  }

  return [...totales.entries()]
    .filter(([, cantidad]) => cantidad !== 0)
    .map(([tipo, cantidad]) => {
      const t = tipoDeAcarreo(tipo);
      return { tipo, etiqueta: t?.etiqueta ?? tipo, unidad: t?.unidad ?? "tonelada", cantidad };
    })
    .sort((a, b) => b.cantidad - a.cantidad);
}

export interface FilaResumenAnualTipo {
  tipo: string;
  etiqueta: string;
  unidad: UnidadDeAcarreo;
  /** Enero a diciembre, en ese orden. */
  porMes: number[];
  totalAnual: number;
}

/**
 * Lo mismo que `totalesPorTipo`, pero el año entero en una sola tabla —
 * "RESUMEN ANUAL DE MATERIALES" de la planilla real, mes a mes en vez de un
 * mes a la vez. Sólo entran los tipos con algo cargado en algún mes del año;
 * los que no tuvieron ningún movimiento no aparecen (como en `totalesPorTipo`).
 */
export function resumenAnualPorTipo(
  entradas: { tipo: string; mes: string; cantidad: number }[],
  anio: string
): FilaResumenAnualTipo[] {
  const porTipo = new Map<string, number[]>();
  for (const e of entradas) {
    if (!e.mes.startsWith(anio)) continue;
    const indiceMes = Number(e.mes.slice(5, 7)) - 1;
    if (indiceMes < 0 || indiceMes > 11) continue;
    const porMes = porTipo.get(e.tipo) ?? new Array(12).fill(0);
    porMes[indiceMes] += e.cantidad;
    porTipo.set(e.tipo, porMes);
  }

  return [...porTipo.entries()]
    .map(([tipo, porMes]) => {
      const t = tipoDeAcarreo(tipo);
      const totalAnual = porMes.reduce((s, v) => s + v, 0);
      return { tipo, etiqueta: t?.etiqueta ?? tipo, unidad: t?.unidad ?? "tonelada", porMes, totalAnual };
    })
    .filter((f) => f.totalAnual !== 0)
    .sort((a, b) => b.totalAnual - a.totalAnual);
}

function construirPorDestino(
  entradas: { tipo: string; destino: string | null; cantidad: number }[]
): { destinos: string[]; porTipoDestino: Map<string, number> } {
  const porTipoDestino = new Map<string, number>();
  const totalesPorDestino = new Map<string, number>();
  for (const e of entradas) {
    const destino = e.destino?.trim() || "(sin destino)";
    porTipoDestino.set(`${e.tipo}|${destino}`, (porTipoDestino.get(`${e.tipo}|${destino}`) ?? 0) + e.cantidad);
    totalesPorDestino.set(destino, (totalesPorDestino.get(destino) ?? 0) + e.cantidad);
  }
  const destinos = [...totalesPorDestino.keys()].sort((a, b) => totalesPorDestino.get(b)! - totalesPorDestino.get(a)!);
  return { destinos, porTipoDestino };
}

export interface FilaTipoPorDestino {
  tipo: string;
  etiqueta: string;
  porDestino: Record<string, number>;
}

export interface MatrizPorDestino {
  destinos: string[];
  filas: FilaTipoPorDestino[];
  totalesPorDestino: Record<string, number>;
}

/**
 * Material × destino de un mes, cruzados contra cada destino que tuvo algo
 * ese mes — sólo los materiales que también tuvieron algo: una fila (o
 * columna) enteramente en cero no suma nada a la tabla, así que no entra.
 *
 * Sólo tiene sentido con lo que sí trae destino por pesada —las 14 columnas
 * de material de "Datos"—: los renglones sin pesada (horas, viajes,
 * Materiales Pezzuchi) no tienen de dónde sacar un destino, y por eso mismo
 * nunca van a tener nada que sumar acá. `entradas` decide qué le pasa, esta
 * función no filtra por tipo de antemano.
 */
export function toneladasPorMaterialYDestino(
  entradas: { tipo: string; mes: string; destino: string | null; cantidad: number }[],
  mes: string
): MatrizPorDestino {
  const delMes = entradas.filter((e) => e.mes.slice(0, 7) === mes.slice(0, 7));
  const { destinos, porTipoDestino } = construirPorDestino(delMes);
  const tiposConDatos = new Set(delMes.map((e) => e.tipo));

  const filas: FilaTipoPorDestino[] = TIPOS_DE_ACARREO.filter((t) => tiposConDatos.has(t.codigo)).map((t) => ({
    tipo: t.codigo,
    etiqueta: t.etiqueta,
    porDestino: Object.fromEntries(destinos.map((d) => [d, porTipoDestino.get(`${t.codigo}|${d}`) ?? 0])),
  }));

  const totalesPorDestino = Object.fromEntries(
    destinos.map((d) => [d, filas.reduce((s, f) => s + f.porDestino[d], 0)])
  );

  return { destinos, filas, totalesPorDestino };
}

export interface FilaDiariaPorDestino {
  fecha: string;
  tipo: string;
  etiqueta: string;
  porDestino: Record<string, number>;
}

export interface DetalleDiarioPorDestino {
  destinos: string[];
  filas: FilaDiariaPorDestino[];
}

/**
 * El mismo cruce que `toneladasPorMaterialYDestino`, pero un renglón por día
 * y tipo en vez de un total del mes entero — y sólo los que tuvieron algo
 * ese día: a diferencia de la matriz mensual, mostrar los 19 tipos todos los
 * días del mes daría, casi siempre, una fila de puros "-".
 */
export function detalleDiarioPorDestino(
  entradas: { fecha: string; tipo: string; destino: string | null; cantidad: number }[],
  mes: string
): DetalleDiarioPorDestino {
  const delMes = entradas.filter((e) => e.fecha.slice(0, 7) === mes.slice(0, 7));
  const { destinos } = construirPorDestino(delMes);

  const porFechaTipoDestino = new Map<string, number>();
  const fechasYTipos = new Map<string, { fecha: string; tipo: string }>();
  for (const e of delMes) {
    const destino = e.destino?.trim() || "(sin destino)";
    const claveFT = `${e.fecha}|${e.tipo}`;
    fechasYTipos.set(claveFT, { fecha: e.fecha, tipo: e.tipo });
    const clave = `${claveFT}|${destino}`;
    porFechaTipoDestino.set(clave, (porFechaTipoDestino.get(clave) ?? 0) + e.cantidad);
  }

  const filas: FilaDiariaPorDestino[] = [...fechasYTipos.values()]
    .map(({ fecha, tipo }) => ({
      fecha,
      tipo,
      etiqueta: tipoDeAcarreo(tipo)?.etiqueta ?? tipo,
      porDestino: Object.fromEntries(destinos.map((d) => [d, porFechaTipoDestino.get(`${fecha}|${tipo}|${d}`) ?? 0])),
    }))
    .sort((a, b) => (a.fecha === b.fecha ? a.etiqueta.localeCompare(b.etiqueta) : a.fecha.localeCompare(b.fecha)));

  return { destinos, filas };
}
