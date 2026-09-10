/** El tipo de piedra de un yacimiento. La densidad va con esto. */
export type Material = "Dolomita" | "Chocolata" | "Caliza" | "Arcilla";

/** Cómo se clasifica un renglón de consumo, calcado de la columna "Tipo" de CONSUMOS. */
export type TipoDeConsumo = "detonador" | "otros_insumos" | "voladura";

/** De dónde salió una fila: cargada en el SdG o traída por la importación inicial. */
export type OrigenDeRegistro = "sdg" | "importacion";

export interface Yacimiento {
  id: string;
  codigo: string;
  nombre: string;
  material: string;
  densidad_t_m3: number;
  burden_m: number | null;
  espaciamiento_m: number | null;
  activo: boolean;
  orden: number;
}

export interface Insumo {
  id: string;
  nombre: string;
  tipo: string;
  precio_usd: number | null;
  activo: boolean;
  orden: number;
}

export interface Consumo {
  id: string;
  voladura_codigo: string;
  insumo_id: string | null;
  insumo_raw: string | null;
  tipo: string | null;
  cantidad: number;
  precio_usd: number | null;
  orden: number;
}

/** Una fila de `cantera_voladuras`, tal como viene de la base. */
export interface Voladura {
  id: string;
  codigo: string;
  yacimiento_id: string;
  anio: number;
  correlativo: number;

  perf_inicio: string | null;
  perf_fin: string | null;
  pozos: number | null;
  metros_por_pozo: number | null;
  burden_m: number | null;
  espaciamiento_m: number | null;
  perf_precio_usd_m: number | null;
  perf_tc_usd: number | null;
  perf_odoo_move_id: number | null;
  perf_odoo_move_name: string | null;
  perf_odoo_empresa: string | null;
  perf_odoo_ref: string | null;
  perf_odoo_importe: number | null;
  perf_odoo_leido_en: string | null;
  perf_conforme: boolean | null;
  perf_conforme_obs: string | null;
  perf_conforme_por: string | null;
  perf_conforme_en: string | null;

  vol_fecha_carga: string | null;
  vol_fecha: string | null;
  vol_pozos: number | null;
  vol_metros_por_pozo: number | null;
  vol_burden_m: number | null;
  vol_espaciamiento_m: number | null;
  vol_tc_usd: number | null;
  explosivos_raw: string | null;
  toneladas_planilla: number | null;
  vol_odoo_move_id: number | null;
  vol_odoo_move_name: string | null;
  vol_odoo_empresa: string | null;
  vol_odoo_ref: string | null;
  vol_odoo_importe: number | null;
  vol_odoo_leido_en: string | null;
  vol_conforme: boolean | null;
  vol_conforme_obs: string | null;
  vol_conforme_por: string | null;
  vol_conforme_en: string | null;

  observaciones: string | null;
  origen: string;
  sheets_pendiente: string | null;
  sheets_pendiente_en: string | null;
  cargado_por: string | null;
  cargado_en: string;
  actualizado_por: string | null;
  actualizado_en: string | null;
}

/** Una fila de `cantera_bochones`. */
export interface Bochon {
  id: string;
  codigo: string;
  yacimiento_id: string;
  anio: number;
  correlativo: number;
  voladura_codigo: string | null;
  inicio: string | null;
  fin: string | null;
  pozos: number | null;
  metros_perforados: number | null;
  precio_usd_m: number | null;
  tc_usd: number | null;
  odoo_move_id: number | null;
  odoo_move_name: string | null;
  odoo_empresa: string | null;
  odoo_ref: string | null;
  odoo_importe: number | null;
  odoo_leido_en: string | null;
  conforme: boolean | null;
  conforme_obs: string | null;
  conforme_por: string | null;
  conforme_en: string | null;
  observaciones: string | null;
  origen: string;
  sheets_pendiente: string | null;
  sheets_pendiente_en: string | null;
  cargado_por: string | null;
  cargado_en: string;
  actualizado_por: string | null;
  actualizado_en: string | null;
}
