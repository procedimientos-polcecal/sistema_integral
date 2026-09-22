/**
 * Resolver el "Operador" del form de partes diarios ("Jorge Becker") contra
 * `empleados` — el dropdown del form da nombre y apellido juntos en un solo
 * texto, `empleados` los tiene en columnas separadas.
 *
 * Hay ambigüedad real: al 22/09/2026 hay tres empleados con apellido
 * "Becker" (Jorge Enrique, Marcelo Baltazar, Miqueas Andres) — verificado
 * contra la base. Por apellido solo no alcanza; hace falta desambiguar con
 * el nombre de pila.
 */

export interface EmpleadoLiviano {
  id: string;
  nombre: string;
  apellido: string;
}

/**
 * Busca por apellido (alguna palabra del texto matchea `apellido` entero,
 * sin distinguir mayúsculas/acentos simples) y, si hay más de un
 * candidato, desambigua exigiendo que alguna otra palabra del texto sea
 * también el primer nombre de pila del empleado. Sin match, o si sigue
 * ambiguo después de desambiguar, devuelve `null` — no se adivina entre
 * varios "Becker" (mismo criterio que el resto del sistema: enlazar al que
 * se parece es peor que null).
 */
export function resolverOperarioPorNombreCompleto(
  nombreCompleto: string,
  empleados: EmpleadoLiviano[]
): string | null {
  const normalizar = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim()
      .toUpperCase();

  const palabras = normalizar(nombreCompleto)
    .split(/\s+/)
    .filter(Boolean);
  if (palabras.length === 0) return null;

  const candidatos = empleados.filter((e) => palabras.includes(normalizar(e.apellido)));
  if (candidatos.length === 0) return null;
  if (candidatos.length === 1) return candidatos[0].id;

  // Ambiguo por apellido: desambiguar por el primer nombre de pila.
  const desambiguados = candidatos.filter((e) => {
    const primerNombre = normalizar(e.nombre).split(/\s+/)[0];
    return palabras.includes(primerNombre);
  });

  return desambiguados.length === 1 ? desambiguados[0].id : null;
}
