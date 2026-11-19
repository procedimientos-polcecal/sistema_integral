/**
 * Qué fechas corrió la planilla, de lo que la sincronización está por pisar.
 *
 * Los totales de abajo (2.467 de 2.531) difieren de los de CLAUDE.md (2.471 de
 * 2.532) en el mismo día: la conciliación está en la sección «La reprogramación
 * de una OT y el Análisis» de docs/MANTENIMIENTO-INTEGRACION.md.
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 *
 * En Mantenimiento manda la planilla, y —medido el 19/11/2026— sólo 264 de las
 * 2.532 órdenes son `app_created`, o sea las que tienen el botón de Postergar.
 * A las otras 2.268 la fecha de inicio se les corre
 * tipeándola en el master, y hasta hoy eso **se notaba y se tiraba**: el
 * contraste compara los dos lados antes del upsert —es el único momento en que
 * todavía dicen cosas distintas— y después `mantenimiento_divergencias` se
 * rehace entera, a propósito, porque su tamaño es lo que cuenta el aviso. Un
 * análisis de reprogramaciones que ve el 10 % del universo no es el análisis.
 *
 * Esto no detecta nada nuevo: guarda lo que ya se detectaba.
 *
 * ── TRES COSAS QUE NO SE DEDUCEN DEL CÓDIGO ────────────────────────────────
 *
 * 1. **Las órdenes cerradas quedan afuera, y es la decisión cara.** Medido el
 *    19/11/2026: **2.467 de 2.531 están `REALIZADO`**, o sea el 97,5 %, y
 *    quedan 64 abiertas. Con esa proporción, la edición más probable de la
 *    columna de fecha de inicio no es correr un trabajo futuro sino
 *    **corregirle la carga a algo que ya se hizo**, y desde este lado las dos
 *    llegan iguales: una fecha distinta. Dejarlas entrar llenaría la pestaña
 *    de Reprogramaciones —que existe para contestar *por qué se corrió este
 *    trabajo*— de arreglos retroactivos, hasta que nadie la mire. El freno de
 *    abajo no sirve para eso, porque eso no llega de a cuatrocientas sino de a
 *    una. Lo que se pierde, dicho: **la OT que se postergó desde la planilla y
 *    después cerró**, si el movimiento y el cierre caen entre dos corridas. No
 *    queda registrado en ninguna parte, y se asume a cambio de que la pestaña
 *    diga la verdad. Las postergadas desde el botón no están afectadas: su fila
 *    se escribe en el momento, con la orden todavía abierta.
 *
 *    **Se mira `estado` y nunca `fecha_cierre is null`**, que
 *    `lib/mantenimiento/trabajoDelAviso.ts` documenta como poco de fiar.
 *
 * 2. **El duplicado se evita contra LA ÚLTIMA FILA, no con un índice único.**
 *    La clave natural sería `(ot_id, fecha_anterior, fecha_nueva)` y esa
 *    combinación **se repite de verdad**: una OT que se mueve del 6/11 al 13/11
 *    en marzo y otra vez en septiembre son dos reprogramaciones, no una. Contra
 *    la última fila ese problema no existe, porque para volver al 6/11 hubo que
 *    escribir antes una fila que lo dice. Hace falta porque hay tres caminos
 *    por los que la misma transición se detecta de nuevo —dos corridas que se
 *    pisan, un upsert que falla después de haber escrito el historial, y el
 *    botón «Traer de la planilla» apretado encima del cron— y porque, a
 *    diferencia de `mantenimiento_divergencias`, acá **nada borra**: un
 *    duplicado infla el contador para siempre y en silencio.
 *
 * 3. **Lo que esto NO cierra: dos corridas simultáneas** que lean el mismo
 *    estado antes de que ninguna escriba. La ventana se angosta mucho y no se
 *    cierra, y no es acá donde se arregla: CLAUDE.md deja anotado que **no hay
 *    ningún candado contra dos corridas simultáneas en todo el sistema** —ni
 *    `pg_advisory_lock` ni `for update skip locked`, verificado el
 *    05/11/2026— y que el segundo despliegue que escribe en esta base se
 *    resuelve apagándolo, no acá.
 *
 * Es puro: lo que habla con la base es `sincronizar.ts`. Y `reprogramada_veces`
 * no se escribe nunca desde acá — lo mantiene un trigger.
 */

import type { OrdenDelSistema } from "@/lib/mantenimiento/contraste";
import type { OrdenLeida } from "@/lib/mantenimiento/ordenes";

/**
 * Los estados en los que una fecha que cambió en la planilla NO se registra.
 *
 * Es la **tercera** copia de estos dos valores en el módulo y es a propósito:
 * ya hay dos —`CERRADAS` en `alertas.ts`, que decide qué orden está atrasada, y
 * `CERRADAS_GUT` en `gut.ts`, que espeja la columna generada `gut_orden`—,
 * separadas porque responden preguntas distintas y porque un estado nuevo se
 * decide en cada una. Lo que no puede pasar es que se separen **sin que nadie
 * se entere**, y para eso está el test que las ata.
 *
 * Y ya sirvió: el plan de esta tarea pedía `["REALIZADO", "SUSPENDIDA"]`, que
 * era cierto cuando se escribió y dejó de serlo el **16/11/2026**, cuando
 * `SUSPENDIDA` salió del vocabulario de OT y la reemplazó `CANCELADA`
 * (`esEstadoDeOT("SUSPENDIDA")` ya devuelve `false`). Escribirlo como decía el
 * plan habría dejado entrar a toda OT cancelada desde la planilla y, peor, no
 * habría frenado nada: no hay órdenes en un estado que no existe.
 */
export const CERRADAS_PARA_REPROGRAMAR: readonly string[] = ["REALIZADO", "CANCELADA"];

/**
 * Cuántas filas `planilla` como máximo escribe una corrida. Pasado el tope no
 * se escribe **ninguna** y se dice por qué.
 *
 * Nace de la misma defensa que `borradoDeEspejo` y que la fórmula del estado, y
 * existe por lo mismo: una planilla recalculando devuelve `Cargando…` en unas
 * celdas y vacías las demás, y una columna corrida un lugar —lo del 21/10/2026—
 * hace que todas las fechas lleguen distintas a la vez. Las dos cosas son
 * indistinguibles desde acá de un cambio de fechas masivo de verdad.
 *
 * ── PERO NO SE PARECE A `borradoDeEspejo` EN LO QUE MÁS IMPORTA ─────────────
 *
 * **Acá frenar PIERDE los movimientos, no los posterga**, y la comparación de
 * arriba es justamente lo que hace que parezca lo contrario. Allá el freno
 * corta antes de tocar nada: los datos quedan enteros y confirmar después sigue
 * borrando lo mismo. Acá el freno corre **antes del upsert**, y el upsert de
 * esta misma corrida escribe `fecha_ejecucion` igual —`paraLaBase(orden)` la
 * incluye, y tiene que incluirla porque la planilla manda—. O sea que, para
 * cuando alguien lee la respuesta, `ordenes_trabajo` ya guarda la fecha nueva:
 * repetir la llamada con la confirmación encuentra `anterior === nueva` y
 * escribe **cero** filas.
 *
 * Eso es deliberado y no se arregla acá. No importar esas fechas contradiría
 * «la planilla manda» y podría congelar una fecha indefinidamente; guardar lo
 * descartado en algún lado es otra cosa, más grande. El freno existe para la
 * corrida en que la planilla devuelve basura, y ahí perder esas filas **es el
 * resultado correcto**.
 *
 * Lo que no se puede hacer es prometer una salida que no existe: por eso el
 * mensaje dice que no vuelven. La confirmación sirve **antes**, no después —
 * sólo si se la manda en la llamada que detecta el movimiento—.
 *
 * **Diez, y no doscientos como `TOPE_DE_DIVERGENCIAS`.** Ese otro recorta y
 * guarda el resto; éste tira todo, así que tiene que poder dispararse. Hoy
 * quedan **64 órdenes abiertas** en toda la base (19/11/2026), que es el
 * universo entero de candidatas de una corrida: cualquier número de 64 para
 * arriba sería decorativo —no puede alcanzarse nunca— y dejaría el freno
 * apagado sin que se note. Diez es varias veces lo que puede mover una persona
 * en un día y sigue muy por debajo de ese techo.
 *
 * El costo de frenar de más, dicho entero: **las fechas** no se pierden —la
 * planilla manda y el upsert las importa igual—, pero **los renglones de
 * historial de esa corrida sí**, para siempre, por lo de arriba. La corrida lo
 * dice en su resumen, y el mensaje no promete que se recuperen.
 */
export const TOPE_DE_FILAS_POR_CORRIDA = 10;

/**
 * Lo único que se mira de una orden del sistema, y por eso se nombra con un
 * `Pick` y no con `OrdenDelSistema` entera: quien llama puede traer de la base
 * estas cinco columnas y nada más, y el tipo lo dice en vez de obligar a leer
 * quince para contestar una pregunta sobre cinco. Una `OrdenDelSistema`
 * completa sigue entrando.
 */
export type OrdenParaReprogramar = Pick<
  OrdenDelSistema,
  "ot_number" | "estado" | "fecha_ejecucion" | "sheets_pendiente" | "fecha_ejecucion_pendiente"
>;

/** Y de la planilla, sólo el número y la fecha de inicio. */
export type FilaParaReprogramar = Pick<OrdenLeida, "ot_number" | "fecha_ejecucion">;

/** Una fila por escribir, todavía por número de OT: el `ot_id` lo pone quien inserta. */
export interface FilaDeReprogramacionDeLaPlanilla {
  ot_number: number;
  /**
   * Hoy nunca es null desde este lado —una OT sin fecha que recibe una no se
   * registra, ver abajo—, y el tipo lo admite porque la columna lo admite: las
   * filas de origen `sistema` sí pueden traerlo vacío.
   */
  fecha_anterior: string | null;
  fecha_nueva: string;
}

/** Una fila del historial, de lo poco que hace falta para saber cuál es la última. */
export interface FilaDeHistorial {
  ot_id: string;
  fecha_nueva: string;
}

/**
 * El `fecha_nueva` de la ÚLTIMA fila de historial de cada OT, por número de OT.
 *
 * Es lo único contra lo que se compara para no escribir dos veces la misma
 * transición, así que **es la defensa contra el peor caso de este módulo**: un
 * duplicado infla `reprogramada_veces` para siempre y en silencio, porque acá
 * nada borra. Vive en el módulo puro y no en quien llama justamente por eso —
 * «cuál es la última» es una decisión, y si se rompe no se nota.
 *
 * **Las filas llegan YA ORDENADAS** por `(ot_id, creado_en, id)` ascendente y
 * acá no se reordenan, igual que en `reprogramaciones.ts`: reordenar escondería
 * un error de quien consulta, y `creado_en` solo no desempata. Lo que hace esta
 * función es quedarse con la última de cada OT **en el orden en que vienen**,
 * que es lo que la vuelve probable: pasarle las dos filas al revés tiene que
 * dar el otro resultado, y eso es un test y no una promesa.
 *
 * `idDe` va de número de OT a `ot_id`, que es la forma en que la sincronización
 * ya tiene el dato. Una fila de historial de una OT que no esté ahí —borrada
 * entre las dos lecturas— se ignora: no hay con qué nombrarla.
 */
export function laUltimaPorOt(
  historial: readonly FilaDeHistorial[],
  idDe: ReadonlyMap<number, string>,
): Map<number, string> {
  const numeroDe = new Map<string, number>();
  for (const [numero, id] of idDe) numeroDe.set(id, numero);

  const ultima = new Map<number, string>();
  for (const h of historial) {
    const numero = numeroDe.get(h.ot_id);
    if (numero === undefined) continue;
    // La última gana: se pisa a propósito, porque vienen en orden.
    ultima.set(numero, String(h.fecha_nueva));
  }
  return ultima;
}

/** Vacío y nulo son lo mismo, igual que en `contraste.ts`. */
function texto(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

/**
 * Qué filas de historial deja esta corrida, mirando los dos lados antes de que
 * el upsert los iguale.
 *
 * `ultimaPorOt` es, por número de OT, el `fecha_nueva` de su **última** fila de
 * historial; una OT que no esté en el mapa es una que nunca se movió.
 *
 * Las tres excusas normales del contraste quedan afuera acá también, y por lo
 * mismo: la cola de `sheets_pendiente` es el sistema sabiendo algo que la
 * planilla todavía no, `fecha_ejecucion_pendiente` es la ventana del derrame
 * del master (de 3 a 53 horas, medido el 21/10/2026) y vacío contra nulo es lo
 * mismo. Ninguna de las tres es una fecha que alguien corrió.
 *
 * `sinFreno` levanta **sólo** el tope de abajo, y es una llave distinta de la
 * que levanta el borrado masivo: si la compartieran, quien confirma un borrado
 * estaría aceptando además, sin verlo, cuatrocientas reprogramaciones
 * inventadas por una planilla que estaba recalculando. Una confirmación
 * autoriza una cosa, y el cron no pasa ninguna de las dos.
 */
export function lasQueHayQueRegistrar(
  delSistema: readonly OrdenParaReprogramar[],
  deLaPlanilla: readonly FilaParaReprogramar[],
  ultimaPorOt: ReadonlyMap<number, string>,
  opciones: { sinFreno?: boolean } = {},
): { filas: FilaDeReprogramacionDeLaPlanilla[]; freno: string | null } {
  const enLaPlanilla = new Map<number, FilaParaReprogramar>();
  for (const p of deLaPlanilla) enLaPlanilla.set(p.ot_number, p);

  const filas: FilaDeReprogramacionDeLaPlanilla[] = [];

  for (const s of delSistema) {
    const p = enLaPlanilla.get(s.ot_number);
    // Sólo en el sistema: no hay dos lados que comparar. Que falte de la
    // planilla es otro problema, y el contraste ya lo informa.
    if (!p) continue;

    // La cola y la ventana del derrame: diferir ahí es lo normal.
    if (texto(s.sheets_pendiente) !== "") continue;
    if (texto(s.fecha_ejecucion_pendiente) !== "") continue;

    // Una orden ya cerrada no se reprograma: se le corrige la carga.
    if (CERRADAS_PARA_REPROGRAMAR.includes(texto(s.estado))) continue;

    const anterior = texto(s.fecha_ejecucion);
    const nueva = texto(p.fecha_ejecucion);

    if (anterior === nueva) continue;

    // La planilla vació la fecha. No es una reprogramación porque no hay «a
    // qué fecha», y `fecha_nueva` es `not null`: no habría qué escribir. La
    // orden además sale sola de «necesitan reprogramarse», que mira
    // `fecha_ejecucion < hoy`.
    if (nueva === "") continue;

    // El sistema no tenía fecha y la planilla trae una. Tampoco es correr algo:
    // es la primera fecha que la orden tiene. Registrarla pondría una
    // reprogramación en la cadena de toda OT que recién se planifica, que es el
    // ruido que hace que nadie mire la pestaña.
    if (anterior === "") continue;

    // Esta misma transición ya quedó escrita. Volver a escribirla infla el
    // contador para siempre y en silencio, porque acá nada borra.
    if (ultimaPorOt.get(s.ot_number) === nueva) continue;

    filas.push({ ot_number: s.ot_number, fecha_anterior: anterior, fecha_nueva: nueva });
  }

  // El levantamiento vive acá y no en quien llama porque es la decisión de
  // escribir o no, y las decisiones se prueban: si el filtro devolviera las
  // filas vacías y quien llama "levantara" el freno, no tendría qué escribir.
  if (!opciones.sinFreno && filas.length > TOPE_DE_FILAS_POR_CORRIDA) {
    return {
      filas: [],
      // No promete una salida que no existe: ver el encabezado de
      // `TOPE_DE_FILAS_POR_CORRIDA`. El upsert de esta misma corrida ya guardó
      // las fechas, así que repetir la llamada no encuentra nada que registrar.
      freno: `La planilla movió la fecha de ${filas.length} órdenes de una vez y el tope es `
        + `${TOPE_DE_FILAS_POR_CORRIDA}: no se registró ninguna reprogramación. `
        + `Las fechas se importaron igual, pero esos movimientos NO quedaron en el `
        + `historial y repetir la sincronización no los recupera. Si el cambio era de `
        + `verdad, hay que volver a mover las fechas para que se registren.`,
    };
  }

  return { filas, freno: null };
}
