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

/**
 * El índice de sectores por nombre, para reconocer lo que nombra una planilla.
 *
 * Un nombre que comparten dos sectores queda como ambiguo y no resuelve a
 * ninguno. Es la diferencia con `indicePorNombre` de Inventario, que se queda
 * con el primero que aparece y no avisa del empate: elegir uno de dos es
 * enlazar al que se le parece, y un empleado que aparece en el sector que no es
 * no se nota nunca.
 *
 * La clave es la misma que usa la pantalla de administración para no dejar
 * crear duplicados, así que las dos coinciden en qué nombres son el mismo.
 */
export function indiceDeSectores(
  sectores: readonly { id: string; nombre: string }[]
): Map<string, string | null> {
  const indice = new Map<string, string | null>();
  for (const s of sectores) {
    const k = claveDeSector(s.nombre);
    if (!k) continue;
    // El segundo que llega no gana ni pierde: apaga la clave para los dos.
    indice.set(k, indice.has(k) ? null : s.id);
  }
  return indice;
}

/**
 * El sector que nombra una planilla, o `null` si no se lo reconoce con certeza.
 *
 * Devuelve por qué no se lo reconoció, porque no son lo mismo: un nombre que no
 * existe se arregla creando el sector o corrigiendo la planilla, y uno ambiguo
 * se arregla en el catálogo. Decir "no se pudo" a secas deja a alguien
 * buscando cuál de las dos cosas pasó.
 */
export function sectorQueNombra(
  indice: ReadonlyMap<string, string | null>,
  nombre: string
): { id: string | null; motivo?: "no existe" | "ambiguo" } {
  const k = claveDeSector(nombre);
  if (!k) return { id: null, motivo: "no existe" };
  if (!indice.has(k)) return { id: null, motivo: "no existe" };
  const id = indice.get(k) ?? null;
  return id ? { id } : { id: null, motivo: "ambiguo" };
}
