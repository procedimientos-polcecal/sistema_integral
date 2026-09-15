import { norm } from "./texto";

/**
 * Para qué equipo se pidió un requerimiento, según el formulario de Google.
 *
 * ## De dónde sale, y por qué no de la columna del master
 *
 * El formulario pregunta **EQUIPO QUE SOLICITA**, y como la pregunta está
 * repetida en cada rama del formulario —una por sector—, la hoja de respuestas
 * tiene esa columna **dieciséis veces**: quien contesta llena una sola y las
 * otras quince le quedan vacías.
 *
 * La planilla master junta esas dieciséis en una sola columna con
 * `FILTER(FLATTEN(...); ... <> "")`. Eso **no está alineado con la fila del
 * RI**: el filtro tira los blancos y deja los valores apretados arriba, así que
 * en cuanto un RI tenga equipo y el siguiente no, la fila N de esa columna deja
 * de ser el equipo del RI de la fila N. Sería enlazar cada compra a la máquina
 * de otro, en silencio.
 *
 * Por eso se lee la hoja de respuestas y se une **por número de RI**, que es lo
 * único que identifica la fila.
 *
 * ## Qué se hace con el texto
 *
 * El desplegable usa el vocabulario del grupo: `PO-A1-01 - ACARREADOR DE
 * PLACAS`. El código de adelante es el mismo que tiene el equipo en el núcleo,
 * así que el enlace es por identificador y no por parecido. Cuando el código no
 * existe —hay catorce opciones que no son equipos: PAÑOL, GALPON 1, LABORATORIO,
 * CONTRATISTA…— el enlace queda en null y sobrevive el texto, que es lo que
 * Facturación necesita para buscar la analítica.
 *
 * Esto es **la lectura**: de qué celda sale y a qué equipo corresponde. Qué
 * equipo termina teniendo un pedido cuando además su ubicación apunta a otro es
 * una pregunta distinta, y vive en `equipoDelPedido.ts`.
 */

/** Un equipo del núcleo, con lo poco que hace falta para reconocerlo. */
export interface EquipoDelNucleo {
  id: string;
  code: string | null;
  name: string | null;
}

/**
 * En qué columnas de la hoja de respuestas está la pregunta del equipo.
 *
 * Se buscan por el encabezado y no por su posición: hoy son las columnas O a AD,
 * pero cada rama nueva del formulario agrega una y las corre a todas.
 */
export function columnasDelEquipo(encabezado: string[]): number[] {
  const indices: number[] = [];
  encabezado.forEach((celda, i) => {
    if (norm(celda) === "EQUIPO QUE SOLICITA") indices.push(i);
  });
  return indices;
}

/**
 * Qué contestó esa fila, de entre las dieciséis columnas.
 *
 * Si contestó dos ramas con cosas distintas no se elige ninguna: no hay forma
 * de saber cuál vale, y elegir la primera sería inventar.
 */
export function equipoDeLaFila(fila: string[], columnas: number[]): string | null {
  const dichos = new Set<string>();
  let primero: string | null = null;

  for (const c of columnas) {
    const texto = limpiar(fila[c]);
    if (!texto) continue;
    if (!dichos.has(norm(texto))) {
      dichos.add(norm(texto));
      primero ??= texto;
    }
  }

  return dichos.size === 1 ? primero : null;
}

/**
 * El texto de la celda, o `null` si no dice nada.
 *
 * Los `#N/A`, `#REF!` y demás son fórmulas rotas de la planilla, no respuestas:
 * guardarlos como el equipo que pidió alguien sería guardar basura con cara de
 * dato.
 */
function limpiar(valor: unknown): string | null {
  const texto = String(valor ?? "").replace(/\s+/g, " ").trim();
  if (!texto) return null;
  if (texto.startsWith("#")) return null;
  return texto;
}

/**
 * El código que trae adelante el valor del desplegable.
 *
 * `PO-A1-01 - ACARREADOR DE PLACAS` → `PO-A1-01`. El separador es un guión
 * **rodeado de espacios**: el código tiene guiones adentro y partir por el
 * primero lo dejaría en `PO`.
 */
export function codigoDelTexto(texto: string): string {
  const [codigo] = texto.split(/\s+[-–]\s+/);
  return norm(codigo);
}

/**
 * Qué equipo del núcleo nombra ese texto, o `null`.
 *
 * Primero por código, que es un identificador; si no, por el nombre completo,
 * que sirve para los equipos móviles —el desplegable los nombra `EM6 -
 * CATERPILLAR 950 G` y el núcleo los llama `Cargadora frontal 2`, así que el
 * que engancha es el código—. En los dos casos la coincidencia tiene que ser
 * **exacta y única**: dos equipos que respondan al mismo texto no resuelven
 * nada, devuelven null.
 */
export function resolverElEquipo(
  texto: string | null,
  equipos: EquipoDelNucleo[]
): string | null {
  if (!texto) return null;

  const codigo = codigoDelTexto(texto);
  const porCodigo = equipos.filter((e) => e.code && norm(e.code) === codigo);
  if (porCodigo.length === 1) return porCodigo[0].id;
  if (porCodigo.length > 1) return null;

  const completo = norm(texto);
  const porNombre = equipos.filter((e) => e.name && norm(e.name) === completo);
  return porNombre.length === 1 ? porNombre[0].id : null;
}

/**
 * Lo que dijo cada RI, a partir de la grilla cruda de la hoja de respuestas.
 *
 * La fila 1 es el encabezado; la 2 y la 3 de esa hoja son de cebado y no traen
 * número de RI, así que se descartan solas.
 */
export function equiposPorRi(grilla: string[][]): Map<number, string> {
  const porRi = new Map<number, string>();
  if (grilla.length < 2) return porRi;

  const columnas = columnasDelEquipo(grilla[0]);
  if (!columnas.length) return porRi;

  for (let f = 1; f < grilla.length; f++) {
    const fila = grilla[f] ?? [];
    const nro = Number(String(fila[0] ?? "").replace(/[^0-9]/g, ""));
    if (!nro || isNaN(nro)) continue;

    const equipo = equipoDeLaFila(fila, columnas);
    if (equipo) porRi.set(nro, equipo);
  }

  return porRi;
}
