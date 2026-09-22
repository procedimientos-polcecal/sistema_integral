/**
 * La hora que devuelve una planilla, sea fracción de día o texto ya
 * formateado.
 *
 * Estaba en `lib/trituracion/importar.ts` (la necesitaba para leer
 * `PLANTA {N}` sin `dateTimeRenderOption: FORMATTED_STRING`, que
 * `lib/core/sheets.ts` no ofrece: una celda de hora viaja como fracción del
 * día — 0,1944… para las 4:40 —, no como texto). Taller Vial es el
 * tercero: por el mismo criterio que ya sigue `lib/core/fechaDeSheets.ts`
 * ("a la tercera se muda al núcleo"), se muda acá con sus tests.
 */
export function horaDeCelda(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "string" && /^\d{1,2}:\d{2}$/.test(valor)) {
    const [h, m] = valor.split(":");
    return `${h.padStart(2, "0")}:${m}`;
  }
  const n = Number(valor);
  if (isNaN(n) || n < 0 || n >= 1) return null;
  const minutosTotales = Math.round(n * 24 * 60);
  const h = Math.floor(minutosTotales / 60);
  const m = minutosTotales % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
