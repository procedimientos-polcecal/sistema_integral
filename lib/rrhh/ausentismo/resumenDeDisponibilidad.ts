/**
 * Lo que la pantalla de Disponibilidad calcula para no verse plana: el resumen
 * de arriba y la grilla de persona × día.
 *
 * Vive acá y no en la pantalla porque son decisiones, no dibujo: qué significa
 * «el día más flojo» cuando hay empate, si el sector más golpeado se mide en
 * personas o en días, y qué pasa con quien no tiene sector. Cada una se puede
 * contestar de dos formas razonables, y la que elegimos está fijada con un test.
 *
 * Funciones puras, sin base ni red. Las fechas son ISO "YYYY-MM-DD" y se
 * comparan como strings.
 */

/** Una fila de `GET /api/disponibilidad`. **No trae el motivo, y no se pide.** */
export interface AusentePublico {
  empleadoId: string;
  nombre: string;
  sector: string | null;
  dia: string;
}

export const SIN_SECTOR = "Sin sector";

/**
 * Hasta cuántos días la grilla sigue siendo legible.
 *
 * La ruta acepta rangos de hasta 93 días y la grilla pone **una columna por
 * día**: 93 columnas no entran en ninguna pantalla. 31 es un mes largo entero,
 * que es el rango más grande que alguien mira de corrido; pasado eso, la
 * pantalla muestra la lista por día.
 */
export const LIMITE_DE_LA_GRILLA = 31;

export function entraLaGrilla(cantidadDeDias: number): boolean {
  return cantidadDeDias <= LIMITE_DE_LA_GRILLA;
}

/** Las personas distintas que faltan, por sector. Quien no tiene va a «Sin sector». */
function personasPorSector(ausentes: AusentePublico[]): Map<string, Set<string>> {
  const porSector = new Map<string, Set<string>>();
  for (const a of ausentes) {
    const sector = a.sector ?? SIN_SECTOR;
    const gente = porSector.get(sector) ?? new Set<string>();
    gente.add(a.empleadoId);
    porSector.set(sector, gente);
  }
  return porSector;
}

/**
 * Los tres números de arriba de la pantalla.
 *
 * - `personas` cuenta **gente y no días**: quien falta cinco días es uno.
 * - `diaMasFlojo` es el día con más gente. **Empatados gana el primero**, que es
 *   una regla arbitraria pero necesaria: sin ella el mismo dato daría dos
 *   respuestas distintas según cómo ordene el motor.
 * - `sectorMasGolpeado` también cuenta **personas y no días**. Son dos preguntas
 *   distintas —cuánta gente del sector no está, contra cuántas veces faltó la
 *   misma persona— y la primera es la que se mira para reacomodar un turno.
 *   `personal` es la dotación de ese sector, y va en **null** si no se la
 *   conoce: un cero diría que el sector no tiene gente.
 *
 * Sin nadie ausente los dos salen `null` y no un cero: «el día más flojo es el
 * lunes con 0» es una frase que no significa nada.
 */
export function resumenDeDisponibilidad(
  ausentes: AusentePublico[],
  dias: readonly string[],
  personalPorSector: Record<string, number>
): {
  personas: number;
  diaMasFlojo: { dia: string; cantidad: number } | null;
  sectorMasGolpeado: { sector: string; cantidad: number; personal: number | null } | null;
} {
  const personas = new Set(ausentes.map((a) => a.empleadoId)).size;

  const porDia = totalesPorDia(ausentes, dias);
  let diaMasFlojo: { dia: string; cantidad: number } | null = null;
  for (let i = 0; i < dias.length; i++) {
    // `>` y no `>=`: el primero se queda con el empate.
    if (porDia[i] > 0 && (diaMasFlojo === null || porDia[i] > diaMasFlojo.cantidad)) {
      diaMasFlojo = { dia: dias[i], cantidad: porDia[i] };
    }
  }

  let sectorMasGolpeado: { sector: string; cantidad: number; personal: number | null } | null = null;
  for (const [sector, gente] of [...personasPorSector(ausentes)].sort((x, y) =>
    x[0].localeCompare(y[0], "es")
  )) {
    if (sectorMasGolpeado === null || gente.size > sectorMasGolpeado.cantidad) {
      sectorMasGolpeado = {
        sector,
        cantidad: gente.size,
        personal: personalPorSector[sector] ?? null,
      };
    }
  }

  return { personas, diaMasFlojo, sectorMasGolpeado };
}

/**
 * Una fila por persona, con en qué días del rango falta.
 *
 * **Ordenadas por días de ausencia y después por nombre**, no alfabéticamente:
 * quien más falta es lo que se busca al abrir esta pantalla, y dejarlo en orden
 * de apellido lo esconde entre los demás. El desempate por nombre existe para
 * que dos corridas con los mismos datos den la misma lista.
 *
 * `falta` está alineado con `dias`, posición por posición, para que la pantalla
 * no tenga que buscar nada al dibujar cada celda.
 */
export function filasDeLaGrilla(
  ausentes: AusentePublico[],
  dias: readonly string[]
): { empleadoId: string; nombre: string; sector: string | null; falta: boolean[]; total: number }[] {
  const indiceDelDia = new Map(dias.map((d, i) => [d, i]));
  const porPersona = new Map<string, { nombre: string; sector: string | null; falta: boolean[] }>();

  for (const a of ausentes) {
    const fila =
      porPersona.get(a.empleadoId) ??
      { nombre: a.nombre, sector: a.sector, falta: new Array<boolean>(dias.length).fill(false) };
    const i = indiceDelDia.get(a.dia);
    // Un día fuera del rango no entra, y marcar la misma celda dos veces no
    // suma: el booleano hace la deduplicación sola.
    if (i !== undefined) fila.falta[i] = true;
    porPersona.set(a.empleadoId, fila);
  }

  return [...porPersona]
    .map(([empleadoId, f]) => ({
      empleadoId,
      nombre: f.nombre,
      sector: f.sector,
      falta: f.falta,
      total: f.falta.filter(Boolean).length,
    }))
    .sort((x, y) => y.total - x.total || x.nombre.localeCompare(y.nombre, "es"));
}

/**
 * Cuánta gente falta cada día, en el orden de `dias`.
 *
 * Es la fila de abajo de la grilla, y es la que hace que el día peor salte sin
 * tener que contar celdas. Cuenta personas distintas por día, así que su suma
 * son **días-persona** y no personas: 14 días-persona pueden ser 6 personas.
 */
export function totalesPorDia(ausentes: AusentePublico[], dias: readonly string[]): number[] {
  const porDia = new Map<string, Set<string>>();
  for (const a of ausentes) {
    const gente = porDia.get(a.dia) ?? new Set<string>();
    gente.add(a.empleadoId);
    porDia.set(a.dia, gente);
  }
  return dias.map((d) => porDia.get(d)?.size ?? 0);
}
