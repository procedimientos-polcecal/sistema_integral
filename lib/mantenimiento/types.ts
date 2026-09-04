export type EquipmentStatus =
  | "OPERATIVO"
  | "EN_MANTENIMIENTO"
  | "EN_REPARACION"
  | "STANDBY"
  | "FUERA_DE_SERVICIO"
  | "DADO_DE_BAJA";

export type CriticalityLevel = "ALTA" | "MEDIA" | "BAJA";

export type MaintenanceType =
  | "Lubricacion"
  | "Inspeccion"
  | "Limpieza"
  | "Ajuste"
  | "Reemplazo"
  | "Revision_electrica"
  | "Otro";

export type ScheduleType =
  | "DIARIO"
  | "SEMANAL"
  | "QUINCENAL"
  | "MENSUAL"
  | "TRIMESTRAL"
  | "SEMESTRAL"
  | "ANUAL"
  | "PERSONALIZADO"
  | "FECHA_FIJA";

export type ScheduleStatus = "active" | "paused" | "cancelled" | "completed";

export type PlantStatus = "ACTIVA" | "PARADA" | "EN_REPARACION";

export type ExecutionStatus = "completado" | "parcial" | "cancelado";

export interface Equipo {
  id: string;
  sector_id: string;
  name: string;
  code: string;
  power_kw: number | null;
  description: string | null;
  status: EquipmentStatus;
  criticality: CriticalityLevel;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;

  // ── Ficha técnica ────────────────────────────────────────
  // Lo que se releva recorriendo la planta. Todo opcional: la ficha se
  // completa de a poco y un equipo recién dado de alta no tiene nada de esto.
  tipo_id?: string | null;
  tipo_equipo?: string | null;
  descripcion_proceso?: string | null;
  marca?: string | null;
  modelo?: string | null;
  nro_serie?: string | null;
  anio_fabricacion?: number | null;
  anio_instalacion?: number | null;
  tension_v?: string | null;
  intensidad_nominal_a?: number | null;
  rpm_motor?: number | null;
  fp_cos_phi?: number | null;
  relacion_reduccion?: string | null;
  rpm_salida?: number | null;
  rodamiento_motor_de?: string | null;
  rodamiento_motor_nde?: string | null;
  rodamiento_carga?: string | null;
  rodamiento_otro?: string | null;
  ubicacion_fisica?: string | null;
  nivel_altura_m?: number | null;
  origen_equipo?: string | null;
  horas_marcha?: number | null;
  proveedor_repuesto_critico?: string | null;
  fecha_ultimo_relevamiento?: string | null;
  relevado_por?: string | null;
  foto_registro_url?: string | null;
}

/** Un componente del equipo: de qué está hecho. */
export interface ComponenteEquipo {
  id: string;
  equipment_id: string;
  /** El identificador del relevamiento, "COMP-0001". */
  componente_id: string | null;
  nombre: string;
  categoria: string | null;
  especificacion: string | null;
  material: string | null;
  cantidad: string | null;
  proveedor_critico: string | null;
  criticidad: string | null;
  foto_url: string | null;
  fecha_relevamiento: string | null;
  relevado_por: string | null;
  created_at: string;
}

/** Un repuesto que conviene tener para el equipo. */
export interface RepuestoEquipo {
  id: string;
  equipment_id: string;
  name: string;
  code: string | null;
  notes: string | null;
  created_at: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  type: "check" | "number" | "text" | "photo";
  required: boolean;
  unit?: string;
}

export interface EquipoChecklist {
  id: string;
  equipment_id: string;
  maintenance_type: MaintenanceType | null;
  version: number;
  items: ChecklistItem[];
  created_by: string | null;
  created_at: string;
  is_active: boolean;
  name: string | null;
}

export interface MantenimientoProgramado {
  id: string;
  equipment_id: string;
  checklist_id: string | null;
  maintenance_type: MaintenanceType;
  schedule_type: ScheduleType;
  interval_days: number | null;
  next_date: string;
  assigned_to: string | null;
  status: ScheduleStatus;
  created_by: string | null;
  created_at: string;
  last_executed_at: string | null;
  description: string | null;
  estimated_hours: number | null;
  reference_photos: string[];
}

export interface MantenimientoEjecucion {
  id: string;
  schedule_id: string | null;
  equipment_id: string | null;
  assigned_to: string | null;
  started_at: string | null;
  completed_at: string | null;
  checklist_responses: Array<{ item_id: string; value: string | number | boolean }>;
  notes_start: string | null;
  notes_end: string | null;
  synced_at: string | null;
  created_at: string;
  photo_urls: string[];
  checklist_snapshot: ChecklistItem[] | null;
  execution_status: ExecutionStatus | null;
  executed_at: string | null;
  duration_hours: number | null;
  observations: string | null;
  executed_by: string | null;
}

export interface EquipoStatusLog {
  id: string;
  equipment_id: string;
  old_status: EquipmentStatus | null;
  new_status: EquipmentStatus;
  changed_by: string | null;
  changed_at: string;
  reason: string | null;
}

export interface OrdenTrabajo {
  id: string;
  ot_number: number;
  fecha: string | null;
  sector_raw: string | null;
  equipo_raw: string | null;
  equipo_code: string | null;
  equipment_id: string | null;
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
  synced_at: string;
  app_created: boolean;
  sheets_row: number | null;
  sector_id: string | null;
  created_by: string | null;
  created_at_app: string | null;
  schedule_id: string | null;
}

export interface PlanificacionDiaria {
  id: string;
  fecha: string;
  titulo: string | null;
  notas: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PlanificacionDiariaItem {
  id: string;
  plan_id: string;
  work_order_id: string | null;
  ot_number: number | null;
  especialidad: string | null;
  sector_raw: string | null;
  equipo_raw: string | null;
  descripcion: string | null;
  repuesto: string | null;
  fecha_ejecucion: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  notas_item: string | null;
  orden: number;
  created_at: string;
}

/**
 * Un aviso: alguien reporta que algo necesita mantenimiento.
 *
 * Espeja la planilla de avisos; de un aviso puede salir después una orden de
 * trabajo, y ahí queda enlazado por `work_order_id`.
 */
export interface Aviso {
  id: string;
  oa_number: string | null;
  fecha: string | null;
  sector_raw: string | null;
  sector_id: string | null;
  equipo_raw: string | null;
  equipo_code: string | null;
  equipment_id: string | null;
  descripcion: string | null;
  urgencia: string | null;
  quien_aviso: string | null;
  /** Lo que dice la planilla: "si", un N° de OT, o vacío. */
  ot_asignada: string | null;
  work_order_id: string | null;
  observaciones: string | null;
  repuesto: string | null;
  reference_photos: string[] | null;
  app_created: boolean;
  sheets_row: number | null;
  synced_at: string | null;
  created_at: string;
  equipos?: { name: string; code: string | null } | null;
  sectores?: { nombre: string } | null;
}

/**
 * Una orden de servicio: un trabajo que se le pide a un tercero.
 *
 * A diferencia de la OT, que la hace el personal propio. Vive en su planilla
 * —una pestaña por área— y acá es un espejo con seguimiento.
 */
export interface OrdenServicio {
  id: string;
  os_number: number | null;
  fecha: string | null;
  area: string | null;
  sector_raw: string | null;
  sector_id: string | null;
  equipo_raw: string | null;
  equipo_code: string | null;
  equipment_id: string | null;
  descripcion: string | null;
  fecha_requerimiento: string | null;
  detalle_extra: string | null;
  imagen: string | null;
  prioridad: string | null;
  empresa: string | null;
  comparativa: string | null;
  proveedor_elegido: string | null;
  estado: string | null;
  cuit: string | null;
  tiene_orden_compra: string | null;
  costo: number | null;
  fecha_pedido: string | null;
  fecha_realizacion: string | null;
  observaciones: string | null;
  /**
   * Por qué se denegó. Sólo lo carga la app: la planilla de OS no tiene esta
   * columna, y su único texto libre —OBSERVACIONES— es de uso general.
   */
  motivo_rechazo: string | null;
  app_created: boolean;
  sheets_tab: string | null;
  sheets_row: number | null;
  synced_at: string | null;
  created_at: string;
  equipos?: { name: string; code: string | null } | null;
  sectores?: { nombre: string } | null;
}

/** Una cotización de la comparativa de una OS. */
export interface CotizacionOS {
  id: string;
  os_number: number | null;
  fecha: string | null;
  area: string | null;
  sector: string | null;
  equipo_raw: string | null;
  descripcion: string | null;
  proveedor: string;
  precio_unitario: string | null;
  /** Fracción: 0.21. La planilla lo muestra como "21%". */
  iva: number | null;
  precio_total: string | null;
  vigencia_hasta: string | null;
  plazos: string | null;
  condiciones_pago: string | null;
  otras_especificaciones: string | null;
  eleccion: boolean;
  sheets_tab: string | null;
  sheets_row: number | null;
}
