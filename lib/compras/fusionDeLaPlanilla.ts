import type { EstadoAprobacion, EstadoCompra, Prioridad } from "./types";

/**
 * Qué se guarda cuando la planilla vuelve a traer un requerimiento que ya
 * existe.
 *
 * La regla es una sola: **lo que la planilla no dice no se pisa.** Una celda
 * vacía casi nunca significa "vacialo"; significa que ese dato no vive ahí. El
 * valor por defecto queda sólo para un RI que no existía.
 *
 * Estaba repetida en cinco columnas del `upsert` de `importarDesdeSheets`, con
 * un `??` en cada una, y cuatro se habían quedado afuera:
 *
 *   * `origen` — un pedido cargado en el sistema pasaba a decir que entró por
 *     la planilla en la primera sincronización que releyera su fila. Es
 *     justamente lo que mide el indicador de `/compras/configuracion` para
 *     decidir cuándo apagar el formulario.
 *   * `prioridad` y quién paga (`empresa_id` y `paga_ambas`) — las elige quien
 *     pide, en el alta, y en la planilla son columnas a mano que recién se
 *     llenan al aprobar.
 *
 * Por qué cada una de las otras cinco se conserva está documentado junto al
 * campo que corresponde, más abajo.
 *
 * Vive acá y no dentro de `sheets.ts` para poder probarla: es una decisión, no
 * una llamada a Google.
 */

/** Lo que la planilla dice de un requerimiento. `null` es "no dice nada". */
export interface DeLaPlanilla {
  prioridad: Prioridad | null;
  estado_aprobacion: EstadoAprobacion | null;
  estado_compra: EstadoCompra | null;
  solicitante_nombre: string | null;
  compra_asignada_a: string | null;
  comparativa_drive_id: string | null;
  /**
   * Quién paga. `null` cuando la celda vino **vacía** o cuando nombró una
   * empresa que el catálogo no tiene: las dos son "la planilla no dijo nada
   * que se pueda usar", no una decisión. Antes `pagaDe("")` devolvía el mismo
   * objeto que una decisión real (`{empresa: null, ambas: false}`), y con eso
   * vacío y decisión se confundían.
   */
  paga: { empresa_id: string | null; ambas: boolean } | null;
}

/** Lo que el sistema ya sabía del requerimiento. */
export interface LoQueYaHabia {
  prioridad: Prioridad | null;
  estado_aprobacion: EstadoAprobacion;
  estado_compra: EstadoCompra;
  solicitante_nombre: string | null;
  compra_asignada_a: string | null;
  comparativa_drive_id: string | null;
  empresa_id: string | null;
  paga_ambas: boolean;
  origen: string;
}

/**
 * Lo que queda para escribir es exactamente lo que el sistema ya sabía: la
 * fusión no agrega ni saca columnas, sólo decide, campo por campo, si gana la
 * planilla o lo que había.
 */
export type Fusionado = LoQueYaHabia;

export function fusionarConLoQueYaHabia(
  dePlanilla: DeLaPlanilla,
  previo: LoQueYaHabia | undefined
): Fusionado {
  return {
    prioridad: dePlanilla.prioridad ?? previo?.prioridad ?? null,
    // Que la planilla no diga nada no significa "sin aprobar" ni "sin
    // iniciar": significa que no se pudo leer. Pisar con el valor por defecto
    // revertía compras ya hechas —15 pasaron de PEDIDO a SIN_INICIAR en una
    // sola corrida—, así que se conserva lo que había y el default queda sólo
    // para un RI que no existía.
    estado_aprobacion: dePlanilla.estado_aprobacion ?? previo?.estado_aprobacion ?? "PENDIENTE",
    estado_compra: dePlanilla.estado_compra ?? previo?.estado_compra ?? "SIN_INICIAR",
    // Sin esto, un RI cargado en la app —que sí sabe quién lo pidió— perdía
    // el nombre en la primera sincronización que releyera su fila, y su autor
    // dejaba de verlo entre los suyos. `solicitante_id` no viaja en este
    // upsert, así que ese no se toca.
    solicitante_nombre: dePlanilla.solicitante_nombre ?? previo?.solicitante_nombre ?? null,
    // Sin esto, un RI que la planilla marca "PARA COMPRAR (NICO)" llegaba a
    // la app sin asignar, y como aprobar la compra es de quien la tiene
    // asignada, no lo podía aprobar nadie. Si el alias no está registrado en
    // /compras/configuracion no se puede resolver, y ahí se conserva lo que
    // hubiera: no saber quién es no es razón para dejar la compra sin nadie
    // que pueda aprobarla.
    compra_asignada_a: dePlanilla.compra_asignada_a ?? previo?.compra_asignada_a ?? null,
    // Se conserva la planilla enlazada si esta vez no se pudo leer el link de
    // la celda: perder el vínculo por una falla de Google dejaría la
    // comparativa sin manera de volver a encontrarla. `comparativa_url` no
    // viaja en este upsert a propósito —se exporta a la celda de la planilla—,
    // así que ésa no se toca.
    comparativa_drive_id: dePlanilla.comparativa_drive_id ?? previo?.comparativa_drive_id ?? null,
    // Los dos salen de la misma celda, así que se deciden juntos: o manda la
    // planilla o manda lo que había.
    empresa_id: dePlanilla.paga ? dePlanilla.paga.empresa_id : (previo?.empresa_id ?? null),
    paga_ambas: dePlanilla.paga ? dePlanilla.paga.ambas : (previo?.paga_ambas ?? false),
    // Haber entrado por el sistema no se deshace por aparecer después en la
    // planilla: aparecer allá es justamente lo que se quiere que pase.
    origen: previo?.origen === "app" ? "app" : "sheets",
  };
}
