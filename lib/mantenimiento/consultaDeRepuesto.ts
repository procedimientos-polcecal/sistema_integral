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
 * Debajo de eso vive lo que la OT hace con una pregunta nueva —leer lo que llega a
 * la ruta de notas, comprobarlo contra la orden, cuándo se ofrece preguntar y qué
 * se le dice a quien preguntó—, por la misma razón: la ruta y los componentes casi
 * no tienen tests, y una regla escrita adentro de ellos es una segunda definición
 * que se separa de la que sí está probada. Las dos excepciones prueban lo único que
 * esto no puede ver: `rutaDeNotas.test.ts` (qué columnas lee la ruta y qué hace con
 * lo que rechaza) e `historialDeLaOT.test.ts` (a qué entradas de la lista les
 * ofrece «Ya llegó»).
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
// Sólo tipos, y a propósito: `avisoAlInstante` importa `web-push`, que no puede
// viajar al navegador, y este módulo lo importan dos componentes de cliente
// (`JustificacionOT` y `RepuestosOTModal`). Un `import` común de un valor de ahí
// se llevaría la librería al bundle sin que nada lo avise.
import type {
  ItemQueEspera, NombreDeLoQueEspera, ResultadoDelAviso,
} from "@/lib/core/avisoAlInstante";

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

/**
 * Las preguntas que dejaron de esperar sin que nadie las contestara: las que
 * «quedaron sin responder».
 *
 * El diseño pide que una pregunta que se cierra sola —porque sacaron el repuesto de
 * la lista, o porque la orden ya no espera nada— no desaparezca: **queda registrada
 * como «quedó sin responder»**. Se deriva igual que «abierta», de las filas que ya
 * están, y por las mismas tres razones del encabezado: la tabla no se actualiza, una
 * fila nueva al cerrarla terminaría en la celda X de la planilla, y una marca
 * guardada sería un segundo dato. A la pregunta a cuyo repuesto sacaron la delata el
 * `repuesto_id` en null; a la de una orden suspendida o realizada, el estado.
 *
 * Es lo que `preguntasAbiertas` descarta, menos lo que **tuvo su final**:
 *
 *  - una RESPUESTA que la apunta: la contestaron, o quien preguntó la cerró con «ya
 *    llegó» —la misma fila—;
 *  - otra PREGUNTA que la apunta: un seguimiento la superó. El hilo sigue en la
 *    última, y es ésa la que queda sin responder si el hilo termina así: marcar
 *    también a la primera diría dos veces lo mismo sobre una sola conversación.
 *
 * Filtra y nada más, como `preguntasAbiertas`: no ordena ni toca lo que recibe. Y una
 * pregunta no puede estar en las dos listas.
 */
export function preguntasSinResponder(
  notas: readonly NotaDeLaOT[],
  estadoDeLaOrden: string | null
): NotaDeLaOT[] {
  const abiertas = new Set(preguntasAbiertas(notas, estadoDeLaOrden).map((p) => p.id));

  return notas.filter(
    (nota) =>
      nota.tipo === "PREGUNTA" &&
      !abiertas.has(nota.id) &&
      !tieneRespuesta(nota, notas) &&
      !estaSuperada(nota, notas)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Preguntar desde la OT: lo que decide la ruta de notas y lo que dice la pantalla
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cómo se nombra una pregunta de Mantenimiento en el push que le llega a Compras.
 *
 * Es **un solo objeto** que usan la ruta de notas y los tests, y no una frase
 * escrita en la ruta: `avisarAQuienDecide` ya no sabe decir «aprobación» a mano,
 * así que lo único que hace que este push diga «respuesta» es lo que se le pasa,
 * y una copia en la ruta sería una frase que ningún test ve. Los tests de abajo
 * pasan este mismo objeto por `textoDeLaInterrupcion` y comparan contra el texto
 * literal. Es lo que no tienen los otros dos emisores de `avisarAQuienDecide`: cada
 * uno escribe su `nombre` en el lugar y los tests usan copias, así que nada
 * compara lo que realmente mandan.
 */
export const NOMBRE_DE_LA_CONSULTA: NombreDeLoQueEspera = {
  singular: "Una consulta",
  plural: "consultas",
  verbo: { singular: "espera tu respuesta", plural: "esperan tu respuesta" },
};

/** A dónde lleva el push: la bandeja donde Compras contesta. */
export const URL_DE_LAS_CONSULTAS = "/compras/consultas";

/**
 * Lo que dice el push de una pregunta: de qué orden y de qué repuesto.
 *
 * Con un ítem solo `textoDeLaInterrupcion` nombra la etiqueta y lo que se pidió,
 * que es lo que deja saber de qué se habla sin abrir nada; la descripción es el
 * repuesto con su código, porque «rodamiento» a secas no alcanza para buscarlo en
 * el inventario. Y una OT sin número no es «OT null»: el tipo admite `null` y una
 * notificación que diga «null» no sirve para encontrar la orden.
 */
export function itemDeLaConsulta(
  orden: { ot_number: number | null },
  repuesto: { nombre: string; codigo: string | null }
): ItemQueEspera {
  const codigo = (repuesto.codigo ?? "").trim();
  return {
    etiqueta: orden.ot_number === null ? "OT sin número" : `OT ${orden.ot_number}`,
    descripcion: codigo ? `${repuesto.nombre} · ${codigo}` : repuesto.nombre,
  };
}

/**
 * En qué estados de la OT se ofrece «Preguntar a Compras».
 *
 * Es la regla de lo que **se ofrece**, y el diseño la dejó escrita como una lista
 * a propósito: «EN_PROCESO queda afuera por ahora, y si en la práctica hace falta,
 * se suma — es un valor en una lista». Sumarlo es agregar un valor acá.
 *
 * **La ruta no la usa**, y no es un descuido. Lo que la ruta rechaza es lo que
 * `preguntasAbiertas` daría por cerrado desde que nace —una orden realizada o
 * suspendida—, porque ahí el push saldría para una pregunta que no aparece en la
 * bandeja de nadie. Una pregunta sobre una orden en proceso no nace cerrada:
 * quedaría guardada, abierta y a la vista, aunque la pantalla no la ofrezca.
 *
 * Y un estado vacío o desconocido **no se ofrece**, al revés que en
 * `preguntasAbiertas`: allá esconder dejaba una pregunta ya hecha sin que nadie
 * la viera; acá es un botón que interrumpe a una persona, y no se muestra «por
 * las dudas».
 */
export const ESTADOS_EN_LOS_QUE_SE_PREGUNTA: readonly string[] = ["POR_HACER", "ATRASADO"];

export function sePuedePreguntarEn(estado: string | null | undefined): boolean {
  return ESTADOS_EN_LOS_QUE_SE_PREGUNTA.includes(String(estado ?? "").trim().toUpperCase());
}

/**
 * Lo que arranca escrito en la caja de la pregunta: el repuesto, y los RI en curso.
 *
 * La pregunta **se escribe, no se genera**: «¿llega antes del jueves?» y «¿qué
 * pasa con el rodamiento?» son preguntas distintas, y una frase armada por el
 * sistema obliga a quien contesta a levantar el teléfono para entender qué le
 * preguntan. Pero la entrada tiene que **nombrar el repuesto** y **llevar el
 * número de RI** cuando hay uno, porque sin eso contestar empieza por buscar de
 * qué pedido se habla — y no puede apoyarse en la pregunta anterior del hilo: de
 * cada hilo sólo la última está abierta, y es la que lista la bandeja de Compras,
 * así que un seguimiento tiene que decir de qué pieza habla por sí mismo.
 *
 * Los RI van separados por certeza, igual que en la pantalla: el que coincide por
 * **código** es el mismo artículo, y el que coincide sólo por el **nombre** es
 * texto libre que escribió gente distinta, y se dice «posible». «RI 1842» a secas
 * afirmaría un pedido que quien pregunta no sabe que sea ése.
 *
 * Termina en «: » para que quien escribe siga a continuación.
 */
export function encabezadoDeLaPregunta(
  repuesto: { nombre: string; codigo: string | null },
  ris?: {
    porCodigo: readonly { nro_ri: number }[];
    porNombre: readonly { nro_ri: number }[];
  }
): string {
  const codigo = (repuesto.codigo ?? "").trim();
  const partes = [codigo ? `${repuesto.nombre} (${codigo})` : repuesto.nombre];

  const numeros = (lista: readonly { nro_ri: number }[]) =>
    lista.map((r) => `RI ${r.nro_ri}`).join(", ");

  if (ris && ris.porCodigo.length > 0) partes.push(numeros(ris.porCodigo));
  if (ris && ris.porNombre.length > 0) partes.push(`posible ${numeros(ris.porNombre)}`);

  return `${partes.join(" · ")}: `;
}

/**
 * Lo que precarga el botón de seguir una pregunta que no tuvo respuesta. Después
 * de `encabezadoDeLaPregunta`, que ya nombra el repuesto.
 */
export const TEXTO_DEL_SEGUIMIENTO = "Sigue sin llegar.";

/**
 * Lo que escribe el «ya llegó»: la `RESPUESTA` de quien preguntó, que cierra su
 * propia pregunta. Es la misma fila que escribiría Compras —quién la escribió lo
 * dice `creado_por`—, así que no hace falta un cuarto tipo.
 *
 * Lleva texto porque la nota lo exige y porque **es lo que ve la planilla**: la
 * última nota de la OT va a la columna X, sea del tipo que sea. Y no arranca con
 * ningún carácter que la planilla interprete —hay un test—, para que viaje sin
 * apóstrofo.
 */
export const TEXTO_DE_YA_LLEGO = "Ya llegó el repuesto.";

// ── Lo que llega a la ruta de notas ──────────────────────────────────────────

/** Lo que una nota nueva declara de sí misma, ya normalizado. */
export interface NotaNueva {
  tipo: TipoDeNota;
  /** De qué repuesto se pregunta: sólo en una PREGUNTA. */
  repuesto_id: string | null;
  /** A qué nota se refiere: el seguimiento, o la pregunta que se contesta. */
  responde_a: string | null;
}

export type NotaNuevaLeida =
  | { ok: true; nota: NotaNueva }
  | { ok: false; status: 400; error: string };

const esUnTipoDeNota = (valor: unknown): valor is TipoDeNota =>
  typeof valor === "string" && (TIPOS_DE_NOTA as readonly string[]).includes(valor);

/** Un id opcional: ausente o en blanco es `null`, y lo que no es un texto no vale. */
function leerId(valor: unknown): { ok: true; id: string | null } | { ok: false } {
  if (valor === undefined || valor === null) return { ok: true, id: null };
  if (typeof valor !== "string") return { ok: false };
  return { ok: true, id: valor.trim() || null };
}

/**
 * Lo que el cuerpo de un POST de notas dice de la nota: el tipo y a qué se refiere.
 * El texto se valida aparte, con `validarNota`.
 *
 * **Sin tipo es una justificación**, que es lo único que mandaba la pantalla hasta
 * ahora: el cuerpo viejo, `{ texto }`, sigue andando igual.
 *
 * Cada tipo exige lo suyo y rechaza lo que no le corresponde, porque lo que se
 * guarda mal acá no se puede arreglar después —la tabla no tiene `update`—:
 *
 *  - una **justificación** no lleva repuesto ni apunta a nada. Una que apuntara a
 *    otra nota la trabaría: `responde_a` no borra en cascada, y ese borrado daría
 *    23503 sin que nadie supiera por qué;
 *  - una **pregunta** exige el repuesto. De él depende que se cierre sola cuando lo
 *    sacan de la lista, y sin id `preguntasAbiertas` la daría por cerrada desde que
 *    nace (un `repuesto_id` en null en una PREGUNTA significa «sacaron el
 *    repuesto»). Es la exigencia que el punto 4 del encabezado de este módulo
 *    pide no tocar;
 *  - una **respuesta** exige a qué pregunta contesta y no lleva repuesto: el
 *    repuesto es el de la pregunta, y repetirlo sería un segundo dato.
 *
 * Es la parte que no necesita la base. Que la pregunta, el repuesto o el hilo sean
 * de esta orden y estén como se supone lo comprueba `comprobarNotaNueva`, con lo
 * que la ruta lee.
 */
export function leerNotaNueva(cuerpo: unknown): NotaNuevaLeida {
  const c = (typeof cuerpo === "object" && cuerpo !== null ? cuerpo : {}) as Record<string, unknown>;
  const rechazo = (error: string): NotaNuevaLeida => ({ ok: false, status: 400, error });

  const tipo = c.tipo ?? "JUSTIFICACION";
  if (!esUnTipoDeNota(tipo)) {
    return rechazo(`El tipo de la nota tiene que ser uno de: ${TIPOS_DE_NOTA.join(", ")}.`);
  }

  const repuesto = leerId(c.repuesto_id);
  if (!repuesto.ok) return rechazo("El repuesto de la pregunta tiene que ser un identificador.");
  const apunta = leerId(c.responde_a);
  if (!apunta.ok) return rechazo("La nota a la que se responde tiene que ser un identificador.");

  const nota: NotaNueva = { tipo, repuesto_id: repuesto.id, responde_a: apunta.id };

  if (tipo === "JUSTIFICACION" && (nota.repuesto_id !== null || nota.responde_a !== null)) {
    return rechazo("Una justificación no lleva repuesto ni apunta a otra nota.");
  }
  if (tipo === "PREGUNTA" && nota.repuesto_id === null) {
    return rechazo("Falta decir de qué repuesto es la pregunta.");
  }
  if (tipo === "RESPUESTA") {
    if (nota.responde_a === null) return rechazo("Falta decir a qué pregunta responde.");
    if (nota.repuesto_id !== null) {
      return rechazo("Una respuesta no lleva repuesto: el repuesto es el de la pregunta.");
    }
  }

  return { ok: true, nota };
}

/** Un repuesto de la lista de la orden, con lo que hace falta para nombrarlo. */
export interface RepuestoDeLaOT {
  id: string;
  nombre: string;
  codigo: string | null;
}

/**
 * Lo que la ruta lee de **esta** orden para comprobar una nota.
 *
 * Las notas y los repuestos tienen que ser los de la orden de la URL y no de
 * varias: «abierta» depende de las dos cosas, y con las de otra orden una pregunta
 * se abriría o se cerraría por un estado que no es el suyo (ver `preguntasAbiertas`).
 */
export interface ContextoDeLaNota {
  estadoDeLaOrden: string | null;
  notas: readonly NotaDeLaOT[];
  repuestos: readonly RepuestoDeLaOT[];
}

export type NotaNuevaComprobada =
  | {
      ok: true;
      /** El repuesto de la pregunta, para armar el push; `null` si la nota no es una. */
      repuesto: RepuestoDeLaOT | null;
    }
  // 400 es lo que no está bien dicho, y 409 lo que estuvo bien y ya no: una pantalla
  // vieja. El cliente tiene que recargar sólo en el segundo caso.
  | { ok: false; status: 400 | 409; error: string };

/**
 * Si una nota nueva se puede guardar en **esta** orden, tal como está hoy.
 *
 * Es lo que la ruta hace con lo que `leerNotaNueva` ya aceptó. Defiende, del lado
 * del servidor, lo que la pantalla da por supuesto y una pantalla vieja puede
 * romper: dos personas con la misma orden abierta, una que contesta mientras la
 * otra aprieta «ya llegó», un repuesto que sacaron de la lista. Ninguna regla de
 * acá se llega a incumplir desde la pantalla al día, y la ruta es lo único que las
 * impide cuando la pantalla no está al día.
 *
 *  - **A qué apunta** tiene que ser una PREGUNTA **de esta orden**. Sin cascade, una
 *    nota que apunta a otra orden traba el borrado de esa otra: el `delete` da 23503,
 *    y el borrado de espejo borra OT de a 200 con un `.in()`, así que la tanda entera
 *    falla y se repite en cada corrida hasta que alguien arregla el dato.
 *  - **Una respuesta** contesta una pregunta que está **abierta**. Una segunda
 *    respuesta a la misma pregunta no rompe nada (la pregunta se cierra una sola
 *    vez), pero es un «ya llegó» sobre una conversación que ya se dio: se rechaza y
 *    la pantalla recarga y muestra lo que pasó.
 *  - **Una pregunta** es de un repuesto de **esta** orden y de una orden que todavía
 *    espera. Y hay **una abierta por repuesto**: sin `responde_a`, si ya hay una, se
 *    rechaza; con `responde_a`, tiene que apuntar a **la** abierta y no a «la primera»
 *    —con tres en un hilo, un seguimiento a la primera dejaría abiertas a las dos
 *    últimas—. Es la regla que el botón de la pantalla ya cumple; acá se cumple
 *    también cuando la pantalla no lo sabe.
 *
 * No es atómica: dos POST que lleguen a la vez pueden pasar los dos, y nada en la
 * base lo impide. `preguntaAbiertaDelRepuesto` ya contempla ese caso (devuelve la más
 * reciente), así que lo que queda es una pregunta de más en la bandeja y no un dato
 * roto.
 *
 * Una justificación no se refiere a nada y pasa sin mirar: lo que ya andaba, igual.
 */
export function comprobarNotaNueva(
  nota: NotaNueva,
  contexto: ContextoDeLaNota
): NotaNuevaComprobada {
  if (nota.tipo === "JUSTIFICACION") return { ok: true, repuesto: null };

  const { estadoDeLaOrden, notas, repuestos } = contexto;
  const rechazo = (status: 400 | 409, error: string): NotaNuevaComprobada =>
    ({ ok: false, status, error });

  if (nota.responde_a !== null) {
    const destino = notas.find((n) => n.id === nota.responde_a);
    if (!destino) return rechazo(400, "La nota a la que respondés no es de esta orden.");
    if (destino.tipo !== "PREGUNTA") {
      return rechazo(400, "Sólo se puede responder o dar seguimiento a una pregunta.");
    }
  }

  if (nota.tipo === "RESPUESTA") {
    const estaAbierta = preguntasAbiertas(notas, estadoDeLaOrden)
      .some((p) => p.id === nota.responde_a);
    if (!estaAbierta) {
      return rechazo(
        409,
        "Esa pregunta ya no está abierta: la contestaron, le dieron seguimiento o la " +
        "orden ya no espera nada. Recargá la orden para verlo."
      );
    }
    return { ok: true, repuesto: null };
  }

  const repuesto = repuestos.find((r) => r.id === nota.repuesto_id);
  if (!repuesto) return rechazo(400, "Ese repuesto no está en la lista de esta orden.");

  if (laOrdenYaNoEspera(estadoDeLaOrden)) {
    return rechazo(409, "Esta orden ya no espera ningún repuesto: está realizada o suspendida.");
  }

  const abierta = preguntaAbiertaDelRepuesto(notas, repuesto.id, estadoDeLaOrden);

  if (nota.responde_a === null) {
    if (abierta) {
      return rechazo(
        409,
        "Ya hay una pregunta abierta por ese repuesto: sumá el seguimiento a esa en vez " +
        "de abrir otra. Recargá la orden para verla."
      );
    }
  } else if (abierta?.id !== nota.responde_a) {
    return rechazo(
      409,
      "Esa pregunta ya no es la última del hilo: la contestaron o le dieron seguimiento. " +
      "Recargá la orden para verlo."
    );
  }

  return { ok: true, repuesto };
}

/**
 * Qué contestar cuando la base se niega a borrar una nota.
 *
 * Desde la migración 20261029082249, `responde_a` no borra en cascada: una nota a
 * la que otra apunta **no se puede borrar**, y la base contesta 23503. Es lo que
 * impide que quien preguntó se lleve puesta la respuesta de Compras al borrar su
 * pregunta —la ruta deja borrar la nota propia—, y está en la base y no en la ruta
 * para que ninguna se lo pueda olvidar. Pero sin traducir, esa negativa llegaba a la
 * pantalla como el texto crudo de Postgres: `violates foreign key constraint …`.
 *
 * Es un 409 y no un 400: lo que se pidió estaba bien dicho, y no se puede por cómo
 * está el historial. Cualquier otro error sigue como estaba —el mensaje de la base y
 * un 400—: no se traduce lo que no se sabe qué es.
 */
export function errorDeBorrarNota(
  error: { code?: string; message: string }
): { status: number; error: string } {
  if (error.code === "23503") {
    return {
      status: 409,
      error:
        "No se puede borrar esta entrada: otra del historial la responde o le da " +
        "seguimiento, y quedaría sin su pregunta.",
    };
  }
  return { status: 400, error: error.message };
}

/** Lo que se le dice a quien acaba de preguntar, y si el aviso llegó. */
export interface LoQueSeLeDice {
  /** Que a Compras le llegó el aviso. La pantalla lo pinta de verde, y si no, de ámbar. */
  llego: boolean;
  texto: string;
}

/**
 * Qué decirle a quien preguntó, según lo que contestó `avisarAQuienDecide`.
 *
 * **Que no avisara a nadie no puede quedar callado.** La pregunta se guarda igual en
 * todos los casos —ya está en el historial de la orden cuando se llega acá—, y por eso
 * el aviso nunca la voltea, pero quien preguntó tiene que saber que nadie fue
 * interrumpido: sin eso cree que Compras lo sabe, y es justo el canal que nadie mira
 * del que el diseño quiere escapar. El caso que el diseño nombra es el de la lista
 * `compras_consultados` vacía —«se puede escribir igual pero no interrumpe a
 * nadie»—, que `avisarAQuienDecide` llama `motivo: "nadie aprueba"` porque el texto
 * se escribió para la lista de aprobadores.
 *
 * Las palabras de cada `motivo` son las de `avisoAlInstante.ts` y nada las compara:
 * un test pasa por la función de verdad para los dos que se pueden provocar sin
 * red, así que si allá cambian, esos tests lo dicen. Uno que no se conoce —un fallo
 * del push service, por ejemplo— se muestra **tal cual lo dijo**, sin traducir: un
 * diagnóstico vago es peor que uno feo.
 */
export function queDecirDelAviso(
  aviso: ResultadoDelAviso | null | undefined
): LoQueSeLeDice {
  if (!aviso) return { llego: false, texto: "La pregunta quedó guardada en la orden." };

  if (aviso.enviadas > 0) {
    return {
      llego: true,
      texto: "La pregunta quedó guardada en la orden y a Compras ya le llegó el aviso.",
    };
  }

  switch (aviso.motivo) {
    case "nadie aprueba":
      return {
        llego: false,
        texto:
          "Se guardó, pero no hay nadie configurado para contestar, así que a nadie le " +
          "llegó el aviso. La lista se arma en Compras → Configuración.",
      };
    case "fuera de hora":
      return {
        llego: false,
        texto:
          "Se guardó, pero a esta hora no se avisa a Compras: la van a ver cuando abran " +
          "sus consultas.",
      };
    case "nadie suscripto":
      return {
        llego: false,
        texto:
          "Se guardó, pero el aviso no le llegó a nadie: quien contesta no tiene las " +
          "notificaciones activadas en ningún aparato.",
      };
    case "nadie activo":
      return {
        llego: false,
        texto:
          "Se guardó, pero el aviso no le llegó a nadie: la persona configurada para " +
          "contestar está dada de baja.",
      };
    case undefined:
      // Se intentó y ningún aparato lo recibió: no hay `motivo`, pero tampoco es éxito.
      return { llego: false, texto: "Se guardó, pero el aviso no llegó a ningún aparato." };
    default:
      return { llego: false, texto: `Se guardó, pero no se pudo avisar: ${aviso.motivo}` };
  }
}
