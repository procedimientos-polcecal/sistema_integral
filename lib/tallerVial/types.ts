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
}
