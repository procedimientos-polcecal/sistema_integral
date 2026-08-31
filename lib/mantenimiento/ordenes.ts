/**
 * Órdenes de trabajo: leer la planilla donde viven.
 *
 * Se lee por posición de columna, como en el origen y verificado contra la
 * planilla "ORDEN DE TRABAJO", pestaña OT:
 *
 *   A N° OT · B fecha · C sector · D equipo · E especialidad · F tipo ·
 *   G quién lo realiza · H descripción · I repuesto · J ejecución · K cierre ·
 *   L (calculada, se saltea) · M estado · N contratista · O horas ·
 *   P/Q/R operarios · S prioridad · T frecuencia · U próxima fecha ·
 *   V fotos · W observaciones
 *
 * La L se llama "Column 19" y trae un "Atrasado / al día" calculado. **No es el
 * estado**: el estado está en M, y confundirlas daría por atrasada media
 * planilla.
 */

import { texto, fechaDeSheets, codigoDeEquipo } from "@/lib/mantenimiento/planilla";

/**
 * Las especialidades que usa la planilla, verificadas contra ella.
 *
 * Es vocabulario cerrado: si aparece una nueva hay que sumarla acá para poder
 * filtrar por ella — las OT igual se guardan con lo que diga la celda.
 */
export const ESPECIALIDADES = ["MECÁNICO", "ELÉCTRICO", "CIVIL", "LUBRICACIÓN"] as const;

/** Columna de cada dato, contando desde A = 0. */
const COL = {
  otNumber: 0,
  fecha: 1,
  sector: 2,
  equipo: 3,
  especialidad: 4,
  tipo: 5,
  quien: 6,
  descripcion: 7,
  repuesto: 8,
  fechaEjecucion: 9,
  fechaCierre: 10,
  estado: 12,
  contratista: 13,
  horas: 14,
  operario1: 15,
  operario2: 16,
  operario3: 17,
  prioridad: 18,
  frecuencia: 19,
  proximaFecha: 20,
  fotos: 21,
  observaciones: 22,
} as const;

/**
 * El estado de la planilla, en el vocabulario del sistema.
 *
 * Lo que no se reconoce queda como "por hacer": es el estado del que se parte,
 * no un dato faltante. Una OT sin clasificar es una OT que falta hacer.
 */
export function estadoDeTexto(valor: unknown): string {
  const v = String(valor ?? "").trim().toUpperCase();

  if (v === "REALIZADO") return "REALIZADO";
  if (v.includes("PROCESO")) return "EN_PROCESO";
  if (v === "ATRASADO") return "ATRASADO";
  if (v === "SUSPENDIDA") return "SUSPENDIDA";
  return "POR_HACER";
}

/**
 * Un campo de texto de la planilla.
 *
 * El guión suelto es como se escribe "acá no va nada" en una planilla: no es un
 * contratista llamado "-".
 */
const campo = (v: unknown): string | null => {
  const s = texto(v);
  return s === null || s === "-" ? null : s;
};

const numero = (v: unknown): number | null => {
  const s = texto(v);
  if (s === null) return null;
  const n = Number(s.replace(",", "."));
  return isFinite(n) ? n : null;
};

export interface OrdenLeida {
  ot_number: number;
  fecha: string | null;
  sector_raw: string | null;
  equipo_raw: string | null;
  equipo_code: string | null;
  especialidad: string | null;
  tipo: string | null;
  quien: string | null;
  descripcion: string | null;
  repuesto: string | null;
  fecha_ejecucion: string | null;
  fecha_cierre: string | null;
  estado: string;
  contratista: string | null;
  horas: number | null;
  operario_1: string | null;
  operario_2: string | null;
  operario_3: string | null;
  prioridad: string | null;
  frecuencia: string | null;
  proxima_fecha: string | null;
  sheets_row: number;
}

/** Una fila de la planilla como orden de trabajo. `null` si no lo es. */
export function filaDeOrden(fila: unknown[], numeroFila: number): OrdenLeida | null {
  const nro = Number(fila[COL.otNumber]);
  if (!nro || isNaN(nro)) return null;

  const equipoRaw = campo(fila[COL.equipo]);

  return {
    ot_number: nro,
    fecha: fechaDeSheets(fila[COL.fecha]),
    sector_raw: campo(fila[COL.sector]),
    equipo_raw: equipoRaw,
    equipo_code: codigoDeEquipo(equipoRaw),
    especialidad: campo(fila[COL.especialidad]),
    tipo: campo(fila[COL.tipo]),
    quien: campo(fila[COL.quien]),
    descripcion: campo(fila[COL.descripcion]),
    repuesto: campo(fila[COL.repuesto]),
    fecha_ejecucion: fechaDeSheets(fila[COL.fechaEjecucion]),
    fecha_cierre: fechaDeSheets(fila[COL.fechaCierre]),
    estado: estadoDeTexto(fila[COL.estado]),
    contratista: campo(fila[COL.contratista]),
    horas: numero(fila[COL.horas]),
    operario_1: campo(fila[COL.operario1]),
    operario_2: campo(fila[COL.operario2]),
    operario_3: campo(fila[COL.operario3]),
    prioridad: campo(fila[COL.prioridad]),
    frecuencia: campo(fila[COL.frecuencia]),
    proxima_fecha: fechaDeSheets(fila[COL.proximaFecha]),
    sheets_row: numeroFila,
  };
}

/**
 * El texto del estado tal como lo escribe la planilla.
 *
 * La app guarda `EN_PROCESO`; la planilla dice "En proceso". Escribirle el
 * vocabulario de la app la dejaría con dos formas del mismo estado.
 */
const EN_LA_PLANILLA: Record<string, string> = {
  REALIZADO: "Realizado",
  EN_PROCESO: "En proceso",
  ATRASADO: "Atrasado",
  POR_HACER: "Por hacer",
  SUSPENDIDA: "Suspendida",
};

/** La letra de una columna: 0 → A. La planilla llega hasta la W. */
const letra = (i: number) => String.fromCharCode(65 + i);

export interface RegistroDeOT {
  estado?: string | null;
  fecha_cierre?: string | null;
  horas?: number | null;
  contratista?: string | null;
  operario_1?: string | null;
  operario_2?: string | null;
  operario_3?: string | null;
  observaciones?: string | null;
  foto_url?: string | null;
}

/**
 * Repartir lo que llega al registrar el trabajo: qué va a la tabla y qué a la
 * planilla.
 *
 * No es lo mismo. `ordenes_trabajo` tiene columna para el estado, el cierre,
 * las horas, el contratista y los tres operarios. **Las observaciones y la foto
 * no**: en el sistema viven en la ejecución —que es donde se registra qué se
 * hizo y qué se encontró— y en la planilla tienen su columna, la W y la V.
 *
 * Estaba escrito en línea en la ruta y las observaciones se colaron en el
 * update de la tabla: el PATCH fallaba entero con "Could not find the
 * 'observaciones' column", justo después de que la ejecución ya se había
 * guardado. El trabajo quedaba registrado y la OT sin cerrar. Vive acá para
 * poder probarlo.
 *
 * Es lista blanca: lo que no está nombrado no llega a la base, así que un body
 * con campos de más no puede escribir columnas arbitrarias.
 */
export const ESTADOS_DE_OT = [
  "REALIZADO", "EN_PROCESO", "ATRASADO", "POR_HACER", "SUSPENDIDA",
] as const;

/** Los que tienen columna propia en `ordenes_trabajo` y también en la planilla. */
const EN_LOS_DOS_LADOS = ["contratista", "operario_1", "operario_2", "operario_3"] as const;

export function repartirRegistroDeOT(body: Record<string, unknown>): {
  update: Record<string, unknown>;
  registro: RegistroDeOT;
} {
  const update: Record<string, unknown> = {};
  const registro: RegistroDeOT = {};
  const texto = (v: unknown) => String(v ?? "").trim() || null;

  if (body.estado !== undefined) {
    update.estado = body.estado;
    registro.estado = body.estado as string;
  }

  for (const campo of EN_LOS_DOS_LADOS) {
    if (body[campo] !== undefined) {
      update[campo] = texto(body[campo]);
      registro[campo] = update[campo] as string | null;
    }
  }

  if (body.horas !== undefined) {
    const n = Number(body.horas);
    const valor =
      body.horas === null || body.horas === "" || Number.isNaN(n) ? null : n;
    update.horas = valor;
    registro.horas = valor;
  }

  if (body.fecha_cierre !== undefined) {
    update.fecha_cierre = body.fecha_cierre || null;
    registro.fecha_cierre = update.fecha_cierre as string | null;
  }

  // Sólo a la planilla: no tienen columna en la tabla.
  if (body.observaciones !== undefined) registro.observaciones = texto(body.observaciones);
  if (body.foto_url !== undefined) registro.foto_url = texto(body.foto_url);

  return { update, registro };
}

/**
 * Qué celdas hay que escribir en la planilla al registrar el trabajo.
 *
 * Sólo las que se pasaron: la planilla es la fuente y no se toca lo que nadie
 * cambió. Pasar un campo en `null` **sí** lo vacía —es "sacá lo que había"—,
 * que es distinto de no pasarlo.
 *
 * La columna L no se escribe nunca: es la fórmula que calcula atrasado/al día.
 */
export function celdasParaRegistrar(
  registro: RegistroDeOT
): { letra: string; columna: number; valor: string }[] {
  const celdas: { letra: string; columna: number; valor: string }[] = [];

  const sumar = (columna: number, valor: string) =>
    celdas.push({ letra: letra(columna), columna, valor });

  if (registro.estado !== undefined) {
    const v = registro.estado;
    sumar(COL.estado, v ? EN_LA_PLANILLA[v] ?? v : "");
  }
  if (registro.fecha_cierre !== undefined) {
    sumar(COL.fechaCierre, fechaParaLaPlanilla(registro.fecha_cierre));
  }
  if (registro.horas !== undefined) {
    sumar(COL.horas, registro.horas === null ? "" : String(registro.horas));
  }
  if (registro.contratista !== undefined) sumar(COL.contratista, registro.contratista ?? "");
  if (registro.operario_1 !== undefined) sumar(COL.operario1, registro.operario_1 ?? "");
  if (registro.operario_2 !== undefined) sumar(COL.operario2, registro.operario_2 ?? "");
  if (registro.operario_3 !== undefined) sumar(COL.operario3, registro.operario_3 ?? "");
  if (registro.foto_url !== undefined) sumar(COL.fotos, registro.foto_url ?? "");
  if (registro.observaciones !== undefined) sumar(COL.observaciones, registro.observaciones ?? "");

  return celdas;
}

/** Una fecha ISO como la escribe la planilla. */
function fechaParaLaPlanilla(iso: string | null | undefined): string {
  if (!iso) return "";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/**
 * Una orden nueva, como las celdas de la planilla.
 *
 * La columna L se deja vacía: es la fórmula que calcula atrasado/al día, y la
 * planilla la completa sola al agregarse la fila.
 */
export function filaParaLaPlanillaDeOT(orden: {
  ot_number: number;
  fecha?: string | null;
  sector_raw?: string | null;
  equipo_raw?: string | null;
  especialidad?: string | null;
  tipo?: string | null;
  quien?: string | null;
  descripcion?: string | null;
  repuesto?: string | null;
  fecha_ejecucion?: string | null;
  fecha_cierre?: string | null;
  estado?: string | null;
  contratista?: string | null;
  horas?: number | null;
  operario_1?: string | null;
  operario_2?: string | null;
  operario_3?: string | null;
  prioridad?: string | null;
  frecuencia?: string | null;
  proxima_fecha?: string | null;
  observaciones?: string | null;
}): (string | number)[] {
  // Hasta la W —las observaciones—, que es la última que se lee.
  const fila: (string | number)[] = new Array(COL.observaciones + 1).fill("");

  fila[COL.otNumber] = orden.ot_number;
  fila[COL.fecha] = fechaParaLaPlanilla(orden.fecha);
  fila[COL.sector] = orden.sector_raw ?? "";
  fila[COL.equipo] = orden.equipo_raw ?? "";
  fila[COL.especialidad] = orden.especialidad ?? "";
  fila[COL.tipo] = orden.tipo ?? "";
  fila[COL.quien] = orden.quien ?? "";
  fila[COL.descripcion] = orden.descripcion ?? "";
  fila[COL.repuesto] = orden.repuesto ?? "";
  fila[COL.fechaEjecucion] = fechaParaLaPlanilla(orden.fecha_ejecucion);
  fila[COL.fechaCierre] = fechaParaLaPlanilla(orden.fecha_cierre);
  fila[COL.estado] = orden.estado ? EN_LA_PLANILLA[orden.estado] ?? orden.estado : "";
  fila[COL.contratista] = orden.contratista ?? "";
  fila[COL.horas] = orden.horas ?? "";
  fila[COL.operario1] = orden.operario_1 ?? "";
  fila[COL.operario2] = orden.operario_2 ?? "";
  fila[COL.operario3] = orden.operario_3 ?? "";
  fila[COL.prioridad] = orden.prioridad ?? "";
  fila[COL.frecuencia] = orden.frecuencia ?? "";
  fila[COL.proximaFecha] = fechaParaLaPlanilla(orden.proxima_fecha);
  fila[COL.observaciones] = orden.observaciones ?? "";

  return fila;
}
