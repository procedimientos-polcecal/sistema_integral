/**
 * La fecha que devuelve una planilla, sea serial o texto.
 *
 * Estaba en `lib/mantenimiento/planilla.ts` y la importaba Inventario desde
 * ahí. Producción es el tercero: por la regla de `docs/NUCLEO-COMPARTIDO.md`,
 * a la tercera se muda al núcleo con sus tests.
 *
 * **El texto se lee d/m y nunca m/d.** Leerlo al revés dio vuelta 885 fechas en
 * Compras, y es un error que no rompe nada: el dato simplemente queda mal.
 */
export function fechaDeSheets(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === "") return null;

  const n = Number(valor);
  if (!isNaN(n) && n >= 1) {
    const ms = (Math.floor(n) - 25569) * 86400 * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }

  const s = String(valor).trim();

  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;

  const iso = s.match(/^\d{4}-\d{2}-\d{2}/);
  return iso ? iso[0] : null;
}
