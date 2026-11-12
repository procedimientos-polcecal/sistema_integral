/**
 * Cerrar una orden de trabajo con una fecha anterior a la de su inicio, y qué se
 * le pide a quien lo hace.
 *
 * Por qué existe la regla. Una OT con cierre anterior al inicio dice dos cosas
 * que no pueden ser ciertas a la vez, y hasta ahora el sistema las aceptaba
 * calladas: el tiempo de ejecución sale negativo o cero, y los reportes de
 * MTBF y de costo por equipo se calculan sobre esa duración. A veces es un error
 * de tipeo —un día corrido, o la fecha de otra orden— y a veces es verdad: la
 * rotura ocurrió antes, se intervino, y el parte se cargó después con el inicio
 * de la carga y no el del hecho. Desde el sistema no se distingue una cosa de la
 * otra, y por eso no se bloquea: se pide que la persona diga cuál es.
 *
 * Por qué se pide SIEMPRE y sin umbral. Un umbral («tolerar hasta dos días»)
 * habría que justificarlo con la distribución de las diferencias, y la mediana de
 * las que hay está en 2 días: cualquier corte razonable deja pasar sin una
 * palabra justo los casos más comunes, que son también los que más cuesta
 * distinguir de un error. Pedirla siempre es lo único que no pide decidir antes
 * de tener datos. El riesgo asumido, dicho: si lo que se escribe cincuenta veces
 * termina siendo «se hizo antes», la regla se volvió un trámite y lo que hay que
 * revisar entonces es el umbral y no la regla. La defensa de hoy es que el texto
 * pase por `justificacionQueExplica` —el mismo filtro de no-respuestas que usa
 * Compras para denegar—, que rechaza «no», «x» o «prueba» y acepta «Rotura».
 *
 * Las cinco funciones son puras y las llaman las tres pantallas y las dos rutas:
 * que el formulario y el servidor vean exactamente lo mismo es el punto de
 * tenerlas en un solo archivo.
 */
import { justificacionQueExplica } from "@/lib/core/justificacion";

/** Cómo se llama lo que falta, tal como lo lee quien está cargando. */
const LO_QUE_FALTA = "por qué se cerró antes de la fecha de inicio";

/** Lo que se antepone en la celda de observaciones de la planilla. */
const PREFIJO_EN_LA_PLANILLA = "Cerrada antes del inicio: ";

/**
 * Sólo el día. Las dos son columnas `date` y llegan como «AAAA-MM-DD», pero si
 * una viniera con hora, comparar textos de distinto largo da un resultado y no
 * un error: «2026-11-06» queda menor que «2026-11-06T00:00:00Z» y el mismo día
 * pasaría por distinto. Son fechas ISO, así que como texto quedan en orden; es
 * como ya desempata dos cierres `cuaderno/generar/route.ts`.
 */
const dia = (f: string | null | undefined): string => (f ?? "").slice(0, 10);

/** Si el cierre cae antes del inicio. Sin alguna de las dos no hay qué comparar. */
export function elCierreEsAnteriorAlInicio(
  cierre: string | null | undefined,
  inicio: string | null | undefined,
): boolean {
  const c = dia(cierre);
  const i = dia(inicio);
  if (!c || !i) return false;
  return c < i;
}

/**
 * Si la fecha de cierre que llega es otra que la guardada.
 *
 * Existe porque `RegistrarOTModal` manda la fecha en todos los guardados: con
 * «vino la clave» como criterio, quien sólo corrige las horas de una orden ya
 * cerrada antes de su inicio tendría que justificarla de nuevo cada vez.
 */
export function elCierreCambio(
  nuevo: string | null | undefined,
  guardado: string | null | undefined,
): boolean {
  return dia(nuevo) !== dia(guardado);
}

export interface DatosDelCierreAdelantado {
  fecha_cierre: string | null | undefined;
  fecha_ejecucion: string | null | undefined;
  cierre_justificacion: string | null | undefined;
}

/**
 * Lo que falta para poder guardar, en la forma de las otras listas de faltantes
 * de Mantenimiento: vacía si está todo.
 *
 * La clave ausente cuenta como faltante: una carga sin señal encolada antes de
 * que el campo existiera no la trae, y dejarla pasar sería la vía por la que la
 * regla se esquiva sin querer.
 */
export function loQueFaltaPorElCierreAdelantado(datos: DatosDelCierreAdelantado): string[] {
  if (!elCierreEsAnteriorAlInicio(datos.fecha_cierre, datos.fecha_ejecucion)) return [];
  return justificacionQueExplica(datos.cierre_justificacion) ? [] : [LO_QUE_FALTA];
}

/**
 * La justificación que queda en la base: el texto recortado si el cierre sigue
 * siendo anterior al inicio, y null si no.
 *
 * Dejarla llena cuando las fechas dejaron de contradecirse haría que la ficha y
 * la planilla sigan diciendo «Cerrada antes del inicio» de una orden que ya no
 * lo está.
 *
 * Aquí NO se pregunta si el texto explica: eso lo contesta
 * `loQueFaltaPorElCierreAdelantado` antes de llegar. Separarlo deja que el día
 * que se levante la exigencia —un umbral, por ejemplo— lo ya guardado no cambie
 * de sentido.
 */
export function laJustificacionQueSeGuarda(
  cierre: string | null | undefined,
  inicio: string | null | undefined,
  texto: unknown,
): string | null {
  if (!elCierreEsAnteriorAlInicio(cierre, inicio)) return null;
  const t = typeof texto === "string" ? texto.trim() : "";
  return t === "" ? null : t;
}

/**
 * Lo que se escribe en la celda de observaciones: la justificación primero, con
 * un prefijo fijo para reconocerla de un vistazo, y las observaciones después.
 *
 * Devuelve vacío cuando no hay nada, y eso es a propósito: vacío vacía la celda,
 * que es «sacá lo que había», y no «no la toques».
 */
export function observacionDelCierreAdelantado(
  justificacion: string | null | undefined,
  observaciones: string | null | undefined,
): string {
  const j = (justificacion ?? "").trim();
  const o = (observaciones ?? "").trim();
  const partes: string[] = [];
  if (j) partes.push(PREFIJO_EN_LA_PLANILLA + j);
  if (o) partes.push(o);
  return partes.join("\n");
}

/**
 * Si la justificación viaja a la planilla en este pedido, y con qué valor.
 *
 * `undefined` es «no la toques». Si viajara siempre, un PATCH que sólo cambia el
 * estado reescribiría la celda con la justificación sola y se llevaría las
 * observaciones, que no tienen columna propia desde la cual rearmarse. Viaja
 * cuando el pedido toca las observaciones o la justificación; y `null` es «se
 * borró», para que la celda deje de decirlo.
 */
export function justificacionParaLaPlanilla(
  tocaLasObservaciones: boolean,
  tocaLaJustificacion: boolean,
  guardada: string | null,
): string | null | undefined {
  if (!tocaLasObservaciones && !tocaLaJustificacion) return undefined;
  return guardada;
}
