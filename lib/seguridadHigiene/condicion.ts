/**
 * El estado de una condición insegura y lo que le falta para estar completa.
 *
 * Las fechas se comparan como texto ISO (`YYYY-MM-DD`), que es lo que hace el
 * resto del repo: ordenan igual que las fechas y no arrastran zona horaria. El
 * llamador pasa `hoy` (de `hoyEnArgentina()`) en vez de leer el reloj acá, así
 * el borde se prueba con una fecha fija.
 */

export type Estado = "Pendiente" | "Cerrada" | "Vencida";

/**
 * Tener fecha de ejecución cierra la condición, aunque la máxima ya haya
 * pasado: cerrar tarde sigue siendo cerrar. Y la máxima de hoy **todavía no
 * venció** —vence mañana—: un `<` donde va `<=` la vence todo un día antes, y
 * eso le avisa a alguien de algo que todavía está a tiempo.
 */
export function estadoDe(
  c: { fecha_maxima: string | null; fecha_ejecucion: string | null },
  hoy: string,
): Estado {
  if (c.fecha_ejecucion) return "Cerrada";
  if (c.fecha_maxima && c.fecha_maxima < hoy) return "Vencida";
  return "Pendiente";
}

export type Falta = "sin_evaluar" | "sin_asignar" | "sin_lugar";

export interface CondicionParaFaltantes {
  sector_id: string | null;
  equipo_id: string | null;
  responsable_id: string | null;
  fecha_maxima: string | null;
  frecuencia: number | null;
  antecedentes: number | null;
  controles: number | null;
  magnitud_dano: number | null;
  legislacion: number | null;
}

/**
 * Qué le falta a una condición para estar completa. Una condición se carga
 * rápido, con lo que se ve, y se completa después: esto dice con qué.
 *
 * - **sin_evaluar**: falta *alguno* de los cinco puntajes. Una evaluación a
 *   medias no tiene nivel (el producto no cierra), así que cuatro de cinco es
 *   lo mismo que ninguno.
 * - **sin_asignar**: falta el responsable o la fecha máxima. Sin cualquiera de
 *   las dos nadie tiene una tarea con plazo.
 * - **sin_lugar**: no tiene ni sector ni equipo. Con uno de los dos ya se sabe
 *   dónde ir a mirar.
 */
export function loQueFalta(c: CondicionParaFaltantes): Falta[] {
  const faltas: Falta[] = [];

  const puntajes = [c.frecuencia, c.antecedentes, c.controles, c.magnitud_dano, c.legislacion];
  if (puntajes.some((p) => p === null)) faltas.push("sin_evaluar");

  if (c.responsable_id === null || c.fecha_maxima === null) faltas.push("sin_asignar");

  if (c.sector_id === null && c.equipo_id === null) faltas.push("sin_lugar");

  return faltas;
}

/**
 * `loQueFalta(c).length > 0` dicho como filtro de PostgREST (`.or(...)`), para
 * contar en la base sin traer las filas. Lo usa el aviso «sin completar» del
 * resumen diario.
 *
 * Son dos implementaciones de la misma regla y por eso hay un test que las ata
 * (`condicion.test.ts`): nombra las nueve columnas que lee `loQueFalta`, y el
 * lugar va como un `and` porque sólo falta cuando **faltan los dos**.
 *
 * Lo que **no** dice es «y no está cerrada», y es a propósito: eso es lo que
 * separa a `loQueFalta` de `faltasPendientes` (gestion.ts), el criterio único
 * del módulo, y el llamador lo agrega con `.is("fecha_ejecucion", null)`.
 * Cerrada es tener fecha de ejecución (`estadoDe`), así que
 * `fecha_ejecucion is null AND FILTRO_FALTA_ALGO` cuenta exactamente las filas
 * donde `faltasPendientes(c, hoy).length > 0`: las abiertas con algo por
 * completar, que es lo que la pantalla muestra con `falta=alguna`. Usar la
 * constante sola contaría también las cerradas.
 */
export const FILTRO_FALTA_ALGO = [
  "frecuencia.is.null",
  "antecedentes.is.null",
  "controles.is.null",
  "magnitud_dano.is.null",
  "legislacion.is.null",
  "responsable_id.is.null",
  "fecha_maxima.is.null",
  "and(sector_id.is.null,equipo_id.is.null)",
].join(",");
