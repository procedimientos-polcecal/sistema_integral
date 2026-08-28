/**
 * Filtrar Compras por máquina y por sector de planta.
 *
 * El enlace al núcleo vive en `compras_ubicaciones` y no en el requerimiento:
 * lo decidió la 019 para no tener el mismo dato en 1.825 filas, y para que los
 * dos lados no puedan contradecirse. La contrapartida es que filtrar por equipo
 * es filtrar por sus ubicaciones.
 *
 * La lista es de una o dos ubicaciones por equipo, así que el `.in()` que sale
 * de acá es corto. No confundirlo con el `.in()` de mil ids que arma una URL de
 * 37 KB y PostgREST rechaza con un 400 sin decir por qué.
 */

/** Lo mínimo del catálogo para resolver un filtro. */
export interface UbicacionEnlazada {
  id: string;
  nombre: string;
  equipo_id: string | null;
  sector_id: string | null;
}

/**
 * Qué ubicaciones corresponden a una máquina.
 *
 * Son varias más veces de las que parece: `Autoelevador XCMG` y el tipeo
 * `Autoelevador HCMG` que arrastra la planilla apuntan al mismo equipo.
 */
export function ubicacionesDelEquipo(
  ubicaciones: UbicacionEnlazada[],
  equipoId: string
): string[] {
  return ubicaciones.filter((u) => u.equipo_id === equipoId).map((u) => u.id);
}

/**
 * Qué ubicaciones corresponden a un sector de planta.
 *
 * Incluye las de sus máquinas: quien filtra por Filler 2 quiere lo que se
 * compró para ese sector, y una máquina que vive ahí es parte de eso. Hoy no se
 * cruzan —los equipos enlazados son todos móviles, del sector AMB-EM— pero la
 * regla tiene que valer igual el día que alguien enlace una ubicación a un
 * molino.
 */
export function ubicacionesDelSector(
  ubicaciones: UbicacionEnlazada[],
  sectorId: string,
  sectorDeCadaEquipo: Map<string, string> = new Map()
): string[] {
  return ubicaciones
    .filter(
      (u) =>
        u.sector_id === sectorId ||
        (u.equipo_id !== null && sectorDeCadaEquipo.get(u.equipo_id) === sectorId)
    )
    .map((u) => u.id);
}

/**
 * Los equipos que se pueden ofrecer en el desplegable.
 *
 * Sólo los que tienen alguna ubicación enlazada. Ofrecer las 239 máquinas
 * cuando 15 pueden devolver algo es prometer un filtro que da vacío, y quien lo
 * usa concluye que no se le compró nada a esa máquina en vez de que nadie
 * enlazó su ubicación.
 */
export function opcionesConUbicacion<T extends { id: string }>(
  candidatos: T[],
  ubicaciones: UbicacionEnlazada[],
  campo: "equipo_id" | "sector_id"
): T[] {
  const enlazados = new Set(
    ubicaciones.map((u) => u[campo]).filter((v): v is string => v !== null)
  );
  return candidatos.filter((c) => enlazados.has(c.id));
}
