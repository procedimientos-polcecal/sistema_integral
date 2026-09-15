/**
 * Qué cuenta analítica de Odoo le corresponde a un equipo del SdG.
 *
 * ## Es una llave dura, no un parecido
 *
 * El grupo le puso a cada equipo un código —`PO-A1-01`, `PY-B1-01`, `EM6`— y ese
 * mismo código **está escrito en el nombre de la analítica de Odoo**:
 * `PO-A1-01 - ACARREADOR DE PLACAS`. No es que los nombres se parezcan: es el
 * mismo identificador de los dos lados, que es la diferencia entre emparejar y
 * adivinar.
 *
 * Medido sobre los 239 equipos activos: **236 resuelven a una sola analítica por
 * empresa**, ninguno se queda sin analítica, y 3 quedan ambiguos.
 *
 * ## Los tres ambiguos, y por qué no se eligen
 *
 * `C1`, `C2` y `C3`. En Odoo hay una analítica llamada `C1` en el plan CANTERA y
 * otra `C1 - COMPRESOR 1` en el plan COMPRESORES: dos cosas distintas que
 * empiezan igual. Con el código solo no se puede saber cuál, así que no se elige
 * ninguna.
 *
 * ## El borde importa
 *
 * `EM1` **no** puede matchear `EM10`. Se exige que el código termine ahí: o el
 * nombre es exactamente el código, o sigue con un espacio o un guión. Sin ese
 * borde, el equipo EM1 se llevaba dieciséis analíticas por delante — pasó al
 * escribir esto.
 */

export interface AnaliticaDeOdoo {
  id: number;
  nombre: string;
  /** `res.company`, o `null` si es compartida. */
  empresa: number | null;
}

export type EleccionDeAnalitica =
  | { analitica: AnaliticaDeOdoo; motivo: null }
  | { analitica: null; motivo: string; candidatas: AnaliticaDeOdoo[] };

function normalizar(texto: string): string {
  return texto.toUpperCase().trim();
}

/** El nombre empieza con el código **y ahí termina el código**. */
function nombraAlEquipo(nombre: string, codigo: string): boolean {
  const n = normalizar(nombre);
  return n === codigo || n.startsWith(`${codigo} `) || n.startsWith(`${codigo}-`);
}

/**
 * La analítica del equipo en esa empresa, o por qué no se pudo.
 *
 * La empresa manda igual que en todo el resto del enlace: cada analítica
 * pertenece a una, y repartirle el gasto a la de la otra sería un asiento en la
 * contabilidad equivocada.
 */
export function analiticaDelEquipo(
  codigoDelEquipo: string | null | undefined,
  analiticas: AnaliticaDeOdoo[],
  companyId: number
): EleccionDeAnalitica {
  if (!codigoDelEquipo?.trim()) {
    return { analitica: null, motivo: "El equipo no tiene código.", candidatas: [] };
  }

  const codigo = normalizar(codigoDelEquipo);
  const nombradas = analiticas.filter((a) => nombraAlEquipo(a.nombre, codigo));

  if (!nombradas.length) {
    return {
      analitica: null,
      motivo: `Odoo no tiene ninguna cuenta analítica que empiece con ${codigo}.`,
      candidatas: [],
    };
  }

  const propias = nombradas.filter((a) => a.empresa === companyId);
  const elegibles = propias.length ? propias : nombradas.filter((a) => a.empresa === null);

  if (elegibles.length === 1) return { analitica: elegibles[0], motivo: null };

  if (!elegibles.length) {
    return {
      analitica: null,
      motivo: `La analítica de ${codigo} existe en Odoo pero en la otra empresa.`,
      candidatas: nombradas,
    };
  }

  return {
    analitica: null,
    motivo: `Hay ${elegibles.length} cuentas analíticas que empiezan con ${codigo}: hay que elegir cuál.`,
    candidatas: elegibles,
  };
}

/**
 * La analítica que se llama **exactamente** como lo que contestó quien pidió.
 *
 * ## Por qué esto es mejor que pasar por el equipo
 *
 * El desplegable de EQUIPO QUE SOLICITA del formulario no usa un vocabulario
 * propio: usa el del grupo, `PO-A1-01 - ACARREADOR DE PLACAS`, que es palabra
 * por palabra el nombre de la cuenta analítica de Odoo. Medido sobre las 255
 * opciones del desplegable, **241 son una única cuenta analítica en cada
 * empresa y ninguna es ambigua**.
 *
 * Y cubre lo que el equipo no puede: catorce de esas opciones —PAÑOL, GALPON 1,
 * TALLER ELÉCTRICO, CONTRATISTA— no son máquinas y no existen en el catálogo de
 * equipos, pero **sí** son cuentas analíticas. Por el nombre llegan; por el
 * equipo no llegarían nunca.
 *
 * ## Exacto, o nada
 *
 * La comparación es por igualdad del nombre completo, sin acentos y sin
 * espacios de más. No hay "empieza con" ni "se parece": si la respuesta no es
 * una analítica, no se propone ninguna y queda el camino del código.
 */
export function analiticaPorNombre(
  texto: string | null | undefined,
  analiticas: AnaliticaDeOdoo[],
  companyId: number
): AnaliticaDeOdoo | null {
  const buscado = sinAcentos(texto ?? "");
  if (!buscado) return null;

  const iguales = analiticas.filter((a) => sinAcentos(a.nombre) === buscado);
  if (!iguales.length) return null;

  const propias = iguales.filter((a) => a.empresa === companyId);
  const elegibles = propias.length ? propias : iguales.filter((a) => a.empresa === null);

  return elegibles.length === 1 ? elegibles[0] : null;
}

function sinAcentos(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}
