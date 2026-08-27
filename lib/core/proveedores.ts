/**
 * Reconocer a un proveedor por su nombre.
 *
 * La tabla `proveedores` es una sola para todo el SdG: quien provee materiales
 * a Compras y quien presta un servicio a Mantenimiento son la misma lista, y
 * `es_contratista` distingue de qué lado juega cada uno. Un mismo proveedor
 * puede ser las dos cosas.
 *
 * El problema es que en las planillas el nombre se escribe a mano cada vez. De
 * los 77 proveedores que aparecen en las de mantenimiento, 18 están escritos de
 * más de una forma —"Candia" y "CANDIA", "NELO Electrónica" y "NELO
 * electronica"— y eso lo resuelve la normalización. Los que no resuelve
 * —"Cortadi" y "Domingo Cortadi"— hay que fusionarlos a mano: sólo alguien que
 * los conoce sabe si son el mismo.
 */

/**
 * El nombre de un proveedor, listo para comparar.
 *
 * Sin acentos, sin mayúsculas, sin puntos ni comas y con los espacios
 * colapsados. Un guión suelto no es un nombre.
 */
export function claveDeProveedor(nombre: string | null | undefined): string {
  const s = String(nombre ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return s === "-" ? "" : s;
}

/** Los proveedores conocidos, indexados por su nombre normalizado. */
export function indiceDeProveedores(
  proveedores: { id: string; nombre: string }[]
): Map<string, string> {
  const indice = new Map<string, string>();
  // El primero gana: si dos filas normalizan igual, la segunda es un duplicado
  // que habrá que fusionar, y hasta entonces conviene ser estable.
  for (const p of proveedores) {
    const clave = claveDeProveedor(p.nombre);
    if (clave && !indice.has(clave)) indice.set(clave, p.id);
  }
  return indice;
}

/** El id del proveedor que se llama así, o `null` si no lo conocemos. */
export function buscarProveedor(
  indice: Map<string, string>,
  nombre: string | null | undefined
): string | null {
  const clave = claveDeProveedor(nombre);
  return clave ? indice.get(clave) ?? null : null;
}

/** Cuántas letras tiene que tener una palabra para identificar a alguien. */
const MINIMO = 4;

/**
 * Palabras que dicen el rubro, no quién es.
 *
 * Sin esta lista, "CN Mecanizados" y "Gundel mecanizados" quedan como el mismo
 * proveedor por compartir el oficio. Verificadas contra los nombres de las
 * planillas.
 */
const DEL_RUBRO = new Set([
  "metalurgica", "mecanizados", "mecanizado", "ingenieria", "electronica",
  "transporte", "transportes", "montajes", "hnos", "hermanos", "facultad",
  "taller", "servicios", "construcciones", "distribuidora",
]);

/** Las palabras del nombre que sirven para reconocer al proveedor. */
const palabrasPropias = (clave: string): string[] =>
  clave.split(" ").filter((p) => p.length >= MINIMO && !DEL_RUBRO.has(p));

/**
 * Los nombres que probablemente sean el mismo proveedor.
 *
 * Se juntan los que uno contiene al otro entero —"Cortadi" dentro de "Domingo
 * Cortadi"—, que es cómo aparecen en las planillas: el nombre corto y el
 * completo. No alcanza con compartir una palabra: "Metalurgica Fonavi" y
 * "Metalúrgica Mario" comparten el rubro, no el proveedor.
 *
 * Es una sugerencia, no una fusión: decidir si son el mismo es de quien los
 * conoce.
 */
export function nombresParecidos(nombres: string[]): string[][] {
  const claves = nombres
    .map((n) => ({ nombre: n, clave: claveDeProveedor(n) }))
    .filter((x) => palabrasPropias(x.clave).length > 0);

  const grupos: string[][] = [];
  const yaAgrupado = new Set<string>();

  for (let i = 0; i < claves.length; i++) {
    if (yaAgrupado.has(claves[i].nombre)) continue;

    const grupo = [claves[i].nombre];
    for (let j = i + 1; j < claves.length; j++) {
      if (yaAgrupado.has(claves[j].nombre)) continue;
      if (unoContieneAlOtro(claves[i].clave, claves[j].clave)) {
        grupo.push(claves[j].nombre);
        yaAgrupado.add(claves[j].nombre);
      }
    }

    if (grupo.length > 1) {
      yaAgrupado.add(claves[i].nombre);
      grupos.push(grupo);
    }
  }

  return grupos;
}

/**
 * Si uno de los dos nombres está entero dentro del otro, como palabras.
 *
 * Se compara por palabra y no por subcadena para que "Mario" no entre en
 * "Mariotti".
 */
function unoContieneAlOtro(a: string, b: string): boolean {
  if (a === b) return true;

  // El mismo nombre pegado o separado: "ConMet" y "Con-Met" son uno solo.
  const pegado = (s: string) => s.replace(/[\s-]+/g, "");
  if (pegado(a) === pegado(b)) return true;

  const [corto, largo] = a.length <= b.length ? [a, b] : [b, a];
  const propiasDelCorto = palabrasPropias(corto);
  if (propiasDelCorto.length === 0) return false;

  const palabrasDelLargo = new Set(largo.split(" "));
  return propiasDelCorto.every((p) => palabrasDelLargo.has(p));
}

/**
 * Los proveedores que coinciden con lo que se está escribiendo.
 *
 * Busca en cualquier parte del nombre y no sólo al principio: quien escribe
 * "ciuffo" no se acuerda de que está cargado como "Papelera Ciuffo". Y usa la
 * misma normalización que el resto, así que "olavarria" encuentra "Bolsas
 * Olavarría".
 *
 * Sin texto devuelve los primeros, para que abrir el selector muestre algo en
 * vez de una lista vacía.
 */
export function proveedoresQueCoinciden<T extends { nombre: string }>(
  proveedores: T[],
  texto: string,
  cuantos = 8
): T[] {
  const q = claveDeProveedor(texto);
  const lista = q
    ? proveedores.filter((p) => claveDeProveedor(p.nombre).includes(q))
    : proveedores;
  return lista.slice(0, cuantos);
}
