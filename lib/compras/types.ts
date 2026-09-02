export type EstadoAprobacion = "PENDIENTE" | "EN_REVISION" | "APROBADA" | "DENEGADA";

/**
 * En el orden en que avanza el trabajo.
 *
 * `EN_ESPERA` no es una etapa sino un desvío: un pedido frenado a propósito
 * —un stock de emergencia, algo que espera otra decisión— que no está en curso
 * pero tampoco se denegó. Sale de la cola activa y vuelve a la etapa de la que
 * salió, que se guarda en `etapa_previa`.
 */
export type EstadoCompra =
  | "SIN_INICIAR"
  | "EN_COMPARATIVA"
  | "PARA_COMPRAR"
  | "APROBADO"
  | "PEDIDO"
  | "RECIBIDO"
  | "DENEGADO"
  | "EN_ESPERA";

export type Prioridad = "URGENTE" | "1 SEMANA" | "2 SEMANAS" | "NORMAL" | "LEVE";

export interface UbicacionCompras {
  id: string;
  nombre: string;
  tipo: string | null;
  sector_id: string | null;
  equipo_id: string | null;
  orden: number;
  activo: boolean;
}

export interface AreaCompras {
  id: string;
  nombre: string;
  orden: number;
  activo: boolean;
}

export interface Proveedor {
  id: string;
  nombre: string;
  cuit: string | null;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  rubro: string | null;
  notas: string | null;
  es_contratista: boolean;
  activo: boolean;

  // Lo que hace falta para pagarle, traído de la base de datos de
  // administración. Casi todo puede venir vacío: se cargó lo que la planilla
  // tenía.
  direccion: string | null;
  sitio_web: string | null;
  telefono_alt: string | null;
  plazo_pago_dias: number | null;
  forma_pago: string | null;
  condicion_pago: string | null;
  cbu: string | null;
  /** Alias de la cuenta. No confundir con el alias de un aprobador. */
  alias_bancario: string | null;
  comentario: string | null;
}

export interface Requerimiento {
  id: string;
  nro_ri: number;

  fecha: string;
  area_id: string | null;
  descripcion: string;
  codigo: string | null;
  cantidad: number | null;

  ubicacion_raw: string | null;
  ubicacion_id: string | null;

  fecha_necesidad: string | null;
  detalle_extra: string | null;
  imagen_url: string | null;
  /** La define quien aprueba: null mientras no se haya decidido. */
  prioridad: Prioridad | null;
  empresa_id: string | null;
  /** true = la pagan las dos. Con empresa_id null y esto false, sin definir. */
  paga_ambas: boolean;

  solicitante_id: string | null;
  solicitante_nombre: string | null;
  /**
   * Mail de quien lo cargó, copiado al crearlo. Nulo en los que vinieron de la
   * planilla: quién pidió vive en las respuestas del formulario, no ahí.
   */
  solicitante_email: string | null;

  estado_aprobacion: EstadoAprobacion;
  aprobador: string | null;
  aprobado_en: string | null;
  motivo_rechazo: string | null;

  estado_compra: EstadoCompra;
  /** De qué etapa salió, si está EN_ESPERA. Nula si no lo está. */
  etapa_previa: EstadoCompra | null;
  /** A quién le toca aprobar la compra: el «(NICO)» del estado en la planilla. */
  compra_asignada_a: string | null;
  compra_aprobada_por: string | null;
  compra_aprobada_en: string | null;
  comparativa_url: string | null;
  /** Archivo de la carpeta de comparativas de Drive del que salen los presupuestos. */
  comparativa_drive_id: string | null;
  comparativa_nombre: string | null;
  proveedor_id: string | null;
  costo_iva: number | null;
  costo_envio: number | null;
  moneda: string;
  oc_numero: string | null;
  fecha_pedido: string | null;
  fecha_recepcion: string | null;

  origen: string;
  hoja_origen: string | null;
  sheets_fila: number | null;
  editado_en_app: boolean;

  created_at: string;
  updated_at: string;
}

/** Requerimiento con las relaciones ya resueltas por el select. */
export interface RequerimientoConRelaciones extends Requerimiento {
  compras_areas: { nombre: string } | null;
  empresas: { nombre: string } | null;
  proveedores: { nombre: string } | null;
  compras_ubicaciones: { nombre: string } | null;
}

/**
 * Un presupuesto de un proveedor, con la forma de la planilla de comparativa.
 *
 * La planilla separa dos cosas que antes estaban mezcladas en `plazo_entrega`:
 * el plazo de PAGO (en días) y la DISPONIBILIDAD (cuándo llega).
 */
export interface Cotizacion {
  id: string;
  requerimiento_id: string;
  proveedor_id: string;
  marca: string | null;
  unidad_medida: string | null;
  precio_unitario: number | null;
  cantidad: number | null;
  costo_envio: number | null;
  /** Fracciones: 0.10 es 10%. */
  descuento: number | null;
  iva: number | null;
  /**
   * Lo calcula la base: columna generada (migración 026). Queda **en la moneda
   * del presupuesto**: es generada y no puede depender del dólar del día. La
   * conversión a pesos la hace `totalEnPesos()` al mostrar.
   */
  precio_total: number | null;
  /** `ARS` o `USD`. Vale para el presupuesto entero, envío incluido. */
  moneda: string | null;
  /** El dólar con el que se congeló al elegirlo. Nula mientras se compara. */
  cotizacion: number | null;
  /** Hasta cuándo vale ese precio. */
  precio_hasta: string | null;
  plazo_pago_dias: number | null;
  condiciones_pago: string | null;
  disponibilidad: string | null;
  comentario: string | null;
  url: string | null;
  elegida: boolean;
  /** `app` = cargada en el sistema; `drive` = leída de la planilla. */
  origen: string;
  drive_fila: number | null;
  created_at: string;
  proveedores?: { nombre: string } | null;
}

export interface HistorialItem {
  id: string;
  requerimiento_id: string;
  campo: string;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  usuario_nombre: string | null;
  nota: string | null;
  created_at: string;
}

export interface Sincronizacion {
  id: string;
  direccion: string;
  origen: string;
  filas_leidas: number;
  filas_nuevas: number;
  filas_actualizadas: number;
  filas_omitidas: number;
  error: string | null;
  duracion_ms: number | null;
  created_at: string;
}
