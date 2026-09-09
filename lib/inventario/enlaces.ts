/**
 * Reconocer contra el núcleo lo que la planilla nombra en texto.
 *
 * El kardex dice "MANTENIMIENTO", "Lopez", "Acme SA": nombres escritos a mano,
 * cada vez. El SdG ya tiene sectores, empleados y proveedores, y el trabajo es
 * cruzarlos.
 *
 * **Los catálogos no se crean desde acá.** Es la diferencia más importante con
 * el importador del repo de origen, que arranca con `delete from sectores`,
 * `equipos`, `empleados` y `proveedores` y los rehace. En el SdG esas cuatro
 * tablas las comparten RRHH, Mantenimiento, Remises y Compras: crear una fila
 * por cada variante mal tipeada que aparezca en una planilla del almacén
 * llenaría la lista que usan los otros cuatro módulos. Lo que no se reconoce
 * queda en null y se informa, igual que decidió la 032 para proveedores.
 */

import { claveDeProveedor } from "@/lib/core/proveedores";

/**
 * Un catálogo del núcleo, indexado por su nombre normalizado.
 *
 * `null` marca la clave que empata: dos filas se llaman igual y ninguna gana.
 */
export type Indice = Map<string, string | null>;

/**
 * Arma el índice de un catálogo.
 *
 * Se normaliza con la misma regla que usa el padrón de proveedores —sin
 * acentos, sin mayúsculas, sin puntos, espacios colapsados— porque el problema
 * es el mismo en los tres: "Candia" y "CANDIA" son uno solo.
 *
 * Si dos filas normalizan igual, la clave no resuelve a ninguna.
 *
 * Antes ganaba la primera, con este argumento: elegir la segunda dependería del
 * orden en que vinieron. El argumento no se sostiene —elegir la primera depende
 * igual, y PostgREST no promete un orden—, y sobre todo contradice la regla que
 * este mismo archivo aplica en todo lo demás: enlazar al que se le parece es
 * peor que dejar en null, porque el dato aparece en el lugar que no es y no se
 * nota nunca. Un empate es justamente no reconocerlo con certeza.
 *
 * Hoy no cambia nada: los cuatro catálogos que se indexan acá —29 sectores, 289
 * proveedores, 21 destinos, 64 solicitantes— no tienen un solo empate. Cambia
 * el día que alguien cargue el duplicado, que es cuando importa.
 */
export function indicePorNombre(filas: { id: string; nombre: string }[]): Indice {
  const indice: Indice = new Map();
  for (const f of filas) {
    const k = claveDeProveedor(f.nombre);
    if (!k) continue;
    // Se compara contra el id y no contra la clave: la misma fila entrando dos
    // veces no es un empate, son dos formas de nombrarla.
    indice.set(k, indice.has(k) && indice.get(k) !== f.id ? null : f.id);
  }
  return indice;
}

/**
 * El índice de empleados, que necesita las dos formas de escribir un nombre.
 *
 * `indicePorNombre` sobre `empleados` no reconocía **ninguno** de los 3.794
 * movimientos con solicitante, y la razón es tonta: la tabla guarda el nombre y
 * el apellido en columnas separadas, así que el índice quedaba armado con
 * "Fabricio" mientras la planilla escribe "GALLASTEGUI, Fabricio". Cero de
 * 3.794.
 *
 * Y no alcanza con una sola forma, porque en la planilla conviven las dos:
 * "VARELA, Francisco Enrique" y "Augusto Candia". Cada empleado entra con las
 * dos —la coma la borra la normalización, así que "apellido, nombre" y
 * "apellido nombre" son la misma clave—. Con eso se reconocen 2.835 de 3.794.
 *
 * Los 959 restantes **quedan en null a propósito**. Son "Omar Piparo" y
 * "Sebastian" —que no están en el padrón—, "REGULADOR" y "OFICINAS" —que no son
 * personas—, y "Lopez Raul" contra "LOPEZ, Raul Argentino", donde acertar
 * requiere saber que no hay otro López. Enlazar al que se le parece es peor que
 * dejar vacío: el dato aparece en el legajo de otro y nadie lo nota.
 */
export function indiceDeEmpleados(
  filas: { id: string; nombre: string; apellido?: string | null }[]
): Indice {
  const indice: Indice = new Map();
  for (const f of filas) {
    const nombre = String(f.nombre ?? "").trim();
    const apellido = String(f.apellido ?? "").trim();
    const formas = apellido
      ? [`${apellido} ${nombre}`, `${nombre} ${apellido}`]
      : [nombre];

    for (const forma of formas) {
      const k = claveDeProveedor(forma);
      if (!k) continue;
      // Dos empleados que se escriben igual no resuelven a ninguno. Las dos
      // formas de un mismo empleado sí, porque el id es el mismo: "LOPEZ, Raul"
      // y "Raul LOPEZ" son la misma persona, "Raul Lopez" y otro "Raul Lopez"
      // no, y ahí acertar requiere saber que no hay dos.
      indice.set(k, indice.has(k) && indice.get(k) !== f.id ? null : f.id);
    }
  }
  return indice;
}

/**
 * El índice de equipos del núcleo, armado por **código**.
 *
 * La planilla escribe `"PO-A1-11 - CINTA TRANSPORTADORA 6"`: el código y el
 * nombre pegados con un guión. Y en 26 de los 255 equipos de la pestaña el
 * nombre **no** es el del núcleo —`EM8` es "SCANIA 420 4x4" en la planilla y
 * "CAMIÓN VOLCADOR 1" en `equipos`—, así que matchear por nombre perdería esos
 * 26. El código es lo único que las dos puntas escriben igual.
 *
 * Se indexa por tres formas: el código solo, el `código - nombre` del núcleo, y
 * el nombre solo. Las tres van al mismo id, así que no compiten entre sí; un
 * empate real —dos equipos con el mismo código, o dos con el mismo nombre en
 * plantas distintas— resuelve a null, igual que en `indicePorNombre`.
 *
 * `equipos` es la única tabla del núcleo con las columnas en inglés (`code`,
 * `name`), de cuando la trajo Mantenimiento. Por eso la firma no dice `codigo`
 * ni `nombre`.
 */
export function indiceDeEquipos(
  filas: { id: string; code?: string | null; name: string }[]
): Indice {
  const indice: Indice = new Map();

  for (const f of filas) {
    const code = String(f.code ?? "").trim();
    const name = String(f.name ?? "").trim();
    const formas = code ? [code, `${code} - ${name}`, name] : [name];

    for (const forma of formas) {
      const k = claveDeProveedor(forma);
      if (!k) continue;
      // Contra el id y no contra la clave: las tres formas del mismo equipo son
      // el mismo equipo. Dos equipos distintos con la misma clave sí empatan.
      indice.set(k, indice.has(k) && indice.get(k) !== f.id ? null : f.id);
    }
  }
  return indice;
}

/**
 * El equipo del núcleo que nombra ese texto, o null.
 *
 * Primero prueba el **código**, que es lo que está antes del primer `" - "`. Si
 * esa clave está en el índice —resuelva a un id o quede ambigua— la respuesta
 * es esa y ahí termina: cuando dos equipos comparten código (`indiceDeEquipos`
 * los dejó en null), no hay que dejar que el texto completo desempate por
 * casualidad con el nombre de uno de los dos, porque volvería a ser "enlazar
 * al que se le parece". Sólo si el código ni siquiera está en el índice —no era
 * un código, era todo el texto— se prueba el texto entero. En ese orden porque
 * el código es lo confiable: los nombres divergen.
 *
 * Devuelve null para `PAÑOL`, `GALPON 5` y `PO-C1-11 - EDIFICIO`, que la
 * pestaña usa como relleno para que el desplegable de un sector sin máquinas no
 * quede vacío. No son equipos y no tienen por qué serlo.
 *
 * `esAmbiguo` no sirve para explicar un null de esta función: hace
 * `claveDeProveedor(nombre)` sobre el texto completo y no repite el split por
 * código de acá arriba, así que sobre un índice de `indiceDeEquipos` puede
 * contradecir a `reconocerEquipo` (un código ambiguo que esta función corta en
 * seco, `esAmbiguo` lo mira por el texto completo y a veces sí desempata). Hoy
 * no molesta porque nadie llama a las dos juntas sobre un índice de equipos
 * —`sincronizar.ts` usa `esAmbiguo` sólo con índices de `indicePorNombre`—, pero
 * el día que alguien quiera reportar el empate de un equipo aparte, como se
 * hace para destinos y solicitantes, necesita su propia versión con el split.
 */
export function reconocerEquipo(
  indice: Indice,
  texto: string | null | undefined
): string | null {
  const s = String(texto ?? "").trim();
  if (!s || s === "-") return null;

  const claveCodigo = claveDeProveedor(s.split(" - ")[0]);
  if (claveCodigo && indice.has(claveCodigo)) return indice.get(claveCodigo) ?? null;

  return reconocer(indice, s);
}

/** El id del catálogo para ese nombre, o null si no se lo reconoce. */
export function reconocer(indice: Indice, nombre: string | null | undefined): string | null {
  const k = claveDeProveedor(nombre);
  return k ? indice.get(k) ?? null : null;
}

/**
 * Si el nombre no se reconoció porque hay más de uno que se llama así.
 *
 * Sirve para decirlo aparte de "no existe": no se arreglan igual. Un nombre que
 * no está se resuelve dándolo de alta o corrigiendo la planilla; uno repetido
 * se resuelve en el catálogo, y hasta que se resuelva ninguna de las dos filas
 * va a enganchar nada. Un diagnóstico que no se distingue de otro no es un
 * diagnóstico.
 */
export function esAmbiguo(indice: Indice, nombre: string | null | undefined): boolean {
  const k = claveDeProveedor(nombre);
  return Boolean(k) && indice.get(k) === null;
}

/**
 * Lo que la planilla nombró y el núcleo no tiene.
 *
 * Se junta para poder decirlo en pantalla en vez de que desaparezca. Un enlace
 * que falta y nadie ve es un reporte que miente sin avisar.
 */
export class SinReconocer {
  private readonly vistos = new Map<string, Set<string>>();

  anotar(catalogo: string, nombre: string | null | undefined): void {
    const s = String(nombre ?? "").trim();
    if (!s || s === "-") return;
    if (!this.vistos.has(catalogo)) this.vistos.set(catalogo, new Set());
    this.vistos.get(catalogo)!.add(s);
  }

  /** Los nombres sin reconocer por catálogo, ordenados. */
  resumen(): Record<string, string[]> {
    const salida: Record<string, string[]> = {};
    for (const [catalogo, nombres] of this.vistos) {
      if (nombres.size > 0) salida[catalogo] = [...nombres].sort();
    }
    return salida;
  }
}
