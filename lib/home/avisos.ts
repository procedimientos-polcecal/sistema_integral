import type { Modulo } from "@/lib/core/types";
import type { Notificacion } from "./notificaciones";
import { cantidadDelAviso, type Ritmo } from "./ritmo";

/**
 * Los conteos que pueden generar un aviso. Todos opcionales: cada ruta pasa los
 * de los módulos que el usuario tiene, y los que faltan no generan nada.
 */
export interface ConteosParaAvisos {
  rrhhSinClasificar: number;
  mantenimientoAtrasadas: number;
  mantenimientoDivergencias: number;
  comprasEsperandoAprobacion: number;
  inventarioSinPlanilla: number;
  produccionSinPlanilla: number;
  despachoAbiertas: number;
  despachoSinPlanilla: number;
  facturacionSinVincular: number;
  canteraSinConciliar: number;
  calidadEnvasesSinPlanilla: number;
  calidadCarbonillaBandeja: number;
  tallerVialSinEquipo: number;
  tallerVialSinService: number;
  trituracionSinPlanilla: number;
  syhVencidas: number;
  syhSinCompletar: number;
}

/**
 * Qué título y qué link le corresponde a cada conteo. El orden de esta lista es
 * el orden en que salen los avisos.
 *
 * Lo que entra acá tiene que **pedir hacer algo**. Un movimiento que no llegó a
 * la planilla no es decorativo: el stock sale de las fórmulas de allá, así que
 * la próxima sincronización lo revierte.
 */
const AVISOS: { clave: keyof ConteosParaAvisos; id: string; titulo: string; href: string }[] = [
  { clave: "rrhhSinClasificar", id: "rrhh-sin-clasificar", titulo: "Ausencias sin clasificar", href: "/rrhh/asistencia?tab=dia" },
  { clave: "mantenimientoAtrasadas", id: "mant-atrasadas", titulo: "Órdenes de trabajo atrasadas", href: "/mantenimiento/ordenes?estado=ATRASADO" },
  // Órdenes en las que el sistema y la planilla dicen cosas distintas. La
  // tabla se rehace en cada sincronización, así que su tamaño es la
  // divergencia de hoy y no un acumulado: lo que se arregla desaparece solo.
  { clave: "mantenimientoDivergencias", id: "mant-divergencias", titulo: "Órdenes que dicen distinto en el sistema y en la planilla", href: "/mantenimiento/ordenes" },
  { clave: "comprasEsperandoAprobacion", id: "compras-por-aprobar", titulo: "Requerimientos esperando aprobación", href: "/compras/aprobaciones" },
  { clave: "inventarioSinPlanilla", id: "inv-sin-planilla", titulo: "Movimientos que no llegaron a la planilla", href: "/inventario/movimientos" },
  { clave: "produccionSinPlanilla", id: "produccion-sin-planilla", titulo: "Partes de producción que no llegaron a la planilla", href: "/produccion" },
  /*
   * Una orden sin cerrar es un camión que se fue sin que nadie marcara la
   * salida. No es sólo un dato faltante: el espejo escribe **al cerrar**, así
   * que esa orden todavía no está en la planilla, y la planilla es de donde lee
   * quien no entra al sistema. Se avisa de las de días anteriores y no de las de
   * hoy, que están abiertas porque el camión está ahí.
   */
  { clave: "despachoAbiertas", id: "despacho-sin-cerrar", titulo: "Órdenes de carga sin cerrar de días anteriores", href: "/despacho" },
  { clave: "despachoSinPlanilla", id: "despacho-sin-planilla", titulo: "Órdenes de carga que no llegaron a la planilla", href: "/despacho/ordenes" },
  { clave: "facturacionSinVincular", id: "facturacion-sin-vincular", titulo: "Facturas en el buzón sin vincular a una compra", href: "/facturacion?estado=recibida" },
  { clave: "canteraSinConciliar", id: "cantera-sin-conciliar", titulo: "Registros de cantera con factura sin conciliar o a revisar", href: "/cantera/registros" },
  { clave: "calidadEnvasesSinPlanilla", id: "calidad-envases-sin-planilla", titulo: "Movimientos de envases que no llegaron a la planilla", href: "/calidad/envases/movimientos" },
  /*
   * En carbonilla manda la planilla, y desde el 23/10/2026 una fila que cambió
   * se relee sola. Lo que queda en la bandeja es lo que el SdG **no puede**
   * resolver y necesita una persona: una fila vaciada —que no se borra sola
   * porque una planilla calculando se lee igual que una vacía—, un código que
   * no es de ningún carbonillero, o un id duplicado por copiar y pegar una
   * fila.
   *
   * La bandeja existe desde el 13/10 y en diez días no la miró nadie. En ese
   * tiempo el SdG estuvo 8 t abajo y después 59 t abajo, y las dos veces se
   * supo porque alguien preguntó. Un tablero que hay que acordarse de abrir no
   * es un tablero: por eso esto va al resumen diario, que llega solo.
   */
  { clave: "calidadCarbonillaBandeja", id: "calidad-carbonilla-bandeja", titulo: "Filas de la planilla de carbonilla que el sistema no pudo leer", href: "/calidad/carbonilla" },
  { clave: "tallerVialSinEquipo", id: "taller-vial-sin-equipo", titulo: "Cargas de combustible sin un equipo reconocido", href: "/taller-vial/cargas" },
  /*
   * Reemplaza a "service de 250 hs vencido" y "service por vencer", que medían
   * una tabla con **un solo service** en todo el sistema y por lo tanto sólo
   * podían decir 0 o 1. Lo accionable son los 15 equipos de 16 a los que nunca
   * se les anotó uno.
   *
   * El id es nuevo a propósito. Los dos viejos
   * —`taller-vial-service-vencido` y `taller-vial-service-proximo`— quedan
   * huérfanos en `notificaciones_descartes`, lo cual es inofensivo porque nunca
   * más coinciden con nada. Reusar uno sería peor: a quien lo había descartado
   * le llegaría ya silenciado un aviso que nunca vio.
   */
  { clave: "tallerVialSinService", id: "taller-vial-sin-service", titulo: "Equipos sin ningún service registrado", href: "/taller-vial/services" },
  { clave: "trituracionSinPlanilla", id: "trituracion-sin-planilla", titulo: "Partes de trituración sin exportar a la planilla", href: "/trituracion/partes" },
  { clave: "syhVencidas", id: "syh-vencidas", titulo: "Condiciones inseguras vencidas", href: "/seguridad-higiene/condiciones?estado=vencida" },
  /*
   * Es **un** aviso y no tres («sin evaluar», «sin asignar», «sin lugar»), a
   * propósito. Una condición a la que le pusieron los cinco puntajes pero
   * nunca le asignaron responsable ni fecha máxima **no puede vencer nunca** —no
   * hay fecha que pase— y deja de ser «sin evaluar»: con un aviso por cada
   * cosa, esa fila desaparecería de todos y del push para siempre. Juntos no
   * hay por dónde escaparse. Cuenta lo mismo que `faltasPendientes`: las
   * abiertas a las que les falta algo.
   */
  { clave: "syhSinCompletar", id: "syh-sin-completar", titulo: "Condiciones inseguras sin completar", href: "/seguridad-higiene/condiciones?falta=cualquiera" },
];

export function avisosDeConteos(conteos: Partial<ConteosParaAvisos>): Notificacion[] {
  return AVISOS.flatMap(({ clave, id, titulo, href }) => {
    const cantidad = conteos[clave] ?? 0;
    return cantidad > 0 ? [{ id, titulo, cantidad, href }] : [];
  });
}

const NOMBRE: Record<Modulo, string> = {
  rrhh: "RRHH", mantenimiento: "Mantenimiento", remises: "Remises", compras: "Compras",
  inventario: "Inventario", produccion: "Producción", despacho: "Despacho",
  facturacion: "Facturación", cantera: "Cantera", calidad: "Calidad",
  taller_vial: "Taller Vial", trituracion: "Trituración", seguridad_higiene: "Seguridad e Higiene",
};

const HREF: Record<Modulo, string> = {
  rrhh: "/rrhh", mantenimiento: "/mantenimiento", remises: "/remises", compras: "/compras",
  inventario: "/inventario", produccion: "/produccion", despacho: "/despacho",
  facturacion: "/facturacion", cantera: "/cantera", calidad: "/calidad",
  taller_vial: "/taller-vial", trituracion: "/trituracion", seguridad_higiene: "/seguridad-higiene",
};

/**
 * Los avisos de ritmo que van al globo de la campana.
 *
 * En la tarjeta la señal aparece apenas se pasa el umbral; acá recién al
 * **doble**, para que Despacho con 5 días no haga ruido y Trituración con 36 sí.
 * Medido el 06/10/2026, entrarían siete: RRHH y Taller Vial justo en el borde,
 * Calidad por partida doble, Trituración, Remises y Producción.
 */
export function avisosDeRitmo(
  ritmo: Partial<Record<Modulo, Ritmo>>,
  modulos: Modulo[]
): Notificacion[] {
  return modulos.flatMap((m) => {
    const r = ritmo[m];
    if (!r || !r.atrasado) return [];
    if (r.diasSinCargar !== null && r.diasSinCargar < r.umbral * 2) return [];
    return [{
      id: `ritmo-${m}`,
      titulo: r.diasSinCargar === null
        ? `${NOMBRE[m]}: nunca se cargó nada`
        : `${NOMBRE[m]}: hace ${r.diasSinCargar} días que no se carga`,
      cantidad: cantidadDelAviso(r.diasSinCargar, r.umbral),
      href: HREF[m],
    }];
  });
}
