/**
 * Contestar, desde Compras, lo que Mantenimiento preguntó por un repuesto.
 *
 * El diseño está en
 * docs/superpowers/specs/2026-10-26-mantenimiento-preguntar-a-compras-design.md.
 * La otra punta —qué pregunta está abierta, qué se puede escribir en el historial
 * de una OT— vive en `lib/mantenimiento/consultaDeRepuesto.ts`, y de ahí sale
 * `preguntasAbiertas`, que es **la única definición de «abierta» del sistema**.
 * Acá no se reescribe: se la llama.
 *
 * Todo lo de este archivo es puro —no toca la base, ni la red, ni React— porque la
 * ruta y la pantalla casi no tienen tests y una regla escrita adentro de ellas no
 * la ve nadie. Lo que sí es I/O se queda donde pertenece: `consultadosDeCompras`
 * y `tieneAccesoCompras` están en `lib/compras/auth.ts`, que es íntegramente I/O.
 *
 * QUÉ MERECIÓ SER UNA FUNCIÓN
 *
 * No todo. Lo que entró es lo que **falla en silencio**: nada tira un error, nada
 * se ve torcido en una captura, y el daño aparece días después.
 *
 *  - `aQuienAvisarDeLaRespuesta`: avisarle a quien acaba de contestar, o mandarle
 *    un push a `undefined`.
 *  - `bandejaDeConsultas`: juzgar las preguntas de una orden con el estado de otra.
 *  - `avisoDeLaRespuesta`: un push que dice «OT null» y lleva a ningún lado.
 *  - `queDecirDeLaRespuesta`: una respuesta que nadie recibió y nadie lo sabe.
 *  - `cambiarRespuesta`: una caja compartida que tira lo que la persona tipeó.
 *
 * `puedeResponderConsulta` es la excepción y entra igual: es un `&&` de dos
 * términos que ya están probados por separado, pero le pone nombre a la decisión
 * del diseño que más cuesta recordar —**contestar no pide nivel de Mantenimiento**,
 * sólo acceso a Compras y una pregunta abierta—.
 */

import {
  preguntasAbiertas,
  type NotaDeLaOT,
} from "@/lib/mantenimiento/consultaDeRepuesto";
// Sólo tipos, y a propósito: los dos módulos terminan importando `web-push`, que
// no puede viajar al navegador, y de acá lee `ConsultasClient`, que es un
// componente de cliente. Un `import` común de un valor de ahí se llevaría la
// librería al bundle sin que nada lo avise.
import type { Aviso } from "@/lib/core/webpush";
import type { ResultadoDelAviso } from "@/lib/core/avisoAlInstante";

/**
 * Si esta persona puede contestar esta pregunta.
 *
 * Son las dos condiciones del diseño y nada más:
 *
 *  - **tener acceso a Compras**, con cualquier nivel. No hace falta nivel de
 *    edición en Mantenimiento, que es lo que pide escribir una nota desde la OT:
 *    dárselo a quien compra para que pueda contestar sería abrirle toda la carga
 *    de órdenes para resolver un caso de treinta segundos. Tampoco hace falta
 *    estar en `compras_consultados` —esa lista decide a quién se le **avisa**, no
 *    quién puede contestar—: si el encargado está de licencia, quien lo cubre
 *    contesta sin que nadie tenga que editar una lista.
 *  - **que la pregunta siga abierta.** Quien la pasa es `preguntasAbiertas`; acá
 *    llega ya resuelta, como la pregunta o como `null`. Una ya contestada o
 *    superada por un seguimiento no se vuelve a contestar: sería un segundo
 *    «lo entrega el jueves» sobre una conversación que ya terminó.
 */
export function puedeResponderConsulta(
  quien: { accesoCompras: boolean },
  preguntaAbierta: { id: string } | null
): boolean {
  return quien.accesoCompras && preguntaAbierta !== null;
}

/**
 * A quién avisarle de esta respuesta, o `null` si no hay a quién.
 *
 * Devuelve el id del autor de la pregunta: nunca el de quien contesta.
 *
 * Son las dos condiciones que `avisarAUnaPersona` no puede tomar por su cuenta
 * —su `usuarioId` es `string` justamente porque esto se decide antes—, y las dos
 * fallan calladas:
 *
 *  - **que la pregunta tenga autor.** `ordenes_trabajo_notas.creado_por` admite
 *    null, así que una pregunta sin autor no tiene destinatario.
 *  - **que ese autor no sea quien contesta.** Un administrador con acceso a las
 *    dos puntas recibiría «Compras respondió tu consulta» por algo que escribió
 *    él un segundo antes, que es la notificación que enseña a ignorar las demás.
 *
 * El `creado_por` se mira por **falsedad y no con `=== null`**, y es la decisión
 * opuesta a la de `preguntasAbiertas`. Allá una columna que el `select` no trajo
 * llega `undefined` y conviene mostrar de más, porque esconder una pregunta viva
 * no se nota. Acá mostrar de más es **interrumpir a alguien**: con `=== null`,
 * una columna ausente devolvería `undefined` como destinatario y la ruta saldría
 * a buscar los aparatos de nadie.
 */
export function aQuienAvisarDeLaRespuesta(
  pregunta: { creado_por: string | null },
  quienContesta: { id: string }
): string | null {
  if (!pregunta.creado_por) return null;
  if (pregunta.creado_por === quienContesta.id) return null;
  return pregunta.creado_por;
}

// ─────────────────────────────────────────────────────────────────────────────
// La bandeja: las preguntas que esperan, de todas las órdenes a la vez
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los tipos de nota que la ruta trae para decidir si una pregunta sigue esperando.
 *
 * El historial entero no se trae: una orden puede tener veinte justificaciones y
 * ninguna abre ni cierra una pregunta —`preguntasAbiertas` mira PREGUNTA (la
 * candidata y el seguimiento que la supera) y RESPUESTA (la que la contesta), y
 * nada más—. Está acá, con nombre, y no escrito en el `.in()` de la ruta, porque
 * es una **afirmación sobre otra función**: si algún día un cuarto tipo cerrara
 * una pregunta, la bandeja se equivocaría en silencio, porque esas filas
 * simplemente no llegarían. Hay un test que comprueba la afirmación pasando la
 * misma bandeja con y sin una justificación entrometida.
 */
export const TIPOS_QUE_DECIDEN_SI_UNA_PREGUNTA_ESPERA = ["PREGUNTA", "RESPUESTA"] as const;

/** Una nota como la lee la bandeja: de cualquier orden, con el nombre de su autor. */
export interface NotaDeLaBandeja extends NotaDeLaOT {
  orden_id: string;
  autor: { nombre: string } | null;
}

/** La orden de la que se pregunta, con lo justo para nombrarla y para decidir. */
export interface OrdenConsultada {
  id: string;
  ot_number: number | null;
  descripcion: string | null;
  /** De él depende que la pregunta siga abierta: una realizada ya no espera nada. */
  estado: string | null;
}

export interface RepuestoConsultado {
  id: string;
  nombre: string;
  codigo: string | null;
}

/** Una pregunta esperando respuesta, lista para mostrarse. */
export interface ConsultaAbierta {
  id: string;
  texto: string;
  creado_en: string;
  /** El nombre de quien preguntó, o `null` si la nota no trae autor. */
  autor: string | null;
  orden: OrdenConsultada;
  repuesto: RepuestoConsultado | null;
}

/** Cuándo se preguntó, usable para ordenar: lo ilegible va primero y no se pierde. */
function cuando(creado_en: string): number {
  const t = new Date(creado_en).getTime();
  return isNaN(t) ? 0 : t;
}

/**
 * Las preguntas que esperan respuesta, de todas las órdenes, de la que más
 * espera a la que menos.
 *
 * ── POR QUÉ ESTO ES UNA FUNCIÓN ──────────────────────────────────────────────
 *
 * Porque es el único lugar del sistema donde las notas de **varias** órdenes se
 * miran juntas, y «abierta» no es una propiedad de una nota: depende de las otras
 * notas de **su** orden y del estado de **esa** orden. `preguntasAbiertas` lo deja
 * escrito —«recibe las notas de UNA orden y el estado de ESA orden»— y las dos
 * formas de equivocarse acá son mudas:
 *
 *  - pasarle todas las notas con un solo estado: la pregunta de una orden
 *    realizada aparece abierta porque otra orden sigue por hacer;
 *  - pasarle las notas de a una: nada la cierra nunca, porque su respuesta y su
 *    seguimiento están en otras filas, y la bandeja se llena de conversaciones
 *    terminadas — que es el anti-objetivo del diseño, un canal que nadie mira.
 *
 * Ninguna de las dos tira un error ni se ve rara en la pantalla.
 *
 * ── LO QUE SE DESCARTA Y LO QUE NO ───────────────────────────────────────────
 *
 * Se recorre por **orden** y no por nota, así que una nota cuya orden no vino en
 * la lectura queda afuera: sin la orden no hay número que mostrar ni estado con
 * el que decidir, y colgarla de otra sería peor. Eso le pone una obligación a
 * quien llama: traer las órdenes de todas las notas que trajo.
 *
 * Un repuesto que no vino, en cambio, **no saca la consulta**: queda sin pieza. No
 * debería pasar —la FK es `on delete set null` y un `repuesto_id` en null cierra
 * la pregunta—, pero esconder una pregunta que espera es peor que mostrarla
 * incompleta.
 *
 * No toca ni ordena lo que recibe.
 */
export function bandejaDeConsultas(
  notas: readonly NotaDeLaBandeja[],
  ordenes: readonly OrdenConsultada[],
  repuestos: readonly RepuestoConsultado[]
): ConsultaAbierta[] {
  const porOrden = new Map<string, NotaDeLaBandeja[]>();
  for (const nota of notas) {
    const suyas = porOrden.get(nota.orden_id);
    if (suyas) suyas.push(nota);
    else porOrden.set(nota.orden_id, [nota]);
  }

  const porRepuesto = new Map(repuestos.map((r) => [r.id, r]));

  const abiertas: ConsultaAbierta[] = [];
  for (const orden of ordenes) {
    // Las notas de ESTA orden y el estado de ESTA orden. Es la línea que importa.
    for (const p of preguntasAbiertas(porOrden.get(orden.id) ?? [], orden.estado)) {
      abiertas.push({
        id: p.id,
        texto: p.texto,
        creado_en: p.creado_en,
        autor: p.autor?.nombre ?? null,
        orden,
        repuesto: (p.repuesto_id && porRepuesto.get(p.repuesto_id)) || null,
      });
    }
  }

  // La más vieja arriba: es la que lleva más tiempo esperando, y la razón por la
  // que esta pantalla existe. Al revés, la que se olvidó queda al final.
  return abiertas.sort((a, b) => cuando(a.creado_en) - cuando(b.creado_en));
}

// ─────────────────────────────────────────────────────────────────────────────
// El push de la respuesta, y lo que ve quien contestó
// ─────────────────────────────────────────────────────────────────────────────

/** Hasta dónde entra la respuesta en el cuerpo del push antes de recortarse. */
const LARGO_DE_LA_RESPUESTA = 80;

/**
 * A dónde lleva el enlace de una OT: al listado, buscada por su número.
 *
 * No hay pantalla de una orden sola; `?q=` es lo que el listado entiende y lo que
 * la ruta resuelve contra `ot_number` cuando lo escrito es un número entero (es el
 * mismo camino que usa «OT #1989» de Mis avisos).
 *
 * Una OT sin número no tiene con qué buscarse, así que va al listado pelado: un
 * `?q=null` deja una lista vacía, que se lee como «esa orden no existe».
 *
 * Está exportada porque la usan **las dos puntas** —el push y el enlace de la
 * bandeja—, y dos copias son dos lugares a los que ir a parar.
 */
export function urlDeLaOrden(ot_number: number | null): string {
  return ot_number === null ? "/mantenimiento/ordenes" : `/mantenimiento/ordenes?q=${ot_number}`;
}

/**
 * El push que recibe quien preguntó cuando Compras contesta.
 *
 * Es un `Aviso` plano —`{title, body, url}`, con la url en el primer nivel—, que
 * es el contrato que `public/sw.js` lee. No va envuelto en ningún `data`: ese
 * nivel de más costó un mes de notificaciones que abrían el inicio.
 *
 * Lleva **la respuesta en el cuerpo**, recortada, y no sólo «te contestaron»: el
 * valor de esto es que quien preguntó se entere de que la pieza llega el jueves
 * sin abrir nada. El texto de una nota llega hasta `MAXIMO_DE_NOTA` (1000), que
 * entero no entra en ninguna notificación.
 *
 * Y nombra la orden y la pieza, porque la misma persona puede estar esperando dos
 * repuestos de dos órdenes. Una OT sin número no es «OT null»: el tipo admite
 * null y una notificación que diga «null» no sirve para encontrar nada.
 *
 * Vive acá y no escrito dentro de la ruta por lo mismo que `NOMBRE_DE_LA_CONSULTA`
 * del lado de Mantenimiento: un texto de push escrito en el emisor no lo compara
 * ningún test, y sale a producción con la tilde que le falte.
 */
export function avisoDeLaRespuesta(
  orden: { ot_number: number | null },
  repuesto: { nombre: string } | null,
  respuesta: string
): Aviso {
  const ot = orden.ot_number === null ? "OT sin número" : `OT ${orden.ot_number}`;
  const pieza = (repuesto?.nombre ?? "").trim();
  const que = pieza ? `${ot} · ${pieza}` : ot;

  const dicho = respuesta.trim();
  const recortada =
    dicho.length > LARGO_DE_LA_RESPUESTA
      ? `${dicho.slice(0, LARGO_DE_LA_RESPUESTA)}…`
      : dicho;

  return {
    title: "Compras respondió tu consulta",
    body: recortada ? `${que}: ${recortada}` : que,
    url: urlDeLaOrden(orden.ot_number),
  };
}

/** Lo que se le dice a quien acaba de contestar, y si el aviso llegó. */
export interface LoQueSeLeDiceAQuienContesta {
  /** Que a quien preguntó le llegó el aviso. La pantalla lo pinta de verde, y si no, de ámbar. */
  llego: boolean;
  texto: string;
}

/**
 * Qué decirle a quien contestó, según lo que contestó `avisarAUnaPersona`.
 *
 * **Que no avisara a nadie no puede quedar callado**, por la misma razón que del
 * lado de Mantenimiento: la respuesta ya está guardada en la orden cuando se llega
 * acá —el aviso nunca la voltea—, pero quien contesta tiene que saber si del otro
 * lado sonó algo. El caso que más importa es el que el diseño deja dicho: fuera de
 * la ventana de 7:00 a 21:00 **no se avisa y no se reintenta nunca**, así que una
 * respuesta de las 22:00 la ve quien preguntó recién al abrir la orden. Si eso no
 * alcanza, lo que corresponde es levantar el teléfono, y para eso hay que saberlo.
 *
 * `null` es «no había a quién avisar»: la pregunta no tenía autor, o la contestó
 * quien la hizo. Se dice que se guardó y nada más. Afirmar que llegó sería mentir.
 *
 * Las palabras de cada `motivo` son las de `avisoAUnaPersona.ts` —«fuera de hora»,
 * «sin aparatos», «cuenta dada de baja»— y **no son las de `avisarAQuienDecide`**,
 * que son otras: por eso esto no puede ser `queDecirDelAviso` de
 * `consultaDeRepuesto.ts`. Nada las compara, así que un test pasa por la función de
 * verdad para los dos que se pueden provocar sin red; si allá cambian, ese test lo
 * dice. Un motivo que no se conoce —el push service caído— se muestra **tal cual**,
 * sin traducir: un diagnóstico vago es peor que uno feo.
 */
export function queDecirDeLaRespuesta(
  aviso: ResultadoDelAviso | null | undefined
): LoQueSeLeDiceAQuienContesta {
  if (!aviso) return { llego: false, texto: "La respuesta quedó guardada en la orden." };

  if (aviso.enviadas > 0) {
    return {
      llego: true,
      texto: "La respuesta quedó guardada en la orden y a quien preguntó ya le llegó el aviso.",
    };
  }

  switch (aviso.motivo) {
    case "fuera de hora":
      return {
        llego: false,
        texto:
          "Se guardó, pero a esta hora no se avisa y después tampoco: quien preguntó la " +
          "va a ver al abrir la orden.",
      };
    case "sin aparatos":
      return {
        llego: false,
        texto:
          "Se guardó, pero el aviso no le llegó: quien preguntó no tiene las " +
          "notificaciones activadas en ningún aparato.",
      };
    case "cuenta dada de baja":
      return {
        llego: false,
        texto: "Se guardó, pero quien preguntó está dado de baja, así que no le llegó el aviso.",
      };
    case undefined:
      // Se intentó y ningún aparato lo recibió: no hay `motivo`, pero tampoco es éxito.
      return { llego: false, texto: "Se guardó, pero el aviso no llegó a ningún aparato." };
    default:
      return { llego: false, texto: `Se guardó, pero no se pudo avisar: ${aviso.motivo}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lo que se está escribiendo en la pantalla
// ─────────────────────────────────────────────────────────────────────────────

/** La respuesta que se está escribiendo para una consulta. */
export interface CajaDeRespuesta {
  texto: string;
  /** Por qué no se pudo enviar, si no se pudo: se dice donde la persona está actuando. */
  error: string;
}

/** Las cajas de la bandeja, por id de consulta. */
export type CajasDeRespuesta = Record<string, CajaDeRespuesta>;

/**
 * Cambia lo que tiene la caja de una consulta **sin tocar las de las demás**.
 *
 * ── POR QUÉ ESTO ES UNA FUNCIÓN Y NO UN `setState` EN LA PANTALLA ────────────
 *
 * La bandeja muestra varias consultas a la vez, cada una con su caja. Una sola
 * caja compartida —o un `{ [id]: … }` sin el spread— tira en silencio lo que se
 * escribió en la otra.
 *
 * No es hipotético: medido en este repo el 31/10/2026, en el modal de repuestos,
 * esa mutación exacta dejaba los 4.464 tests en verde
 * (`lib/mantenimiento/cajasDePregunta.ts`). Perder lo que alguien tipeó no tira
 * ningún error, no se ve en una captura, y la persona se entera cuando ya lo
 * perdió. Esta pantalla tiene la misma forma, así que la decisión sale de ella y
 * se prueba acá.
 *
 * A diferencia de `cambiarCaja`, **crea la caja si no existía**: acá no hay un
 * paso de «abrir», las cajas de la bandeja están siempre a la vista y la primera
 * tecla es la que las estrena.
 *
 * Es una transición, no estado: recibe el registro y devuelve uno nuevo, sin tocar
 * el que le llegó. React compara por identidad, y además eso es lo que la vuelve
 * probable sin un navegador.
 */
export function cambiarRespuesta(
  cajas: CajasDeRespuesta,
  consultaId: string,
  cambios: Partial<CajaDeRespuesta>
): CajasDeRespuesta {
  const caja = cajas[consultaId] ?? { texto: "", error: "" };
  return { ...cajas, [consultaId]: { ...caja, ...cambios } };
}
