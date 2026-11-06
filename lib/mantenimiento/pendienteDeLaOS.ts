/**
 * Qué hay que anotar cuando el seguimiento de una OS no llega a la planilla.
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 *
 * Es el mismo agujero que el PATCH de OT tuvo hasta el 26/10/2026 y que costó
 * las órdenes 2896 a 2898 y la 2908, repetido en órdenes de servicio. El PATCH
 * de `ordenes-servicio` guardaba el seguimiento —estado, proveedor, las dos
 * fechas, observaciones—, intentaba escribir la planilla y, si fallaba,
 * devolvía el motivo a la pantalla y **nada más**.
 *
 * Y acá pisa igual, porque `filaDeOS` **vuelve a leer las cinco columnas**:
 *
 *     proveedor_elegido, estado, fecha_pedido, fecha_realizacion, observaciones
 *
 * O sea que la próxima corrida de `sincronizarOrdenesDeServicio` lee la celda
 * vieja —o vacía— y la sube encima de lo que se acababa de guardar. Para quien
 * carga es «se perdió otra vez lo que puse», sin ningún error de por medio.
 *
 * Medido el 26/10/2026 contra producción: **192 de 266 OS tienen seguimiento
 * cargado**, así que no es un camino de borde.
 *
 * ── LA REGLA, Y POR QUÉ NO SE ANOTA SIEMPRE ─────────────────────────────────
 *
 * Igual que en las OT, la cola **no guarda el cambio: lo vuelve a armar desde
 * la fila** con `loQueHayQueExportarDeLaOS`. Anotar un fallo que esa función no
 * sabe reproducir es peor que no anotarlo: el drenaje lo encuentra, ve que no
 * hay nada que exportar, limpia la marca y sigue. Quedaría un registro de que
 * algo falló que se borra solo, y mientras tanto la orden estuvo protegida de
 * la importación por una razón que ya no existe.
 *
 * El caso concreto es un PATCH que sólo cambió `motivo_rechazo`: no va a la
 * planilla a propósito —la única columna de texto libre que la app escribe allá
 * es OBSERVACIONES, que tiene notas cargadas que no son motivos—, así que no
 * hay nada que reintentar.
 *
 * ── Y POR QUÉ NO LIMPIA CUANDO SALE ─────────────────────────────────────────
 *
 * Porque el PATCH escribe **sólo los campos que cambió**, y un pendiente
 * anterior puede ser por otros. Limpiarlo con una escritura parcial diría que
 * ya está todo exportado cuando no se sabe. Se lo deja para el drenaje, que sí
 * escribe el seguimiento completo; mientras tanto la orden queda protegida de
 * más, que es el lado barato de equivocarse.
 */

import { dondeSeEscribeElEstado, seguroParaElMaestro } from "./denegacion";

/** Lo que la planilla puede estar sin saber de una OS ya guardada. */
export interface LoQueLaPlanillaDeOSNoSabe {
  sheets_tab: string | null | undefined;
  estado: string | null | undefined;
  proveedor_elegido: string | null | undefined;
  fecha_pedido: string | null | undefined;
  fecha_realizacion: string | null | undefined;
  observaciones: string | null | undefined;
}

/** Un campo listo para `escribirEnLaFilaDeLaOS`. */
export interface CampoDeOS {
  clave: string;
  valor: string;
}

const cargado = (v: string | null | undefined): boolean => String(v ?? "").trim() !== "";

/**
 * Una fecha ISO como la escribe la planilla. Misma cuenta que el PATCH: el
 * mediodía evita que la zona horaria corra el día hacia atrás.
 */
export const fechaDeOSParaLaPlanilla = (iso: string | null | undefined): string =>
  iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("es-AR") : "";

/**
 * Qué hay que reescribirle a la planilla de una OS, o `null` si no hay nada.
 *
 * **Lo que está vacío no viaja.** Es la misma regla que `loQueHayQueExportar`
 * de las OT y por el mismo motivo: vaciar una celda que nadie llenó es escribir
 * de más en una planilla que mira gente, y acá sería peor que allá — una OS
 * tiene el seguimiento cargado a mano por Mantenimiento desde antes de que
 * existiera el SdG.
 *
 * **`APROBADO` nunca sale de la cola hacia el maestro**, y ésta es la parte que
 * no se deduce. Aprobar es el único estado que mete la fila en la pestaña de su
 * área, y meterla corre las de abajo dejando el seguimiento escrito a mano
 * colgado de otra orden. Por eso el PATCH lo trata aparte: lee la pestaña del
 * área, comprueba que no correría filas y **escribe antes de guardar**, con un
 * 502 si no puede. Un drenaje no puede hacer esa comprobación —corre sin nadie
 * mirando y sin el número máximo de la pestaña a mano—, así que si dejara pasar
 * un `APROBADO` para una OS que todavía vive en SERVICIOS, `escribirEnLaFilaDeLaOS`
 * se lo descartaría y devolvería «esta OS todavía no está aprobada»: **un
 * pendiente que no se puede resolver nunca**, rotando en la cola para siempre.
 * Se lo saca acá, donde se puede explicar, y no allá, donde sólo se vería como
 * un error raro.
 *
 * En la pestaña de un área, en cambio, `APROBADO` es seguimiento como cualquier
 * otro estado: esa fila ya está adentro y escribirlo no mueve nada.
 */
export function loQueHayQueExportarDeLaOS(
  os: LoQueLaPlanillaDeOSNoSabe
): CampoDeOS[] | null {
  const campos: CampoDeOS[] = [];

  if (cargado(os.estado)) {
    const alMaestro = dondeSeEscribeElEstado(os.sheets_tab) === "maestro";
    if (!alMaestro || seguroParaElMaestro(os.estado, true)) {
      campos.push({ clave: "estado", valor: String(os.estado).trim() });
    }
  }

  if (cargado(os.proveedor_elegido)) {
    campos.push({ clave: "proveedor_elegido", valor: String(os.proveedor_elegido).trim() });
  }
  if (cargado(os.fecha_pedido)) {
    campos.push({ clave: "fecha_pedido", valor: fechaDeOSParaLaPlanilla(os.fecha_pedido) });
  }
  if (cargado(os.fecha_realizacion)) {
    campos.push({
      clave: "fecha_realizacion",
      valor: fechaDeOSParaLaPlanilla(os.fecha_realizacion),
    });
  }
  if (cargado(os.observaciones)) {
    campos.push({ clave: "observaciones", valor: String(os.observaciones).trim() });
  }

  // Y si no hay nada, `null` en vez de una lista vacía: una cola con filas que
  // no tienen nada que hacer deja de decir si algo está trabado.
  return campos.length > 0 ? campos : null;
}

/**
 * El motivo para `sheets_pendiente`, o `null` si no hay nada que encolar.
 *
 * `null` significa dos cosas distintas y las dos terminan igual: salió bien, o
 * falló algo que la cola no puede rehacer. En los dos casos no se escribe.
 *
 * @param os     La fila **como quedó después del cambio**, no como estaba.
 * @param error  Lo que devolvió la escritura: `null` si salió.
 */
export function elPendienteDelIntentoDeOS(
  os: LoQueLaPlanillaDeOSNoSabe,
  error: string | null
): string | null {
  if (error === null) return null;
  return loQueHayQueExportarDeLaOS(os) ? error : null;
}
