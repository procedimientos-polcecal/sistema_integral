import { paraUnAsunto } from "./asuntoDeCorreo";

/**
 * A quién le llega un aviso de la mensajería, y qué dice el correo.
 *
 * ## Por qué esto existe
 *
 * Un hilo de mensajes pegado a un registro —una orden de trabajo, un
 * requerimiento, una condición insegura— sólo sirve si quien es mencionado se
 * entera **sin tener que entrar a mirar**. El correo es ese aviso. Acá se decide
 * a quién y con qué texto; quien lo manda es `enviarCorreo()` de
 * `lib/core/correo.ts` y quien junta los datos es la ruta.
 *
 * ## Es pura
 *
 * No toca la base, ni `fetch`, ni `process.env`, ni la hora. Es lo que la hace
 * probable, y acá está casi todo lo que puede salir mal: a quién le llega es una
 * decisión de **permisos**, y un correo mal dirigido no se recupera.
 *
 * ## Qué hilo es un hilo
 *
 * No hay tabla de hilos: un hilo *es* el par (tipo, entidad). Por eso su id es
 * `${tipo}:${entidadId}` y se arma afuera —acá llega como texto—.
 *
 * Ojo con el nombre: `lib/core/correo.ts` ya exporta una interfaz `Mensaje`, que
 * es **el correo a mandar**. Este módulo no exporta otra, a propósito: dos cosas
 * distintas con el mismo nombre en `lib/core` es cómo se confunden después.
 */

export type TipoDeEntidad = "orden_trabajo" | "requerimiento" | "condicion_insegura";

export interface Destinatario {
  usuarioId: string;
  /** Null si la persona no tiene correo cargado: no es un error, es un dato que falta. */
  email: string | null;
  /**
   * Si puede ver **el registro** al que está pegado el hilo, no el hilo en sí.
   * Lo calcula quien llama con los permisos del módulo dueño del registro.
   */
  puedeVerElRegistro: boolean;
}

/**
 * De los mencionados, a quiénes se les manda el correo.
 *
 * Tres que se quedan afuera, cada una por un motivo distinto:
 *
 * **Quien escribió.** Se mencionó a sí mismo, o respondió en un hilo donde ya
 * estaba: un correo que repite lo que acaba de escribir es el que se aprende a
 * ignorar.
 *
 * **Quien no puede ver el registro.** El correo lleva **el texto del mensaje**,
 * así que mandárselo a quien no tiene el módulo le filtraría su contenido, y el
 * enlace lo rebotaría al inicio. Que lo hayan mencionado no le da acceso.
 *
 * **Quien no tiene correo.** Se salta sin romper: aparece en el hilo igual, y
 * el aviso que se pierde es sólo el del correo.
 *
 * Y quien aparece mencionado dos veces recibe **uno**: sale de la misma persona,
 * no de dos pedidos.
 */
export function aQuienLeLlega(mencionados: Destinatario[], autorId: string): Destinatario[] {
  const yaVistos = new Set<string>();
  const resultado: Destinatario[] = [];
  for (const m of mencionados) {
    if (m.usuarioId === autorId) continue;
    if (!m.puedeVerElRegistro) continue;
    // Una dirección en blanco es lo mismo que ninguna: el Apps Script la
    // rechazaría y el correo se contaría como un fallo.
    if (!m.email || !m.email.trim()) continue;
    if (yaVistos.has(m.usuarioId)) continue;
    yaVistos.add(m.usuarioId);
    resultado.push(m);
  }
  return resultado;
}

/**
 * El correo de una mención. Devuelve `asunto` y `cuerpo`, que es lo que
 * `Mensaje` de `lib/core/correo.ts` pide además de `para`: encaja sin traducir.
 *
 * **El asunto lleva el id del hilo entre corchetes y entero.** Existe para que
 * el día que se quiera leer la respuesta a un correo se la pueda enganchar a su
 * hilo; agregarlo después no sirve para los correos ya mandados. Por eso va
 * **fuera del recorte**: lo que se acota a `LARGO_DEL_ASUNTO` es la parte
 * legible, y el id se suma al final. Si fuera adentro, un texto largo se lo
 * comería justo donde más hace falta.
 *
 * **El texto del mensaje va al cuerpo tal cual**, sin escapar nada: el cuerpo
 * viaja como texto plano y escapar `<` o `"` los mostraría deformados.
 *
 * **El cuerpo dice que no se responde ahí.** Va a pasar igual —es un correo, y
 * un correo se contesta—, y la respuesta cae en una casilla personal y se pierde
 * sin que nadie lo note. Más vale decir dónde se contesta.
 */
export function correoPorMencion(m: {
  autor: string;
  queEs: string;
  texto: string;
  dondeVerlo: string;
  hiloId: string;
}): { asunto: string; cuerpo: string } {
  const legible = paraUnAsunto(`${m.autor} te mencionó en ${m.queEs}: ${m.texto}`);
  // Sin ningún espacio, y no «uno solo»: un id con un salto de línea adentro es
  // una cabecera partida igual que un texto con uno.
  const hilo = m.hiloId.replace(/\s+/g, "");

  return {
    asunto: `${legible} [${hilo}]`,
    cuerpo: [
      `${m.autor} te mencionó en ${m.queEs}:`,
      m.texto,
      `Para verlo y contestar: ${m.dondeVerlo}`,
      "No respondas a este correo: no llega a nadie. La respuesta se escribe en el sistema, en el mismo hilo.",
    ].join("\n\n"),
  };
}

/**
 * Cómo se titula un hilo en pantalla.
 *
 * Un registro puede borrarse —una OT que la planilla dejó de tener, una
 * condición que se sacó— y sus mensajes quedan. Mostrar un hilo sin título
 * parece un error de la pantalla; decir que el registro ya no está es lo que
 * pasó.
 */
export function tituloDelHilo(queEs: string, existeElRegistro: boolean): string {
  return existeElRegistro ? queEs : `${queEs} (el registro ya no está)`;
}
