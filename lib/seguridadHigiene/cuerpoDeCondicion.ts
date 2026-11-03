import { z } from "zod";

/**
 * Lo que el alta de una condición insegura acepta en el cuerpo del pedido.
 *
 * **No clasifica nada.** El nivel de riesgo lo calculan columnas generadas en
 * Postgres y la clasificación (I, S, M, PS, NS) la hace la pantalla con
 * `clasificar()`: la ruta no pasa por ahí, así un cambio de umbral no puede dejar
 * dos respuestas distintas.
 *
 * LOS CINCO PUNTAJES SON OPCIONALES PORQUE UNA CONDICIÓN NACE SIN EVALUAR. Lo que
 * no se admite es un valor fuera de la escala: 3/2/1, 3/2/1, 5/3/1, 9/7/3 y
 * 5/3/1. Son las mismas escalas que los `check` de la tabla; si una cambia, va en
 * los dos lados. Quien carga desde el teléfono (`edicion`) no manda ninguno —el
 * trigger de la base lo frena si lo intenta—; los acepta el esquema porque el
 * alta también la usa quien es `admin` y evalúa en el momento.
 *
 * QUÉ ES OBLIGATORIO. `descripcion`, `accion_propuesta` y `prioridad` lo son del
 * alta aunque la tabla los deje nullables: la tabla tiene que poder recibir las
 * 44 condiciones del Excel, que entran sin todo, pero parado frente al problema
 * siempre se sabe qué se ve y qué habría que hacer. Con `peligro_id` pasa lo
 * mismo que con el lugar y es opcional acá: se puede cargar sin elegirlo y la
 * gestión lo completa. El lugar se exige en la ruta (ver `problemaDelLugar`),
 * porque es una regla sobre dos campos y no sobre uno.
 *
 * Los mensajes que arma `validar()` hablan del campo con su nombre en el cuerpo
 * (`controles tiene que ser uno de: 1, 3, 5.`), igual que el resto de las rutas
 * que lo usan.
 */

const puntaje = <T extends number>(valores: readonly T[]) =>
  z.literal(valores as T[]).nullish();

/** Un texto con algo escrito. El `refine` trae su mensaje, que `validar()` respeta. */
const textoNoVacio = (mensaje: string) =>
  z.string().trim().refine((t) => t.length > 0, mensaje);

export const esquemaDeCondicion = z.object({
  /** Con el teléfono sin señal, se repite en cada reintento. Ver la ruta. */
  clave: textoNoVacio("La clave de la carga no puede estar vacía").optional(),

  sector_id: z.guid().nullish(),
  equipo_id: z.guid().nullish(),
  detectada_el: z.iso.date().optional(),

  descripcion: textoNoVacio("Contá qué viste"),
  peligro_id: z.guid().nullish(),
  accion_propuesta: textoNoVacio("Falta la acción propuesta"),
  prioridad: z.literal([1, 2, 3]),

  frecuencia: puntaje([3, 2, 1]),
  antecedentes: puntaje([3, 2, 1]),
  controles: puntaje([5, 3, 1]),
  magnitud_dano: puntaje([9, 7, 3]),
  legislacion: puntaje([5, 3, 1]),
});

export type CuerpoDeCondicion = z.infer<typeof esquemaDeCondicion>;

/**
 * Una condición se carga en un sector **o** en un equipo. Los dos a la vez los
 * rechaza también la tabla (`num_nonnulls(sector_id, equipo_id) <= 1`), pero ese
 * rechazo llega como un error de Postgres que no dice nada en castellano.
 *
 * Con los dos en null devuelve null: que falte el lugar es regla del alta y la
 * dice la ruta, y la tabla tiene que poder dejarlo vacío (las 44 del Excel).
 * Un texto vacío cuenta como que no vino.
 */
export function problemaDelLugar(
  sector_id: string | null | undefined,
  equipo_id: string | null | undefined
): string | null {
  if (sector_id && equipo_id) {
    return "Una condición se carga en un sector o en un equipo, no en los dos.";
  }
  return null;
}
