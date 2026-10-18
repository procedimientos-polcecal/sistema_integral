/**
 * Cómo se ordena el listado de MTBF.
 *
 * Vive acá y no en el cliente porque decide algo: qué fila queda arriba es lo
 * primero que lee quien abre la pantalla a la mañana para elegir qué máquina
 * intervenir. Tres reglas que no se deducen de mirar la tabla y que un refactor
 * rompe sin que nada se queje:
 *
 * - **Los nulos van al final en los dos sentidos.** Un equipo sin MTBF
 *   publicable no es "el mejor" ni "el peor": es uno del que no se sabe. Si
 *   viajara con los números, al invertir el orden aparecería primero y haría
 *   creer que falla cada cero días.
 * - **El desempate siempre es por cantidad de fallas, de mayor a menor**, y no
 *   se invierte con la flecha. Dos equipos con el mismo MTBF no están igual: el
 *   que lo consiguió con 40 fallas importa más que el que lo consiguió con 2.
 * - **Lo primero que se quiere ver de una columna es el peor valor.** En MTBF y
 *   en las confiabilidades eso es el número más chico, y en fallas y en la
 *   fecha de la última, el más grande. Por eso la dirección inicial depende de
 *   la columna y no es siempre ascendente.
 */
import type { FilaDeVista } from "./mtbfVista";

/** `r0`, `r1`… son las confiabilidades, en el orden de PLAZOS. */
export type Columna = "equipo" | "sector" | "mtbf" | "fallas" | "ultima" | `r${number}`;

export interface Orden {
  columna: Columna;
  ascendente: boolean;
}

/** Lo que se ordena en cada columna. null va siempre al final, sea cual sea el sentido. */
export function valorDe(f: FilaDeVista, columna: Columna): string | number | null {
  switch (columna) {
    case "equipo": return f.equipo.name;
    case "sector": return f.equipo.sectorNombre;
    case "mtbf": return f.mtbf;
    case "fallas": return f.fallas;
    case "ultima": return f.ultima;
    default: return f.confiabilidades[Number(columna.slice(1))] ?? null;
  }
}

export function ordenar(filas: FilaDeVista[], { columna, ascendente }: Orden): FilaDeVista[] {
  return [...filas].sort((a, b) => {
    const x = valorDe(a, columna);
    const y = valorDe(b, columna);
    if (x === null && y === null) return b.fallas - a.fallas;
    if (x === null) return 1;
    if (y === null) return -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "es");
    if (c !== 0) return ascendente ? c : -c;
    return b.fallas - a.fallas;
  });
}

/**
 * Qué orden queda al tocar un encabezado: la misma columna da vuelta la flecha
 * y una columna nueva arranca mostrando su peor valor.
 */
export function siguienteOrden(actual: Orden, columna: Columna): Orden {
  if (actual.columna === columna) return { columna, ascendente: !actual.ascendente };
  // Las de texto arrancan alfabéticas. Las numéricas, por el peor valor: el
  // MTBF y las confiabilidades más bajas arriba, y las fallas y la fecha de la
  // última, las más altas.
  const arrancaDescendente = columna === "fallas" || columna === "ultima";
  return { columna, ascendente: !arrancaDescendente };
}
