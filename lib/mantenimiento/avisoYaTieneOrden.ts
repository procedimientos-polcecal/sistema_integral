/**
 * Un aviso no puede tener dos órdenes de trabajo, y quién lo impide es esto.
 *
 * **Por qué vive acá y no en la pantalla.** Hasta el 19/11/2026 nada lo
 * impedía: `avisos.work_order_id` es una sola columna, así que una segunda
 * orden no quedaba "al lado" de la primera — la pisaba, y el aviso terminaba
 * apuntando a la última mientras la anterior seguía viva, abierta y sin nadie
 * que la nombre. Eso no se nota nunca, que es lo que lo vuelve caro.
 *
 * El formulario ya cierra el camino corto —apretar «Crear OT» dos veces
 * seguidas—, pero quedaban dos por los que se llega igual: cerrar el modal
 * después de que la carga quedó encolada y volver a abrirlo (el estado vive en
 * el componente y se pierde al desmontarlo), y cualquier cosa que postee a la
 * ruta sin pasar por esa pantalla. Por eso la regla está del lado que las dos
 * puertas comparten.
 *
 * **Lo que no hace**: no mira si las dos órdenes se parecen. Un aviso con
 * orden es un aviso atendido, y si hace falta más trabajo sobre lo mismo, se
 * carga desde Órdenes de trabajo —donde la orden nueva no pretende ser la
 * respuesta a este aviso—. Decidirlo por parecido sería adivinar.
 */

/**
 * El aviso tal como lo trae la ruta, con su orden embebida.
 *
 * El embebido llega como objeto o como arreglo según cómo resuelva PostgREST
 * la relación, así que se aceptan las dos formas —es la misma precaución que
 * toma `valorHoraDe` en RRHH, y por la misma razón: la forma depende de la
 * consulta y no del dato.
 */
export interface AvisoConSuOrden {
  oa_number?: string | null;
  work_order_id?: string | null;
  ordenes_trabajo?:
    | { ot_number?: number | string | null }
    | { ot_number?: number | string | null }[]
    | null;
}

/** El número de la orden embebida, venga como objeto o como arreglo. */
function numeroDeLaOrden(aviso: AvisoConSuOrden): string | null {
  const embebido = aviso.ordenes_trabajo;
  const fila = Array.isArray(embebido) ? embebido[0] : embebido;
  const numero = fila?.ot_number;
  if (numero === null || numero === undefined || numero === "") return null;
  return String(numero);
}

/**
 * Por qué este aviso no puede recibir otra orden, o `null` si sí puede.
 *
 * Devuelve la frase entera y no un booleano porque el mensaje es el trabajo:
 * tiene que nombrar **cuál** es la orden que ya existe —sin eso, quien lo lee
 * no sabe si lo que iba a cargar ya está cargado— y decir qué hacer en vez de
 * sólo negarse.
 *
 * El número puede faltar aunque el enlace esté puesto: la orden existe pero
 * todavía no tiene número de planilla. Ahí se dice que ya tiene una orden sin
 * inventarle un número, que es peor que no darlo.
 */
export function porQueNoPuedeTenerOtraOrden(
  aviso: AvisoConSuOrden | null | undefined,
): string | null {
  if (!aviso?.work_order_id) return null;

  const aviso_ = aviso.oa_number ? `El aviso ${aviso.oa_number}` : "Este aviso";
  const numero = numeroDeLaOrden(aviso);
  const cual = numero ? `la orden de trabajo #${numero}` : "una orden de trabajo";

  return (
    `${aviso_} ya tiene ${cual}. Si hace falta más trabajo sobre lo mismo, ` +
    `cargalo desde Órdenes de trabajo.`
  );
}
