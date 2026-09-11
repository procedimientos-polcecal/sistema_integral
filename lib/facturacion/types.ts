/** Por dónde entró la factura. Los cuatro valores que acepta el `check`. */
export type OrigenDeFactura = "mail" | "papel" | "whatsapp" | "carga manual";

/** Si los datos los leyó el QR o los tipeó una persona. */
export type IdentificadoPor = "qr" | "a mano";

export type EstadoDeFactura = "recibida" | "vinculada" | "informada" | "contabilizada";

/** Una fila de `facturas_proveedor`, como viene de la base. */
export interface FacturaProveedor {
  id: string;
  cuit_emisor: string | null;
  tipo_comprobante: number | null;
  punto_venta: number | null;
  numero: number | null;
  fecha: string | null;
  importe_total: number | null;
  moneda: string;
  cae: string | null;
  empresa_id: string | null;
  proveedor_id: string | null;
  requerimiento_id: string | null;
  archivo_url: string | null;
  archivo_nombre: string | null;
  origen: OrigenDeFactura;
  identificado_por: IdentificadoPor;
  estado: EstadoDeFactura;
  odoo_move_id: number | null;
  /** `BILL/2026/09/0004`. En borrador Odoo lo deja en `/`: numera al postear. */
  odoo_nombre: string | null;
  /** `draft`, `posted` o `cancel`, como se vio en la última sincronización. */
  odoo_estado: string | null;
  /** `push`, `numero`, `referencia` o `a mano`. Ver la migración del vínculo con Odoo. */
  odoo_conciliado_por: string | null;
  /** Lo que dijo Odoo cuando algo falló, sin traducir. */
  odoo_pendiente: string | null;
  odoo_sincronizado_en: string | null;
  notas: string | null;
  cargado_por: string | null;
  created_at: string;
  updated_at: string;
}

/** Lo mismo, con los nombres resueltos para la pantalla. */
export interface FacturaEnPantalla extends FacturaProveedor {
  empresa: string | null;
  proveedor: string | null;
  /** El Nº del requerimiento al que se vinculó, cuando hay uno. */
  requerimiento: string | null;
}
