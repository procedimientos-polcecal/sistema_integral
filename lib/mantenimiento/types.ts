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
