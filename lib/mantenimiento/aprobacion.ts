/**
 * Aprobar una orden de servicio.
 *
 * Aprobar es el paso que deja pasar la OS a comparativa, y hasta ahora se hacía
 * sólo a mano en la planilla. El sistema podía denegar pero no aprobar, y la
 * razón está en cómo está armada la planilla: cada pestaña de área es un
 * `FILTER(SERVICIOS!A2:K; área=…; estado="APROBADO")`, así que **`APROBADO` es
 * el único valor que mete una fila en una pestaña**. Y cuando el `FILTER`
 * levanta una fila, las de abajo se corren mientras el seguimiento escrito a
 * mano —comparativa, proveedor, costo, fechas— no se corre con ellas: queda un
 * costo colgado de otra OS.
 *
 * Lo que destrabó el asunto fue medir la trampa en vez de aceptarla. Comparando
 * `sheets_row` contra `os_number` dentro de cada pestaña, en las 228 filas de la
 * base, salieron **cero desórdenes en las siete pestañas**: el `FILTER` conserva
 * el orden ascendente por número. Entonces la fila entra en el medio sólo si su
 * número es menor que el de alguna que ya está ahí.
 *
 * De ahí la regla que gobierna todo este archivo:
 *
 * > Aprobar no corre ninguna fila si el número de la OS supera al máximo que ya
 * > está en la pestaña de su área.
 *
 * Diez de las once que esperan hoy la cumplen, y las que entren de acá en
 * adelante siempre van a cumplirla porque llegan con el número más alto. La que
 * no la cumple es la 26, vieja, que hay que aprobar a mano.
 */

import { dondeSeEscribeElEstado, esDenegacionDeOS } from "@/lib/mantenimiento/denegacion";

/** El estado con el que una OS queda aprobada. La palabra es la de la planilla. */
export const ESTADO_APROBADO = "APROBADO";

/**
 * Si el cambio aprueba la orden.
 *
 * Es lo que decide si hay que salir a leer la pestaña del área antes de
 * escribir: los demás cambios de estado no mueven ninguna fila y no necesitan
 * la cuenta.
 */
export function esAprobacionDeOS(estado: unknown): boolean {
  return String(estado ?? "").trim().toUpperCase() === ESTADO_APROBADO;
}

/**
 * Si aprobar esta OS metería su fila en el medio de la pestaña de su área.
 *
 * `null` es una pestaña sin ninguna OS: no hay nada abajo que correr, así que
 * la primera que se apruebe la estrena sin riesgo. Es el caso de `INVERSIONES`
 * y `DESPACHO`, que están en la lista de pestañas y no tienen filas.
 *
 * Empatar con el máximo tampoco corre nada —la fila queda al final igual— y el
 * número es único, así que no debería pasar. Negarse ahí sería negarse por las
 * dudas.
 */
export function aprobarCorreriaFilas(
  osNumber: number,
  maximoEnLaPestana: number | null
): boolean {
  if (maximoEnLaPestana === null) return false;
  return osNumber < maximoEnLaPestana;
}

/**
 * Si esta OS espera la decisión de quien aprueba.
 *
 * Que siga en `SERVICIOS` **es** que no se aprobó: llega a la pestaña de su área
 * si y sólo si alguien le escribió `APROBADO` en el maestro. Por eso la
 * pregunta se hace sobre la pestaña y no sobre la columna de estado, que en la
 * mayoría de estas filas viene vacía.
 *
 * Y por eso mismo quedan afuera las 23 que tienen el estado vacío pero ya viven
 * en la pestaña de su área: ésas ya fueron aprobadas y lo que les falta es el
 * seguimiento, que es otro trabajo y de otra persona.
 */
export function esperaDecision(os: {
  sheets_tab: string | null;
  estado: string | null;
}): boolean {
  if (dondeSeEscribeElEstado(os.sheets_tab) !== "maestro") return false;
  return !esDenegacionDeOS(os.estado);
}

/**
 * Cuánto pesa cada prioridad en el orden. Las palabras son las de la planilla,
 * las mismas de `PRIORIDADES_OS`.
 */
const PESO: Record<string, number> = {
  "URGENTE": 0,
  "1 SEMANA": 1,
  "NORMAL": 2,
  "LEVE": 3,
};

/**
 * El peso de una prioridad, con la vacía valiendo `NORMAL`.
 *
 * Diez de las once OS que esperan hoy no tienen prioridad cargada —la columna
 * viene por fórmula desde el formulario y llega vacía—. Mandarlas al fondo
 * dejaría las diez que de verdad esperan debajo de la única vieja; ponerlas
 * arriba sería decir que son urgentes sin que nadie lo haya dicho. El medio es
 * lo único que no inventa nada.
 */
const pesoDe = (prioridad: string | null): number =>
  PESO[String(prioridad ?? "").trim().toUpperCase()] ?? PESO["NORMAL"];

/**
 * La bandeja ordenada: lo más urgente primero, y a igual urgencia lo más viejo.
 *
 * Es el mismo criterio con el que ya se ordena la sección de requerimientos.
 *
 * Sin fecha va al final de su prioridad y no al principio: una fecha vacía no es
 * una fecha vieja, y tratarla como el año cero pondría arriba de todo justamente
 * a la que menos se sabe. El número desempata, que es el orden en que entraron.
 *
 * Devuelve un arreglo nuevo: ordenar en el lugar le cambiaría el orden a quien
 * nos lo pasó, que casi nunca es lo que quiso.
 */
export function ordenarParaAprobar<
  T extends { os_number: number; prioridad: string | null; fecha: string | null }
>(ordenes: T[]): T[] {
  return [...ordenes].sort((a, b) => {
    const porPrioridad = pesoDe(a.prioridad) - pesoDe(b.prioridad);
    if (porPrioridad !== 0) return porPrioridad;

    // La cadena vacía ordena antes que cualquier fecha, así que las sin fecha
    // se mandan al final con un valor que ninguna fecha real alcanza.
    const fa = a.fecha ?? "9999-12-31";
    const fb = b.fecha ?? "9999-12-31";
    if (fa !== fb) return fa < fb ? -1 : 1;

    return a.os_number - b.os_number;
  });
}

/**
 * Si se puede sacar a alguien de `os_aprobadores`.
 *
 * Es la misma regla que `puedeQuitarDeLaLista()` en Compras, con su propio
 * motivo porque lo que se traba es otro circuito. Vaciar la lista deja las OS
 * esperando para siempre: aprobar no depende del nivel, así que no hay un
 * administrador que pueda rescatar la situación aprobando él.
 */
export function puedeQuitarDeLaListaDeOS(
  cuantosHay: number
): { ok: true } | { ok: false; motivo: string } {
  if (cuantosHay > 1) return { ok: true };
  return {
    ok: false,
    motivo:
      "No se puede sacar al último de la lista: sin nadie que apruebe, ninguna " +
      "orden de servicio pasa a comparativa.",
  };
}

/**
 * Qué se le dice a quien quiso aprobar una OS que correría las filas.
 *
 * Negarse no puede ser un "no se pudo": quien aprueba tiene que saber qué hacer,
 * y lo que hay que hacer es aprobarla a mano en la planilla. El daño se nombra
 * porque es lo que justifica la negativa; sin eso parece un capricho del
 * sistema.
 */
export function porQueNoSePuedeAprobar(
  osNumber: number,
  pestana: string,
  maximoEnLaPestana: number | null
): string {
  return (
    `La OS #${osNumber} es más vieja que las que ya están en "${pestana}" ` +
    `(la última es la #${maximoEnLaPestana}), así que al aprobarla entraría en ` +
    "el medio de la pestaña y correría hacia abajo las filas de las demás. El " +
    "seguimiento —proveedor, costo, fechas— está escrito a mano y no se corre " +
    "con ellas: quedaría colgado de otra orden. Hay que aprobarla a mano en la " +
    "planilla, acomodando el seguimiento, y después traerla con «Traer de la " +
    "planilla»."
  );
}
