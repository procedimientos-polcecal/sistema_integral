/**
 * Qué se guarda cuando la planilla vuelve a traer un requerimiento que ya
 * existe.
 *
 * La regla es una sola: **lo que la planilla no dice no se pisa.** Una celda
 * vacía casi nunca significa "vacialo"; significa que ese dato no vive ahí. El
 * valor por defecto queda sólo para un RI que no existía.
 *
 * Estaba repetida en ocho columnas del `upsert` de `importarDesdeSheets`, con
 * un `??` en cada una, y tres se habían quedado afuera:
 *
 *   * `origen` — un pedido cargado en el sistema pasaba a decir que entró por
 *     la planilla en la primera sincronización que releyera su fila. Es
 *     justamente lo que mide el indicador de `/compras/configuracion` para
 *     decidir cuándo apagar el formulario.
 *   * `prioridad` y quién paga — las elige quien pide, en el alta, y en la
 *     planilla son columnas a mano que recién se llenan al aprobar.
 *
 * Vive acá y no dentro de `sheets.ts` para poder probarla: es una decisión, no
 * una llamada a Google.
 */

/** Lo que la planilla dice de un requerimiento. `null` es "no dice nada". */
export interface DeLaPlanilla {
  prioridad: string | null;
  estado_aprobacion: string | null;
  estado_compra: string | null;
  solicitante_nombre: string | null;
  compra_asignada_a: string | null;
  comparativa_drive_id: string | null;
  /**
   * Quién paga. `null` cuando la celda vino **vacía**, que no es lo mismo que
   * "ninguna de las dos": `pagaDe("")` devuelve `{empresa: null, ambas: false}`
   * y con eso vacío y decisión se confundían.
   */
  paga: { empresa_id: string | null; ambas: boolean } | null;
}

/** Lo que el sistema ya sabía del requerimiento. */
export interface LoQueYaHabia {
  prioridad: string | null;
  estado_aprobacion: string;
  estado_compra: string;
  solicitante_nombre: string | null;
  compra_asignada_a: string | null;
  comparativa_drive_id: string | null;
  empresa_id: string | null;
  paga_ambas: boolean;
  origen: string;
}

export interface Fusionado {
  prioridad: string | null;
  estado_aprobacion: string;
  estado_compra: string;
  solicitante_nombre: string | null;
  compra_asignada_a: string | null;
  comparativa_drive_id: string | null;
  empresa_id: string | null;
  paga_ambas: boolean;
  origen: string;
}

export function fusionarConLoQueYaHabia(
  de: DeLaPlanilla,
  previo: LoQueYaHabia | undefined
): Fusionado {
  return {
    prioridad: de.prioridad ?? previo?.prioridad ?? null,
    estado_aprobacion: de.estado_aprobacion ?? previo?.estado_aprobacion ?? "PENDIENTE",
    estado_compra: de.estado_compra ?? previo?.estado_compra ?? "SIN_INICIAR",
    solicitante_nombre: de.solicitante_nombre ?? previo?.solicitante_nombre ?? null,
    compra_asignada_a: de.compra_asignada_a ?? previo?.compra_asignada_a ?? null,
    comparativa_drive_id: de.comparativa_drive_id ?? previo?.comparativa_drive_id ?? null,
    // Los dos salen de la misma celda, así que se deciden juntos: o manda la
    // planilla o manda lo que había.
    empresa_id: de.paga ? de.paga.empresa_id : previo?.empresa_id ?? null,
    paga_ambas: de.paga ? de.paga.ambas : previo?.paga_ambas ?? false,
    // Haber entrado por el sistema no se deshace por aparecer después en la
    // planilla: aparecer allá es justamente lo que se quiere que pase.
    origen: previo?.origen === "app" ? "app" : "sheets",
  };
}
