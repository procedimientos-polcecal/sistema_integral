/**
 * Los pozos de una perforación por profundidad.
 *
 * En una voladura no todos los pozos tienen la misma profundidad. Cantera los
 * informa así: `"14*3 / 3*3,5 / 6*4"` — 14 pozos a 3 m, 3 a 3,5 y 6 a 4. Se
 * guardan como arreglo (`perf_tramos` / `vol_tramos`, jsonb) y el cálculo usa
 * esto: metros perforados = Σ (pozos · metros).
 *
 * Las columnas escalares `pozos` y `metros_por_pozo` quedan por la importación
 * —la planilla vieja sólo trae el promedio, sin el desglose— pero cuando hay
 * tramos, mandan los tramos.
 */

export interface Tramo {
  pozos: number;
  metros: number;
}

/**
 * `"14*3 / 3*3,5 / 6*4"` → `[{pozos:14,metros:3},{pozos:3,metros:3.5},{pozos:6,metros:4}]`.
 *
 * Acepta `x`, `*` o `×` como separador de pozos·metros, y `/`, `-` o salto de
 * línea entre tramos. La coma es decimal. Devuelve `null` si algo no cierra —no
 * se adivina—: un tramo sin número, un separador de más.
 */
export function parsearTramos(texto: string | null | undefined): Tramo[] | null {
  if (!texto || !texto.trim()) return null;

  const partes = texto
    .split(/[/\n;]|(?<=\d)\s*-\s*(?=\d)/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (partes.length === 0) return null;

  const tramos: Tramo[] = [];
  for (const parte of partes) {
    const m = parte.match(/^(\d+(?:[.,]\d+)?)\s*[x*×]\s*(\d+(?:[.,]\d+)?)$/i);
    if (!m) return null;
    const pozos = Number(m[1].replace(",", "."));
    const metros = Number(m[2].replace(",", "."));
    if (!Number.isInteger(pozos) || pozos <= 0 || !isFinite(metros) || metros <= 0) return null;
    tramos.push({ pozos, metros });
  }
  return tramos;
}

/** El arreglo de vuelta a texto, para el campo del editor. */
export function formatearTramos(tramos: Tramo[] | null | undefined): string {
  if (!tramos || tramos.length === 0) return "";
  return tramos
    .map((t) => `${t.pozos}*${String(t.metros).replace(".", ",")}`)
    .join(" / ");
}

/** Un valor de la base (jsonb) a `Tramo[]`, tolerando lo que no tenga forma. */
export function tramosDesdeJson(valor: unknown): Tramo[] {
  if (!Array.isArray(valor)) return [];
  const out: Tramo[] = [];
  for (const t of valor) {
    const pozos = Number((t as Tramo)?.pozos);
    const metros = Number((t as Tramo)?.metros);
    if (isFinite(pozos) && isFinite(metros) && pozos > 0 && metros > 0) out.push({ pozos, metros });
  }
  return out;
}

export function totalPozos(tramos: Tramo[]): number {
  return tramos.reduce((s, t) => s + t.pozos, 0);
}

/** Metros perforados: Σ (pozos · metros). */
export function totalMetros(tramos: Tramo[]): number {
  return tramos.reduce((s, t) => s + t.pozos * t.metros, 0);
}

/**
 * Los metros perforados y la cantidad de pozos de una etapa, tomando los tramos
 * si los hay y cayendo en los escalares si no.
 */
export function metrosYPozos(
  tramosJson: unknown,
  pozosScalar: number | null | undefined,
  metrosPorPozoScalar: number | null | undefined
): { pozos: number | null; metros: number | null } {
  const tramos = tramosDesdeJson(tramosJson);
  if (tramos.length > 0) {
    return { pozos: totalPozos(tramos), metros: totalMetros(tramos) };
  }
  const p = typeof pozosScalar === "number" && isFinite(pozosScalar) ? pozosScalar : null;
  const m = typeof metrosPorPozoScalar === "number" && isFinite(metrosPorPozoScalar) ? metrosPorPozoScalar : null;
  return { pozos: p, metros: p !== null && m !== null ? p * m : null };
}
