/**
 * El titular del mes y la tabla por sector de «Ausentismo del mes».
 *
 * POR QUÉ UNA TABLA Y NO DOS
 *
 * El mensual (días por motivo) y el porcentual (horas y %) son la **misma
 * pregunta** —cómo le fue a cada sector este mes— partida en dos tablas que
 * estaban lejos una de otra, y nadie las cruzaba. Juntas aparece lo que ninguna
 * de las dos decía sola: **el orden cambia**. Medido en octubre de 2026,
 * «Producción - Calcinación» tiene 7 días contra los 35 de Mantenimiento y aun
 * así está más arriba en porcentaje, porque son 2 personas contra 11. Con las
 * tablas separadas eso sólo lo ve quien se acuerda de comparar.
 *
 * Funciones puras. Acá vive la aritmética, no en el JSX: la maqueta que se
 * aprobó para la otra pestaña tenía los totales dibujados a mano y no cerraban.
 */

export interface FilaMensual {
  sector: string;
  sectorId: string | null;
  total: number;
  porMotivo: Record<string, number>;
}

/**
 * Una fila del porcentual, tal como la devuelve `reportePorcentual`.
 *
 * Lleva las horas aunque esta función no las use: el tipo dice qué se le pasa y
 * no qué se mira adentro, y recortarlo obligaría a quien llame a construir un
 * objeto distinto del que ya tiene.
 */
export interface FilaPorcentual {
  sector: string;
  sectorId: string | null;
  personal: number;
  horasARealizar: number;
  horasPerdidas: number;
  porcentual: number;
}

/**
 * El titular: lo que pasó este mes, en una frase.
 *
 * `porcentualGeneral` va en **null** para quien no pasa el control de los
 * reportes por persona: ve los días, que son públicos, y no el porcentaje.
 *
 * `lider` es el sector con más días y `dosPrimeros` el porcentaje del mes que
 * juntan los dos primeros — que es el número que convierte una lista en una
 * frase: «dos sectores son el 78 % del mes». Los dos salen **null** cuando no
 * hay ausencias, porque «el sector que más faltó, con 0 días» no dice nada.
 */
export function titularDelMes(
  filasMensual: FilaMensual[],
  totalDias: number,
  porcentualGeneral: number | null
): {
  dias: number;
  porcentual: number | null;
  lider: { sector: string; dias: number; porcentajeDelTotal: number } | null;
  dosPrimeros: number | null;
} {
  const conDias = filasMensual
    .filter((f) => f.total > 0)
    .sort((a, b) => b.total - a.total || a.sector.localeCompare(b.sector, "es"));

  if (conDias.length === 0 || totalDias === 0) {
    return { dias: totalDias, porcentual: porcentualGeneral, lider: null, dosPrimeros: null };
  }

  const lider = {
    sector: conDias[0].sector,
    dias: conDias[0].total,
    porcentajeDelTotal: (conDias[0].total / totalDias) * 100,
  };
  const dosPrimeros =
    conDias.length >= 2 ? ((conDias[0].total + conDias[1].total) / totalDias) * 100 : null;

  return { dias: totalDias, porcentual: porcentualGeneral, lider, dosPrimeros };
}

/**
 * Una fila por sector con los días, la dotación y el porcentual juntos.
 *
 * **Ordena por porcentual cuando lo hay, y por días cuando no.** Ordenar por
 * días escondería justamente lo que esta fusión viene a mostrar: un sector
 * chico con pocos días puede estar peor que uno grande con muchos.
 *
 * Devuelve **todos** los sectores, también los que no tienen días: esconderlos
 * es una decisión de la pantalla y no de la aritmética, y acá se vería como un
 * dato que no existe en vez de uno que se eligió no mostrar.
 *
 * `personal` sale del porcentual si está, y si no del padrón; **null** si no se
 * lo conoce, nunca cero: cero diría que el sector no tiene gente.
 */
export function filasPorSector(
  filasMensual: FilaMensual[],
  filasPorcentual: FilaPorcentual[] | null,
  personalPorSector: Record<string, number>
): {
  sector: string;
  sectorId: string | null;
  dias: number;
  personal: number | null;
  porcentual: number | null;
  porMotivo: Record<string, number>;
}[] {
  // Se cruza por `sectorId` y no por nombre: el catálogo tiene sectores
  // distintos con el mismo nombre, y cruzar por texto los fundiría en uno.
  const porId = new Map((filasPorcentual ?? []).map((p) => [p.sectorId, p]));

  const filas = filasMensual.map((m) => {
    const p = porId.get(m.sectorId);
    return {
      sector: m.sector,
      sectorId: m.sectorId,
      dias: m.total,
      personal: p?.personal ?? personalPorSector[m.sector] ?? null,
      porcentual: p?.porcentual ?? null,
      porMotivo: m.porMotivo,
    };
  });

  const hayPorcentual = filas.some((f) => f.porcentual !== null);
  return filas.sort((a, b) =>
    hayPorcentual
      ? (b.porcentual ?? -1) - (a.porcentual ?? -1) || a.sector.localeCompare(b.sector, "es")
      : b.dias - a.dias || a.sector.localeCompare(b.sector, "es")
  );
}

/**
 * Los dos motivos más grandes de un sector, para el resumen de la fila.
 *
 * Son dos y no uno porque uno solo miente seguido: en Cantera, «ART 31»
 * esconde que además hubo 19 días de vacaciones. El detalle completo —los doce
 * motivos, con sus ceros— se despliega aparte; esto es el vistazo.
 *
 * Empatados desempata por el nombre del tipo, para que dos corridas con los
 * mismos datos den la misma fila.
 */
export function motivoQueManda(porMotivo: Record<string, number>): { tipo: string; dias: number }[] {
  return Object.entries(porMotivo)
    .filter(([, dias]) => dias > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([tipo, dias]) => ({ tipo, dias }));
}
