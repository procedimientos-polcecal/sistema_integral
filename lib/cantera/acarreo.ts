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
  /**
   * Si está, este tipo no tiene tarifa propia en `cantera_tarifas_acarreo`:
   * `tarifaVigente()` usa la de `tarifaDe` en su lugar. Sirve para llevar la
   * cantidad de una actividad por separado con el mismo $/hora que otra ya
   * tarifada — ver "horas_movimiento_interno" más abajo.
   */
  tarifaDe?: string;
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
  // Agregado el 22/09/2026 a pedido del usuario: actividad nueva, sin
  // columna en la planilla real (no participa de ningún sync). Se paga al
  // mismo $/hora que "Horas destape" — no tiene tarifa propia a propósito
  // (`tarifaDe`), así que no aparece en /cantera/tarifas-acarreo para
  // cargarle una.
  { codigo: "horas_movimiento_interno", etiqueta: "Horas de movimiento interno", unidad: "hora", yacimientoCodigo: null, tarifaDe: "horas_destape" },
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
  // Un tipo con `tarifaDe` (ej. "horas_movimiento_interno") no tiene tarifas
  // propias cargadas: se busca la del tipo que declara.
  const tipoDeLaTarifa = tipoDeAcarreo(tipo)?.tarifaDe ?? tipo;
  const fecha = mes.length === 7 ? `${mes}-01` : mes;
  const candidatas = tarifas
    .filter((t) => t.tipo === tipoDeLaTarifa && t.desde <= fecha && (t.hasta === null || t.hasta >= fecha))
    .sort((a, b) => (a.desde < b.desde ? 1 : -1));
  return candidatas[0] ?? null;
}

/** `cantidad × tarifa`, o `null` si no hay tarifa vigente ese mes. */
export function montoAcarreo(cantidad: number | null, tarifa: TarifaAcarreo | null): number | null {
  if (cantidad === null || !isFinite(cantidad)) return null;
  if (tarifa === null) return null;
  return cantidad * tarifa.tarifa;
}

/**
 * Los fleteros con camión grande cobran el DOBLE de la tarifa por hora —
 * pedido del usuario (02/10/2026): Orsatti (1 y 2) y Schneider. Mismo
 * criterio que Destape, donde "Camión grande" es la tarifa de horas × 2
 * (`lib/cantera/destape.ts`). Aplica sólo a los renglones en horas; el
 * material por tonelada no cambia. Por nombre y no por columna en la base:
 * es una lista chica y estable, mismo criterio que `FLETEROS_CONOCIDOS`.
 */
const FLETEROS_CON_CAMION_GRANDE = ["orsatti", "schneider"];

export function multiplicadorDeHoras(nombreFletero: string): number {
  const n = nombreFletero.trim().toLowerCase();
  return FLETEROS_CON_CAMION_GRANDE.some((f) => n === f || n.startsWith(`${f} `)) ? 2 : 1;
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
  mes: string,
  /** `multiplicadorDeHoras(nombre)` del fletero: 2 si tiene camión grande. Sólo afecta a los tipos en horas. */
  multiplicadorHoras = 1
): FilaResumenFletero {
  const deEsteFleteroYMes = acarreos.filter((a) => a.fleteroId === fleteroId && a.mes.slice(0, 7) === mes.slice(0, 7));

  const cantidadPorTipo = new Map<string, number>();
  for (const a of deEsteFleteroYMes) {
    cantidadPorTipo.set(a.tipo, (cantidadPorTipo.get(a.tipo) ?? 0) + a.cantidad);
  }

  const porTipo = [...cantidadPorTipo.entries()].map(([tipo, cantidad]) => {
    const tarifa = tarifaVigente(tarifas, tipo, mes);
    const monto = montoAcarreo(cantidad, tarifa);
    const factor = tipoDeAcarreo(tipo)?.unidad === "hora" ? multiplicadorHoras : 1;
    return { tipo, cantidad, monto: monto === null ? null : monto * factor };
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

/**
 * Colapsa las variantes de texto libre de una planta de trituración a una
 * sola forma canónica, antes de agrupar destinos en las tablas de acarreo.
 * "PT 1" y "P T 1" son la misma planta tipeada con un espacio de más en el
 * medio —4957 pesadas reales contra 463, medido— y lo mismo pasa con "PT 3"
 * / "P T 3": sin esto, las dos quedaban como columnas separadas. Mismo
 * problema que ya resolvió `plantaDelDestino` para el cruce con Trituración
 * (`lib/trituracion/cruceCantera.ts`), pero acá no alcanza con reducir a un
 * número: el resto de los destinos (RESERVA A, GALPÓN, un código de
 * yacimiento) tienen que seguir siendo su propia columna, así que sólo se
 * canonicaliza el patrón "P T <n>" y se recortan espacios repetidos en
 * general — no se inventa una normalización más agresiva sin haberla visto
 * en datos reales.
 */
const PATRON_PLANTA_CON_ESPACIOS = /^P\s*T\s*(\d)$/i;

export function normalizarDestino(destinoRaw: string | null | undefined): string {
  const colapsado = (destinoRaw ?? "").trim().replace(/\s+/g, " ");
  if (!colapsado) return "(sin destino)";
  const m = colapsado.match(PATRON_PLANTA_CON_ESPACIOS);
  return m ? `PT ${m[1]}` : colapsado;
}

/**
 * Cuando el material tiene un origen que importa ver aparte, ese origen pasa
 * a ser su propio renglón de las matrices material × destino: "Caliza" con
 * origen L NEGRA es Caliza de Loma Negra (la compra, no la de cantera propia
 * C1/C3), y la Dolomita que sale de PT 2 es otra cosa que la de D1/D6 que
 * viene del yacimiento. Pedido del usuario (02/10/2026), medido sobre las
 * pesadas reales: caliza|L NEGRA 106, dolomita_d1|PT 2 122, dolomita_d6|PT 2 1.
 *
 * El origen se compara sin espacios ni mayúsculas ("L NEGRA", "LNEGRA",
 * "P T 2" son la misma cosa, igual que el destino). Cualquier otra
 * combinación de tipo y origen sigue siendo el renglón de siempre: no se
 * inventa una variante sin haberla visto en los datos.
 */
export function variantePorOrigen(tipo: string, origen: string | null | undefined): { clave: string; sufijo: string } | null {
  const o = (origen ?? "").toUpperCase().replace(/\s+/g, "");
  if (tipo === "caliza" && o === "LNEGRA") return { clave: `${tipo}:lnegra`, sufijo: "de Loma Negra" };
  if ((tipo === "dolomita_d1" || tipo === "dolomita_d6") && o === "PT2") return { clave: `${tipo}:pt2`, sufijo: "de PT 2" };
  return null;
}

/** La clave de renglón y su etiqueta, con el origen aparte si corresponde. */
function renglonDeMaterial(tipo: string, origen: string | null | undefined): { clave: string; etiqueta: string } {
  const base = tipoDeAcarreo(tipo)?.etiqueta ?? tipo;
  const v = variantePorOrigen(tipo, origen);
  return v ? { clave: v.clave, etiqueta: `${base} ${v.sufijo}` } : { clave: tipo, etiqueta: base };
}

function construirPorDestino(
  entradas: { tipo: string; origen?: string | null; destino: string | null; cantidad: number }[]
): { destinos: string[]; porRenglonDestino: Map<string, number> } {
  const porRenglonDestino = new Map<string, number>();
  const totalesPorDestino = new Map<string, number>();
  for (const e of entradas) {
    const destino = normalizarDestino(e.destino);
    const { clave } = renglonDeMaterial(e.tipo, e.origen);
    porRenglonDestino.set(`${clave}|${destino}`, (porRenglonDestino.get(`${clave}|${destino}`) ?? 0) + e.cantidad);
    totalesPorDestino.set(destino, (totalesPorDestino.get(destino) ?? 0) + e.cantidad);
  }
  const destinos = [...totalesPorDestino.keys()].sort((a, b) => totalesPorDestino.get(b)! - totalesPorDestino.get(a)!);
  return { destinos, porRenglonDestino };
}

/** Los renglones de material que tuvieron algo, en el orden de `TIPOS_DE_ACARREO` y con cada variante por origen pegada a su material. */
function renglonesConDatos(entradas: { tipo: string; origen?: string | null }[]): { clave: string; etiqueta: string }[] {
  const vistos = new Map<string, string>();
  for (const e of entradas) {
    const r = renglonDeMaterial(e.tipo, e.origen);
    vistos.set(r.clave, r.etiqueta);
  }
  const resultado: { clave: string; etiqueta: string }[] = [];
  for (const t of TIPOS_DE_ACARREO) {
    for (const [clave, etiqueta] of vistos) {
      if (clave === t.codigo || clave.startsWith(`${t.codigo}:`)) resultado.push({ clave, etiqueta });
    }
  }
  return resultado;
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
  entradas: { tipo: string; origen?: string | null; mes: string; destino: string | null; cantidad: number }[],
  mes: string
): MatrizPorDestino {
  const delMes = entradas.filter((e) => e.mes.slice(0, 7) === mes.slice(0, 7));
  const { destinos, porRenglonDestino } = construirPorDestino(delMes);

  const filas: FilaTipoPorDestino[] = renglonesConDatos(delMes).map((r) => ({
    tipo: r.clave,
    etiqueta: r.etiqueta,
    porDestino: Object.fromEntries(destinos.map((d) => [d, porRenglonDestino.get(`${r.clave}|${d}`) ?? 0])),
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
  entradas: { fecha: string; tipo: string; origen?: string | null; destino: string | null; cantidad: number }[],
  mes: string
): DetalleDiarioPorDestino {
  const delMes = entradas.filter((e) => e.fecha.slice(0, 7) === mes.slice(0, 7));
  const { destinos } = construirPorDestino(delMes);

  const porFechaTipoDestino = new Map<string, number>();
  const fechasYTipos = new Map<string, { fecha: string; tipo: string; etiqueta: string }>();
  for (const e of delMes) {
    const destino = normalizarDestino(e.destino);
    const renglon = renglonDeMaterial(e.tipo, e.origen);
    const claveFT = `${e.fecha}|${renglon.clave}`;
    fechasYTipos.set(claveFT, { fecha: e.fecha, tipo: renglon.clave, etiqueta: renglon.etiqueta });
    const clave = `${claveFT}|${destino}`;
    porFechaTipoDestino.set(clave, (porFechaTipoDestino.get(clave) ?? 0) + e.cantidad);
  }

  const filas: FilaDiariaPorDestino[] = [...fechasYTipos.values()]
    .map(({ fecha, tipo, etiqueta }) => ({
      fecha,
      tipo,
      etiqueta,
      porDestino: Object.fromEntries(destinos.map((d) => [d, porFechaTipoDestino.get(`${fecha}|${tipo}|${d}`) ?? 0])),
    }))
    .sort((a, b) => (a.fecha === b.fecha ? a.etiqueta.localeCompare(b.etiqueta) : a.fecha.localeCompare(b.fecha)));

  return { destinos, filas };
}
