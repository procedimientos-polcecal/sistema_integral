/** Una fila de `taller_vial_cargas`: una carga de combustible con su lectura de horómetro/km. */
export interface CargaDB {
  id: string;
  equipo_id: string | null;
  equipo_raw: string;
  fecha: string;
  litros: number;
  lectura: number | null;
  observaciones: string | null;
  cargado_por: string | null;
  cargado_en: string;
  actualizado_por: string | null;
  actualizado_en: string | null;
  /** Lo que dijo Google si falló la exportación hacia la planilla al cargar esto desde el SdG. Null si no se intentó o si salió bien. */
  sheets_pendiente: string | null;
}

/** Una fila de `taller_vial_estados_diarios`: el estado de un equipo en un día. */
export interface EstadoDiarioDB {
  id: string;
  equipo_id: string;
  fecha: string;
  estado: string;
  observaciones: string | null;
  cargado_por: string | null;
  /** Lo que dijo Google si falló la exportación hacia la planilla al cargar esto desde el SdG. Null si no se intentó o si salió bien. */
  sheets_pendiente: string | null;
}

/** Una fila de `taller_vial_services`: un service realizado a un equipo, a un horómetro y en un escalón. */
export interface ServiceDB {
  id: string;
  equipo_id: string;
  tier: number;
  fecha: string;
  horometro: number;
  observaciones: string | null;
  cargado_por: string | null;
  cargado_en: string;
}

/** Una fila de `taller_vial_reparaciones`: una intervención realizada a un equipo. */
export interface ReparacionDB {
  id: string;
  equipo_id: string;
  tipo: string;
  fecha: string;
  descripcion: string;
  horas: number | null;
  horometro: number | null;
  observaciones: string | null;
  cargado_por: string | null;
  cargado_en: string;
}

/**
 * Un repuesto del pañol reservado para un service o una reparación.
 * `estado: "reservado"` no descontó stock todavía; `"confirmado"` sí, y trae
 * `movimiento_id` puesto — ver la migración 20260917105422.
 */
export interface RepuestoAsignadoDB {
  id: string;
  service_id: string | null;
  reparacion_id: string | null;
  articulo_id: string;
  cantidad: number;
  estado: "reservado" | "confirmado";
  movimiento_id: string | null;
  cargado_por: string | null;
  cargado_en: string;
  confirmado_por: string | null;
  confirmado_en: string | null;
}

/** Un repuesto asignado, con los datos del artículo ya resueltos — lo que muestra la pantalla. */
export interface RepuestoAsignadoConArticulo extends RepuestoAsignadoDB {
  articulo_codigo: string;
  articulo_descripcion: string;
}

/**
 * Una fila de `taller_vial_partes`: un bloque de trabajo (equipo + sector +
 * horario) de un parte diario, importado del Google Form "PARTE DIARIO
 * EQUIPOS MÓVILES" — ver `lib/tallerVial/importarPartes.ts`.
 */
export interface ParteTallerVialDB {
  id: string;
  marca_temporal: string;
  bloque: number;
  fecha: string;
  operario_raw: string;
  operario_id: string | null;
  equipo_raw: string;
  equipo_id: string | null;
  sector_raw: string;
  yacimiento_destape_codigo: string | null;
  hora_inicio: string | null;
  hora_fin: string | null;
  horas: number | null;
  cargaste_todo: string | null;
  observaciones: string | null;
  destape_id: string | null;
  cargado_en: string;
}
