export type EstadoAprobacion = "PENDIENTE" | "EN_REVISION" | "APROBADA" | "DENEGADA";

export type EstadoCompra =
  | "SIN_INICIAR"
  | "PARA_COMPRAR"
  | "EN_COMPARATIVA"
  | "PEDIDO"
  | "RECIBIDO"
  | "DENEGADO";

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

  estado_aprobacion: EstadoAprobacion;
  aprobador: string | null;
  aprobado_en: string | null;
  motivo_rechazo: string | null;

  estado_compra: EstadoCompra;
  comparativa_url: string | null;
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

export interface Cotizacion {
  id: string;
  requerimiento_id: string;
  proveedor_id: string;
  precio_unitario: number | null;
  precio_total: number | null;
  costo_envio: number | null;
  plazo_entrega: string | null;
  condiciones: string | null;
  url: string | null;
  elegida: boolean;
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
