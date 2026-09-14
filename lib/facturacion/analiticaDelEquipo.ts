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
