/** Los tipos del módulo Calidad. Sin lógica: la lógica vive en los otros archivos. */

export type TipoDeMovimiento = "entrada" | "consumo" | "ajuste";

/**
 * `sin_separar` es historia, no saldo.
 *
 * El libro viejo no distinguía vegetal de residual hasta el 15/12/2025. Los
 * movimientos anteriores se importan con este valor y **no caen en ninguna suma
 * de saldo**, porque no son ninguno de los dos tipos. Un CHECK en la base le
 * prohíbe fechas posteriores al corte.
 */
export type TipoDeCarbon = "vegetal" | "residual" | "sin_separar";

/** Los dos que existen hoy. Es lo que se puede cargar y lo que tiene saldo. */
export type CarbonReal = Exclude<TipoDeCarbon, "sin_separar">;

export type OrigenDelMovimiento = "odoo" | "recepcion" | "manual" | "importacion";

export interface Movimiento {
  id: string;
  fecha: string;
  tipo: TipoDeMovimiento;
  carbon: TipoDeCarbon;
  /** Con signo: el efecto sobre el saldo. */
  toneladas: number;
  motivo: string | null;
  carbonillero_id: string | null;
  proveedor_id: string | null;
  origen: OrigenDelMovimiento;
  odoo_purchase_line_id: number | null;
  odoo_purchase_name: string | null;
  despacho_recepcion_id: string | null;
  sheets_fila: number | null;
  sheets_pendiente: string | null;
  sheets_pendiente_en: string | null;
  cargado_por: string | null;
  cargado_en: string;
  actualizado_por: string | null;
  actualizado_en: string | null;
}

export interface Carbonillero {
  id: string;
  odoo_partner_id: number;
  empresa_id: string;
  proveedor_id: string | null;
  carbon: CarbonReal;
  nombre_planilla: string;
  codigo_planilla: string;
  activo: boolean;
}

export interface ProductoDeOdoo {
  odoo_product_id: number;
  odoo_product_nombre: string;
  cuenta: boolean;
}

export interface Conteo {
  id: string;
  fecha: string;
  carbon: CarbonReal;
  toneladas_contadas: number;
  teorico_al_contar: number;
  ajuste_id: string | null;
  notas: string | null;
  cargado_por: string | null;
  cargado_en: string;
}

export interface LineaSinReconocer {
  odoo_purchase_line_id: number;
  odoo_purchase_name: string;
  odoo_partner_id: number;
  odoo_partner_nombre: string;
  odoo_product_id: number;
  odoo_product_nombre: string;
  fecha: string;
  toneladas: number;
  motivo: string;
  visto_en: string;
}
