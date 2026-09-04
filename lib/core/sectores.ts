/**
 * El catálogo de sectores, como lo muestra y lo cuida la pantalla de administración.
 *
 * `sectores` guarda dos taxonomías con el mismo nombre: **dónde trabaja una
 * persona** —"Administración", "Tesorería"— y **dónde está una máquina**
 * —"Calcinación", "Filler 2"—. Las separa `es_de_planta` desde la `033`, y la
 * pantalla tiene que mostrarlas aparte: mezcladas, la lista se lee como un
 * catálogo desprolijo en vez de como dos cosas distintas.
 *
 * Acá está lo que se puede probar sin la base: cómo se agrupan, cuándo dos
 * nombres son el mismo para una persona, y quién manda sobre cada sector.
 */

/** Un sector como lo necesita la pantalla, con la cuenta de quién lo usa. */
export interface SectorAdmin {
  id: string;
  nombre: string;
  activo: boolean;
  transversal: boolean;
  es_de_planta: boolean;
  /** Del libro BD Equipos. Sólo los de planta lo tienen. */
  codigo: string | null;
  empresa_id: string | null;
  empresa: string | null;
  /** Cuántas filas del sistema le apuntan, sumando las ocho tablas. */
  usos: number;
}

/**
 * La clave con la que dos nombres son "el mismo" para quien mira la pantalla.
 *
 * Sin tildes y sin mayúsculas, porque así es como se cuelan los duplicados:
 * "Producción - Hidratacion" convivió meses al lado de "Hidratación" sin que
 * nadie los viera como parejos. La base es más estricta que esto —su índice
 * único compara el texto tal cual—, así que la pantalla avisa antes en casos
 * que la base dejaría pasar. Es a propósito: el catálogo lo comparten los cinco
 * módulos y un duplicado no se nota hasta que dos tableros no suman igual.
 */
export function claveDeSector(nombre: string): string {
  return String(nombre ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * El sector que ya se llama así, si lo hay. Cuenta los inactivos.
 *
 * Un nombre repetido con una fila dada de baja es igual de dañino: las
 * búsquedas por nombre —el espejo de Inventario, la importación de RRHH— se
 * quedan con una sola de las dos y no avisan del empate.
 */
export function yaExisteElNombre(
  sectores: readonly SectorAdmin[],
  nombre: string,
  exceptoId?: string
): SectorAdmin | null {
  const clave = claveDeSector(nombre);
  if (!clave) return null;
  return sectores.find((s) => s.id !== exceptoId && claveDeSector(s.nombre) === clave) ?? null;
}

/**
 * Si el sector lo mantiene la importación del libro BD Equipos.
 *
 * Los de planta se crean y se actualizan por código desde
 * `/api/mantenimiento/equipos/import`, que pisa nombre, empresa y transversal
 * en cada corrida. Renombrar uno desde acá no da error y se pierde en la
 * próxima importación, que es la peor forma de no funcionar: parece que anduvo.
 */
export function loMantieneLaImportacion(s: Pick<SectorAdmin, "es_de_planta">): boolean {
  return s.es_de_planta;
}

export interface GrupoDeSectores {
  clave: string;
  titulo: string;
  /** Qué es este grupo, para quien no conoce la distinción. */
  explicacion: string;
  sectores: SectorAdmin[];
}

/**
 * Los sectores agrupados como se muestran: primero los organizativos —los
 * transversales y después los de cada empresa— y al final los de planta.
 *
 * Los organizativos van primero porque son los únicos que se editan acá. Los de
 * planta se muestran para que el catálogo esté completo —antes esta pantalla
 * mostraba 20 de 39 y nadie sabía dónde estaban los otros— pero de sólo lectura.
 *
 * Una empresa sin sectores propios igual aparece: el hueco es la respuesta a
 * "¿dónde lo pongo?" y esconderlo obliga a adivinar.
 */
export function agruparSectores(
  sectores: readonly SectorAdmin[],
  empresas: readonly { id: string; nombre: string }[]
): GrupoDeSectores[] {
  const porNombre = (a: SectorAdmin, b: SectorAdmin) => a.nombre.localeCompare(b.nombre, "es");
  const organizativos = sectores.filter((s) => !s.es_de_planta);

  const grupos: GrupoDeSectores[] = [
    {
      clave: "transversal",
      titulo: "Transversales",
      explicacion: "De las dos empresas. Es donde va casi todo lo organizativo.",
      sectores: organizativos.filter((s) => s.transversal).sort(porNombre),
    },
    ...empresas.map((e) => ({
      clave: e.id,
      titulo: e.nombre,
      explicacion: `Sólo de ${e.nombre}.`,
      sectores: organizativos.filter((s) => s.empresa_id === e.id).sort(porNombre),
    })),
    {
      clave: "planta",
      titulo: "De planta",
      explicacion:
        "Dónde está una máquina, no dónde trabaja una persona. Los mantiene la " +
        "importación del libro BD Equipos: acá se ven, no se tocan.",
      sectores: sectores
        .filter((s) => s.es_de_planta)
        .sort((a, b) => (a.codigo ?? "").localeCompare(b.codigo ?? "")),
    },
  ];

  return grupos;
}
