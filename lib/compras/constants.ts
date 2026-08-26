import type { EstadoAprobacion, EstadoCompra, Prioridad } from "./types";

export const ESTADOS_APROBACION: EstadoAprobacion[] = [
  "PENDIENTE", "EN_REVISION", "APROBADA", "DENEGADA",
];

export const ESTADOS_COMPRA: EstadoCompra[] = [
  "SIN_INICIAR", "EN_COMPARATIVA", "PARA_COMPRAR", "APROBADO", "PEDIDO", "RECIBIDO",
  "DENEGADO", "EN_ESPERA",
];

export const PRIORIDADES: Prioridad[] = [
  "URGENTE", "1 SEMANA", "2 SEMANAS", "NORMAL", "LEVE",
];

export const APROBACION_LABELS: Record<EstadoAprobacion, { label: string; color: string }> = {
  PENDIENTE:   { label: "Pendiente",   color: "bg-yellow-100 text-yellow-800" },
  EN_REVISION: { label: "En revisión", color: "bg-blue-100 text-blue-800" },
  APROBADA:    { label: "Aprobada",    color: "bg-green-100 text-green-800" },
  DENEGADA:    { label: "Denegada",    color: "bg-red-100 text-red-800" },
};

export const COMPRA_LABELS: Record<EstadoCompra, { label: string; color: string }> = {
  SIN_INICIAR:    { label: "Sin iniciar",     color: "bg-gray-100 text-gray-600" },
  EN_COMPARATIVA: { label: "En comparativa",  color: "bg-blue-100 text-blue-800" },
  PARA_COMPRAR:   { label: "Para comprar",    color: "bg-yellow-100 text-yellow-800" },
  APROBADO:       { label: "Compra aprobada", color: "bg-teal-100 text-teal-800" },
  PEDIDO:         { label: "Pedido",          color: "bg-indigo-100 text-indigo-800" },
  RECIBIDO:       { label: "Recibido",        color: "bg-green-100 text-green-800" },
  DENEGADO:       { label: "Denegado",        color: "bg-red-100 text-red-800" },
  // Gris a propósito: no es un paso del trabajo sino un pedido frenado.
  EN_ESPERA:      { label: "En espera",       color: "bg-slate-200 text-slate-600" },
};

export const PRIORIDAD_LABELS: Record<Prioridad, { label: string; color: string }> = {
  URGENTE:      { label: "Urgente",    color: "bg-red-100 text-red-800" },
  "1 SEMANA":   { label: "1 semana",   color: "bg-amber-100 text-amber-800" },
  "2 SEMANAS":  { label: "2 semanas",  color: "bg-yellow-100 text-yellow-700" },
  NORMAL:       { label: "Normal",     color: "bg-gray-100 text-gray-600" },
  LEVE:         { label: "Leve",       color: "bg-slate-100 text-slate-500" },
};

/** Urgencia de mayor a menor. Ordena las colas de trabajo. */
export const PESO_PRIORIDAD: Record<Prioridad, number> = {
  URGENTE: 0, "1 SEMANA": 1, "2 SEMANAS": 2, NORMAL: 3, LEVE: 4,
};

/**
 * Peso de ordenamiento tolerando la prioridad sin definir.
 *
 * Va última: mientras nadie la fijó, no hay motivo para adelantarla sobre algo
 * que sí se evaluó como urgente. Entre varias sin definir manda la antigüedad,
 * que es el desempate de las colas.
 */
export function pesoPrioridad(p: Prioridad | null | undefined): number {
  return p ? PESO_PRIORIDAD[p] : 99;
}

/**
 * Cómo se ordena una columna del tablero.
 *
 * Cada una por su cuenta, porque el trabajo es distinto: en "Para comprar"
 * interesa la urgencia, y en "Pedido" lo que se movió recién.
 */
export type OrdenTablero = "prioridad" | "numero" | "cambio";

export const ORDENES_TABLERO: { valor: OrdenTablero; label: string }[] = [
  { valor: "prioridad", label: "Por prioridad" },
  { valor: "numero", label: "Por N° de RI" },
  { valor: "cambio", label: "Por cambio reciente" },
];

interface Ordenable {
  nro_ri: number;
  prioridad: Prioridad | null;
  fecha: string;
  updated_at: string;
}

/** Devuelve una copia ordenada: no toca el arreglo que recibe. */
export function ordenarRequerimientos<T extends Ordenable>(
  items: T[],
  criterio: OrdenTablero
): T[] {
  const copia = [...items];
  const cuando = (v: string) => new Date(v).getTime();

  if (criterio === "numero") return copia.sort((a, b) => b.nro_ri - a.nro_ri);
  if (criterio === "cambio") {
    return copia.sort((a, b) => cuando(b.updated_at) - cuando(a.updated_at));
  }

  // Por prioridad, y a igual urgencia lo más viejo primero: es lo que lleva
  // más tiempo esperando.
  return copia.sort(
    (a, b) =>
      pesoPrioridad(a.prioridad) - pesoPrioridad(b.prioridad) ||
      cuando(a.fecha) - cuando(b.fecha)
  );
}

/**
 * El N° de RI que no es un requerimiento.
 *
 * La fila 2 del master —la primera debajo del encabezado— es la plantilla de
 * la planilla: está ahí para que Sheets arrastre sus fórmulas al resto, y su
 * contenido es de prueba ("dd", código "de"). El importador la levantó como
 * una fila más porque tiene número de RI, y después alguien la aprobó desde la
 * app, con lo que quedó encolada una escritura sobre esas fórmulas.
 *
 * Se la reconoce por el número y no por la posición: si mañana mueven filas,
 * el número la sigue. El riesgo asumido es el inverso —un RI 1 de verdad
 * quedaría invisible—, y no existe: la serie real arranca en el 2.
 */
export const RI_PLANTILLA = 1;

/** Si esta fila de la planilla hay que dejarla en paz. */
export function esFilaPlantilla(nroRi: number): boolean {
  return nroRi === RI_PLANTILLA;
}

/**
 * Las etapas de la compra, en el orden en que avanza el trabajo.
 *
 * Fueron las columnas del kanban y hoy son los indicadores del tablero. El
 * nombre quedó: sigue siendo el mismo recorrido.
 */
export const COLUMNAS_TABLERO: EstadoCompra[] = [
  "SIN_INICIAR", "EN_COMPARATIVA", "PARA_COMPRAR", "APROBADO", "PEDIDO",
];

/**
 * Pasos que no se dan de un botonazo: abren un diálogo antes.
 *
 * En `EN_COMPARATIVA` y `APROBADO` el diálogo **exige** lo que el paso produce
 * —a quién le toca aprobar, o el proveedor y el costo del pedido—. En
 * `PARA_COMPRAR` no exige nada: avisa que se está aprobando sin comparativa y
 * ofrece cargar el proveedor y el costo si ya se saben.
 *
 * Por eso ya no se llama ESTADOS_QUE_PIDEN_DATOS: con los tres adentro, ese
 * nombre mentía sobre un tercio de los casos.
 */
export const ESTADOS_CON_DIALOGO: EstadoCompra[] = [
  "EN_COMPARATIVA", "PARA_COMPRAR", "APROBADO",
];

/** A qué estado pasa cada columna al avanzar, y con qué texto se ofrece. */
export const SIGUIENTE_ESTADO: Partial<Record<EstadoCompra, EstadoCompra>> = {
  SIN_INICIAR: "EN_COMPARATIVA",
  EN_COMPARATIVA: "PARA_COMPRAR",
  PARA_COMPRAR: "APROBADO",
  APROBADO: "PEDIDO",
};

export const ACCION_SIGUIENTE: Partial<Record<EstadoCompra, string>> = {
  SIN_INICIAR: "Pasar a comparativa",
  EN_COMPARATIVA: "Comparativa lista",
  PARA_COMPRAR: "Aprobar la compra",
  APROBADO: "Registrar el pedido",
};

/**
 * Qué hace falta tener cargado para poder pasar a cada estado.
 *
 * No es validación por validación: son los datos que el paso produce. Pasar a
 * PEDIDO sin proveedor ni costo deja un pedido que después nadie puede seguir.
 *
 * `PARA_COMPRAR` ya no exige el link de la comparativa: exige que haya algo que
 * mirar —un presupuesto cargado o el link— porque si no, la persona asignada no
 * puede elegir. Cuántos presupuestos alcanza lo decide Compras, no el sistema.
 * La verificación vive en la ruta, que es la que puede contarlos.
 */
export const REQUISITOS: Partial<Record<EstadoCompra, string[]>> = {
  PARA_COMPRAR: ["comparativa", "compra_asignada_a"],
  PEDIDO: ["proveedor_id", "costo_iva"],
};

// ── Formato ──────────────────────────────────────────────────

const fmtMoneda = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export function moneda(valor: number | null | undefined): string {
  return valor === null || valor === undefined ? "—" : fmtMoneda.format(valor);
}

const fmtMonedaExacta = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Importe con centavos.
 *
 * `moneda()` redondea a pesos, que alcanza para un tablero pero no para una
 * comparativa: dos presupuestos pueden diferir por centavos y el redondeo lo
 * esconde justo cuando alguien esta eligiendo.
 *
 * Intl separa el signo con un espacio duro (U+00A0); se pasa a espacio normal
 * para que el texto sea comparable y buscable.
 */
export function monedaExacta(valor: number | null | undefined): string {
  return valor === null || valor === undefined
    ? SIN_DEFINIR
    : fmtMonedaExacta.format(valor).replace(/\u00a0/g, " ");
}

export function fecha(valor: string | null | undefined): string {
  if (!valor) return "—";
  const d = new Date(valor.length <= 10 ? valor + "T12:00:00" : valor);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fechaHora(valor: string | null | undefined): string {
  if (!valor) return "—";
  const d = new Date(valor);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("es-AR", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
}

/** Días hasta la fecha en que se necesita. Negativo = vencido. */
export function diasRestantes(fechaNecesidad: string | null | undefined): number | null {
  if (!fechaNecesidad) return null;
  const d = new Date(fechaNecesidad + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - hoy.getTime()) / 86_400_000);
}

/**
 * Quién paga, en texto.
 *
 * Hay tres estados y conviene que se distingan a simple vista: una empresa,
 * las dos, o todavía sin decidir. Antes "sin decidir" se mostraba como
 * "Ambas", que es una decisión distinta.
 */
export function etiquetaEmpresa(
  nombre: string | null | undefined,
  pagaAmbas?: boolean
): string {
  if (nombre) return nombre;
  return pagaAmbas ? "Ambas" : SIN_DEFINIR;
}

/** Cómo se muestra lo que todavía nadie decidió. */
export const SIN_DEFINIR = "—";

/** Etiqueta de prioridad, contemplando que puede no estar definida. */
export function etiquetaPrioridad(p: Prioridad | null | undefined) {
  return p ? PRIORIDAD_LABELS[p] : { label: SIN_DEFINIR, color: "bg-slate-100 text-slate-400" };
}
