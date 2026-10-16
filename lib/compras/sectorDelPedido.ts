/**
 * Qué se deduce del sector que eligió quien hace el pedido.
 *
 * Dos cosas, y las dos salen de datos que ya existen en el núcleo:
 *
 *   * **quién paga** — `sectores.empresa_id` dice de qué empresa es cada sector
 *     de planta: Calcinación, Molienda y las tres Trituraciones son de
 *     POLCECAL; los tres Filler y Planta 02, de POLYSAN. Los que sirven a las
 *     dos —Compresores, Equipos móviles— están marcados `transversal`;
 *   * **qué equipos ofrecer** — los 239 equipos activos cuelgan de un sector
 *     (`equipos.sector_id`), así que elegir el sector recorta la lista de 239 a
 *     unas decenas.
 *
 * ── POR QUÉ SUGERIR ACÁ NO CONTRADICE LA REGLA DE QUE "QUIÉN PAGA NACE VACÍA"
 *
 * El formulario tiene escrito que el área y quién paga **no se precargan**, y
 * el motivo es bueno: precargarlos desde *otra pantalla* es cómo un pedido de
 * Mantenimiento entra como si fuera de Producción. Eso vale para lo que llega
 * de afuera, en `ValoresIniciales`.
 *
 * Esto es otra cosa: la sugerencia sale de algo que **la misma persona acaba de
 * elegir en este mismo formulario**, queda a la vista en un campo que dice
 * "sugerido", y se puede cambiar. La diferencia que importa es que no reemplaza
 * una decisión: `empresaSugerida` se aplica **sólo si el campo está vacío**
 * —eso lo decide quien llama—, así que elegir un sector después de haber
 * elegido empresa no pisa lo elegido.
 */

/** Un sector de planta, con lo poco que hace falta para decidir. */
export interface SectorDePlanta {
  id: string;
  nombre: string;
  empresa_id: string | null;
  transversal: boolean | null;
}

/** Un equipo del núcleo, como lo devuelve el endpoint de los desplegables. */
export interface EquipoDelSector {
  id: string;
  sector_id: string | null;
}

/** El valor que le corresponde al desplegable "Quién paga". */
export const AMBAS = "AMBAS";

/**
 * Qué empresa sugerir para un sector, o `null` si no hay nada que sugerir.
 *
 * `null` es "este sector no dice de quién es", y entonces **no se toca el
 * campo**: dejarlo vacío es correcto, inventar una empresa no. Pasa con los
 * sectores administrativos, que no son de planta y no tienen empresa ni son
 * transversales.
 *
 * Un sector transversal sugiere `AMBAS`, que es un valor que el formulario ya
 * entiende: es lo que significa que el gasto lo comparten las dos.
 */
export function empresaSugerida(sector: SectorDePlanta | undefined | null): string | null {
  if (!sector) return null;
  if (sector.empresa_id) return sector.empresa_id;
  if (sector.transversal) return AMBAS;
  return null;
}

/**
 * Los equipos de un sector, o todos cuando no se eligió ninguno.
 *
 * Sin sector se devuelve la lista entera y no una vacía: el sector es opcional
 * —hay pedidos que no son de ninguna máquina— y vaciar el desplegable de
 * equipos porque todavía no eligieron sector sería trabar el formulario por un
 * campo que nadie pidió llenar.
 */
export function equiposDelSector<T extends EquipoDelSector>(
  equipos: T[],
  sectorId: string
): T[] {
  if (!sectorId) return equipos;
  return equipos.filter((e) => e.sector_id === sectorId);
}

/**
 * Si el equipo ya elegido sigue siendo elegible con el sector nuevo.
 *
 * Se usa para limpiarlo cuando deja de serlo. Limpiarlo es mejor que dejarlo:
 * un equipo que no está en la lista que se ve en pantalla es un dato que nadie
 * puede revisar antes de mandar el pedido, y que después aparece en la ficha
 * contradiciendo al sector.
 */
export function elEquipoSigueValiendo(
  equipos: EquipoDelSector[],
  equipoId: string,
  sectorId: string
): boolean {
  if (!equipoId) return true;
  if (!sectorId) return true;
  return equipos.some((e) => e.id === equipoId && e.sector_id === sectorId);
}
