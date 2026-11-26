/**
 * Si lo que un pedido traía ya entró al pañol, y cuándo.
 *
 * ## Por qué existe
 *
 * El `estado_compra` de un RI pasa a `RECIBIDO` cuando una persona lo marca, y
 * eso no siempre ocurre. Medido el 24/11/2026 sobre los 2.352 requerimientos:
 * **1.646 dicen `RECIBIDO`** —o sea que la columna se usa y no está muerta— y
 * **161 ya recibieron mercadería y su estado no lo dice**.
 *
 * Eso tiene una consecuencia que se ve de afuera: de los 115 pedidos que el
 * semáforo da por reclamables, **12 ya están en el pañol**, y **6 de ellos
 * están en amarillo o rojo**, o sea que ofrecen el botón «Reclamar». El más
 * viejo es el RI 1843, que entró el 21/08/2026 —al día siguiente de pedirse— y
 * sigue en `SIN_INICIAR`: reclamarlo es preguntar por algo que está guardado
 * hace tres meses, y es la forma más rápida de que nadie vuelva a creerle al
 * semáforo. Es el mismo argumento que dejó a `EN_ESPERA` afuera del conjunto
 * reclamable.
 *
 * ## Lo que NO hace
 *
 * **No cambia el semáforo ni los conteos de la franja.** Un pedido que llegó
 * pero sigue en `SIN_INICIAR` **sí** espera algo de Compras —que lo cierre—,
 * así que sigue contado y sigue con su punto de color. Lo único que cambia es
 * que en vez de ofrecer un reclamo, la fila dice cuándo entró: que es
 * exactamente el dato con el que alguien puede cerrarlo.
 *
 * Y **no marca el RI como recibido**. Esa decisión es de quien recibió —lo dejó
 * escrito la migración 048, porque una entrega parcial cerraría un pedido
 * entero— y sigue siéndolo.
 *
 * ## El enlace es el RI resuelto
 *
 * `requerimiento_id` y nunca «una entrada del mismo código por esos días».
 * Medido el mismo día sobre las 766 entradas que nombran un requerimiento:
 * **16 llevan un código distinto al del RI que dicen traer**, así que cruzar
 * por código además de ser una conjetura daría distinto. Enlazar al que se le
 * parece es peor que dejar en null.
 */

/** Una entrada al pañol que nombra el requerimiento que la trajo. */
export interface EntradaConRequerimiento {
  requerimiento_id: string | null;
  tipo: string;
  /** ISO, o null: el kardex tiene filas sin fecha. */
  fecha: string | null;
}

/** Cuándo entró lo de un pedido. */
export interface LlegadaAlPanol {
  /** El día de la **primera** entrada, en ISO corto. Null si ninguna la trae. */
  fecha: string | null;
  /** Cuántas entradas tiene ese pedido. Más de una es una entrega en partes. */
  cuantas: number;
}

const texto = (v: unknown) => String(v ?? "").trim();

/**
 * Qué pedidos ya recibieron algo, con la fecha de la primera entrega.
 *
 * **La primera y no la última**, porque la pregunta que contesta es «¿hace
 * cuánto que esto está acá?», y para un pedido que llegó en dos partes la
 * respuesta honesta es la fecha en que dejó de tener sentido reclamarlo.
 *
 * El `tipo` se filtra adentro y no en la consulta, igual que en
 * `lib/inventario/reponer.ts` y por el mismo motivo: que una salida no cuente
 * como recepción es una decisión, y si la consulta la filtrara no habría nada
 * que probar. Hoy los 767 movimientos con `requerimiento_id` son entradas, así
 * que el filtro no saca ninguno — está para el día que eso cambie.
 */
export function llegadasPorRequerimiento(
  movimientos: EntradaConRequerimiento[]
): Map<string, LlegadaAlPanol> {
  const porId = new Map<string, LlegadaAlPanol>();

  for (const m of movimientos) {
    if (m.tipo !== "entrada") continue;
    const id = texto(m.requerimiento_id);
    if (!id) continue;

    const dia = texto(m.fecha).slice(0, 10) || null;
    const previo = porId.get(id);
    if (!previo) {
      porId.set(id, { fecha: dia, cuantas: 1 });
      continue;
    }
    porId.set(id, {
      // Una entrada sin fecha no pisa a una que sí la tiene: diría «llegó» sin
      // poder decir cuándo, que es menos de lo que ya se sabía.
      fecha: menorFecha(previo.fecha, dia),
      cuantas: previo.cuantas + 1,
    });
  }

  return porId;
}

function menorFecha(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

/**
 * Lo que la fila dice en lugar de ofrecer un reclamo.
 *
 * Nombra **el pañol** y no «el sistema» porque es donde hay que ir a buscarlo,
 * y dice la fecha porque sin ella la frase no habilita ninguna acción: con el
 * día, quien mira sabe si fue ayer —y entonces falta cerrarlo— o en agosto.
 */
export function textoDeLaLlegada(llegada: LlegadaAlPanol, comoSeLee: (iso: string) => string): string {
  const partes = llegada.cuantas > 1 ? ` en ${llegada.cuantas} entregas` : "";
  return llegada.fecha
    ? `Ya entró al pañol el ${comoSeLee(llegada.fecha)}${partes}`
    : `Ya entró al pañol${partes}`;
}

/**
 * Los estados que ya dicen cómo terminó el pedido.
 *
 * Es la misma lista que `COMPRA_CERRADA` de `lib/inventario/reponer.ts` y por
 * el mismo motivo, pero no se comparte: allá decide si un RI prueba que vale
 * la pena esperar antes de pedir de nuevo, y acá si la fila tiene algo que
 * agregar. Dos preguntas distintas que hoy se contestan con los mismos dos
 * valores; atarlas haría que cambiar una cambie la otra sin que nadie lo pida.
 */
const YA_LO_DICE = new Set(["RECIBIDO", "DENEGADO"]);

/**
 * Si el estado del pedido **no** dice ya que la mercadería llegó.
 *
 * Es la condición para que la fila agregue la nota: sobre un `RECIBIDO` sería
 * repetir lo que la etiqueta de al lado ya dice, y sobre un `DENEGADO` sería
 * contradecirla sin poder explicar la contradicción.
 *
 * `EN_ESPERA` **sí** entra, y es el caso donde más sirve: un pedido frenado a
 * propósito cuya mercadería ya está guardada es justo el que nadie vuelve a
 * mirar.
 */
export function elEstadoNoLoDice(estado: string | null | undefined): boolean {
  return !YA_LO_DICE.has(texto(estado));
}
