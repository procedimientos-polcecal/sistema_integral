/**
 * Qué pregunta de Mantenimiento a Compras sigue esperando respuesta.
 *
 * Una pregunta es una fila de `ordenes_trabajo_notas` con `tipo = 'PREGUNTA'`, y
 * se contesta con otra fila, `tipo = 'RESPUESTA'`, que la apunta por
 * `responde_a`. El diseño está en
 * docs/superpowers/specs/2026-10-26-mantenimiento-preguntar-a-compras-design.md
 * y el esquema en la migración 20261029082249.
 *
 * Todo lo puro de la consulta vive acá y nada más: no toca la base, la red ni
 * React, para que la regla se pruebe sin levantar nada. Tres lugares tienen que
 * contar lo mismo —la OT, que no abre una segunda pregunta por el mismo
 * repuesto; la bandeja de Compras, que lista las que esperan; y el resumen
 * diario, que las cuenta—, y por eso «abierta» se escribe una sola vez, acá. Un
 * conteo armado en SQL sería una segunda definición, y dos definiciones se
 * separan sin avisar.
 *
 * POR QUÉ NO HAY UNA COLUMNA `cerrada_en`
 *
 * Si una pregunta sigue abierta se **deriva** de las filas que ya están; no se
 * guarda. Por tres razones:
 *
 *  - `ordenes_trabajo_notas` no tiene policy de `update`, y es a propósito: «un
 *    historial que se puede reescribir no es un historial». Una marca de cerrada
 *    habría que escribirla sobre una fila que ya existe, y la tabla no lo deja.
 *  - La alternativa —que el sistema escribiera una fila nueva al cerrarla—
 *    termina en la planilla: la última fila del historial es la que viaja a la
 *    columna X (`celdaDeObservacionPrevia`), así que esa celda pasaría a decir
 *    «quedó sin responder», que es ruido para quien la mira de afuera.
 *  - Una marca guardada sería un segundo dato para algo que las filas ya dicen,
 *    y dos datos se separan.
 *
 * Que se derive no hace desaparecer nada: una pregunta cerrada sigue en el
 * historial de la OT para siempre. Lo único que cambia es que esta función deja
 * de contarla como abierta.
 *
 * QUÉ CIERRA UNA PREGUNTA
 *
 * Cuatro cosas, y cualquiera alcanza:
 *
 * 1. **Una RESPUESTA que la apunta.** Sea la de Compras o el «ya llegó» de quien
 *    preguntó: es la misma fila, y quién la escribió lo dice `creado_por`, así
 *    que acá no se distingue.
 *
 * 2. **Otra PREGUNTA que la apunta**: un seguimiento («sigue sin llegar»). Abierta
 *    es sólo la última del hilo. Sin esto, la pregunta y su seguimiento quedarían
 *    las dos en la bandeja de quien contesta diciendo lo mismo, que es el
 *    anti-objetivo del diseño: un canal más que nadie mira. Lo que supera a una
 *    pregunta es que otra la **apunte**, así que un seguimiento tiene que apuntar
 *    a la que está abierta —la que devuelve `preguntaAbiertaDelRepuesto`— y no a
 *    la primera del hilo: dos seguimientos apuntando a la primera dejarían
 *    abiertos a los dos.
 *
 * 3. **Que la orden ya no espere nada**: REALIZADO o SUSPENDIDA, los estados de
 *    `CERRADAS_GUT`. Una realizada ya se hizo y una suspendida no espera el
 *    repuesto de nadie, así que preguntar ahí es ruido. La lista es la de
 *    `gut.ts` y no una propia porque «ya no espera» ya está escrito en tres
 *    lugares —esa lista, su gemela `CERRADAS` de `alertas.ts` y el `case` de la
 *    columna `gut_orden`—, y una cuarta copia es una más que se separa sin
 *    avisar. Por eso es **la misma lista y no una copia**: un estado que se
 *    agregue ahí también cierra las preguntas (y ya pide una migración, por
 *    `gut_orden`).
 *
 *    No coincide, a propósito, con `pideJustificacion` de `notas.ts`, que sólo
 *    exceptúa a REALIZADO. Allá la pregunta es si hace falta explicar por qué la
 *    orden sigue abierta, y una suspendida sí necesita explicación; acá es si
 *    alguien espera una respuesta, y a una suspendida no le espera nadie.
 *
 *    Un estado vacío o que no conocemos deja la pregunta abierta: esconderla
 *    dejaría una OT esperando una respuesta que nadie ve, que es peor que mostrar
 *    una de más.
 *
 * 4. **Que `repuesto_id` sea null.** La FK es `on delete set null` —no cascade:
 *    sacar un repuesto de la lista no puede llevarse la conversación que hubo
 *    sobre él— y la ruta que escribe una pregunta tiene que exigir el repuesto,
 *    así que un null en una PREGUNTA no es «una pregunta sin repuesto» sino «una
 *    a cuyo repuesto sacaron», y esa ya no espera nada. Por eso la función no
 *    recibe qué repuestos siguen en la lista: un id que no es null siempre apunta
 *    a una fila viva. **Si alguna vez una pregunta pudiera escribirse sin
 *    repuesto, esta regla la escondería en silencio**: exigir el id al preguntar
 *    es parte de ella, y quien toque esa exigencia tiene que venir acá.
 */

import { CERRADAS_GUT } from "@/lib/mantenimiento/gut";
import { laUltimaNota } from "@/lib/mantenimiento/notas";

/**
 * Los tres valores del `check` de `ordenes_trabajo_notas.tipo`. Están escritos
 * acá y en la migración y nada los compara: lo único que hay es un test que
 * repite esta lista, para que tocarla no pase inadvertido. Agregar un cuarto
 * pide una migración nueva, porque una aplicada no se edita.
 */
export const TIPOS_DE_NOTA = ["JUSTIFICACION", "PREGUNTA", "RESPUESTA"] as const;

export type TipoDeNota = (typeof TIPOS_DE_NOTA)[number];

/**
 * Una entrada del historial de la OT, como vuelve de la base: lo de `Nota` de
 * `notas.ts` más lo que agregó la migración.
 *
 * `responde_a` no nulo NO quiere decir «tiene respuesta». Lleva tres casos —la
 * RESPUESTA de Compras, el seguimiento de una pregunta y el «ya llegó» de quien
 * preguntó— y lo que distingue a uno de otro es el tipo.
 */
export interface NotaDeLaOT {
  id: string;
  tipo: TipoDeNota;
  texto: string;
  creado_en: string;
  creado_por: string | null;
  repuesto_id: string | null;
  responde_a: string | null;
}

/**
 * Si una RESPUESTA apunta a esta pregunta.
 *
 * Lo dice el tipo y no `responde_a`: un seguimiento también tiene `responde_a`
 * y no contesta nada. Y tampoco es lo mismo que «cerrada»: una pregunta superada
 * por un seguimiento no tiene por qué tener RESPUESTA y sin embargo ya no
 * espera. Para saber si una espera, `preguntasAbiertas`.
 */
export function tieneRespuesta(
  pregunta: NotaDeLaOT,
  notas: readonly NotaDeLaOT[]
): boolean {
  return notas.some((n) => n.tipo === "RESPUESTA" && n.responde_a === pregunta.id);
}

/** Si otra PREGUNTA la apunta: un seguimiento que ocupa su lugar en el hilo. */
function estaSuperada(pregunta: NotaDeLaOT, notas: readonly NotaDeLaOT[]): boolean {
  return notas.some((n) => n.tipo === "PREGUNTA" && n.responde_a === pregunta.id);
}

/**
 * Si la orden ya no espera nada: está en alguno de los estados de `CERRADAS_GUT`.
 *
 * Se normaliza como `pideJustificacion` —sin mayúsculas ni espacios, y un estado
 * vacío no cuenta como cerrado—, pero la lista no es la suya, y no es un
 * descuido: el porqué está en el punto 3 de arriba.
 */
function laOrdenYaNoEspera(estado: string | null): boolean {
  return CERRADAS_GUT.includes(String(estado ?? "").trim().toUpperCase());
}

/**
 * Las preguntas de una orden que todavía esperan respuesta, en el orden en que
 * vinieron las notas.
 *
 * Recibe las notas de **una** orden y el estado de **esa** orden, porque
 * «abierta» depende de las dos cosas: con notas de varias órdenes y un solo
 * estado, las de las otras se cerrarían o se abrirían por un estado que no es el
 * suyo. Quien cuente sobre varias llama una vez por orden.
 *
 * Filtra y nada más: no ordena, no toca lo que recibe y no borra nada. Una
 * pregunta que deja de estar abierta sigue en el historial; lo único que cambia
 * es que esta lista ya no la trae.
 */
export function preguntasAbiertas(
  notas: readonly NotaDeLaOT[],
  estadoDeLaOrden: string | null
): NotaDeLaOT[] {
  if (laOrdenYaNoEspera(estadoDeLaOrden)) return [];

  // El recorrido anidado es a propósito: así «tiene respuesta» y «superada»
  // quedan definidas una sola vez. Cuesta, como mucho, 2·n² comparaciones en las
  // notas de UNA orden (20.000 con 100 notas): si alguna vez una orden junta
  // miles, es lo primero a revisar, y un índice por `responde_a` lo vuelve lineal.
  return notas.filter((nota) => {
    if (nota.tipo !== "PREGUNTA") return false;

    // `=== null` y no `== null`: una columna que el `select` no trajo llega como
    // `undefined`, y esa pregunta tiene que seguir a la vista. Mostrar una de más
    // se nota; esconder una viva, no.
    if (nota.repuesto_id === null) return false;

    return !tieneRespuesta(nota, notas) && !estaSuperada(nota, notas);
  });
}

/**
 * La pregunta que ese repuesto tiene esperando, o `null` si no tiene ninguna.
 *
 * Es lo que decide si el botón «Preguntar a Compras» abre una pregunta nueva o
 * invita a sumar al hilo de la que ya está: dos preguntas vivas por la misma
 * pieza son dos entradas en la bandeja de quien contesta que dicen lo mismo. El
 * seguimiento tiene que apuntar a la que devuelve esta función (ver el punto 2
 * de arriba).
 *
 * Debería haber una sola, pero nada en la base lo garantiza: dos personas con la
 * misma orden abierta pueden preguntar por la misma pieza con minutos de
 * diferencia. Si hay más de una devuelve la más reciente por `creado_en`, y no la
 * primera que venga. Con la misma fecha exacta no hay «más reciente» y gana la
 * última de las que vinieron, como en `laUltimaNota`: ahí sí cuenta el orden.
 */
export function preguntaAbiertaDelRepuesto(
  notas: readonly NotaDeLaOT[],
  repuestoId: string,
  estadoDeLaOrden: string | null
): NotaDeLaOT | null {
  return laUltimaNota(
    preguntasAbiertas(notas, estadoDeLaOrden).filter(
      (pregunta) => pregunta.repuesto_id === repuestoId
    )
  );
}
