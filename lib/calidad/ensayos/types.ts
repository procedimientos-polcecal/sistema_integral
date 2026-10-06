/** Los tipos del frente de ensayos. Sin lógica: la lógica vive en los otros archivos. */

export type GrupoDeProducto = "produccion" | "proceso";

export type Determinacion =
  | "humedad"
  | "peso_volumetrico"
  | "cal_util_vial"
  | "retenido"
  | "acumulado";

export interface ProductoDeEnsayo {
  id: string;
  nombre: string;
  grupo: GrupoDeProducto;
  orden: number;
  /** El juego habitual de tamices que la pantalla de carga propone. */
  mallas: number[];
  activo: boolean;
}

/**
 * Una muestra: producto y fecha, y las cuatro determinaciones como columnas
 * opcionales.
 *
 * **No hay un solo porcentaje acá.** Se guardan gramos, ml y centímetros
 * cúbicos; la humedad, los retenidos, los acumulados y el g/l se despejan al
 * leer. Es la corrección directa de lo que se midió en el Excel que esto
 * reemplaza, donde la misma columna estaba guardada en dos escalas y la única
 * señal era el formato de la celda.
 */
export interface Muestra {
  id: string;
  fecha: string;
  producto_id: string;
  observaciones: string | null;
  humedad_p_recipiente: number | null;
  humedad_p_inicial: number | null;
  humedad_p_final: number | null;
  peso_vol_gramos: number | null;
  peso_vol_volumen_cc: number | null;
  cal_util_ml_acido: number | null;
  cal_util_peso_muestra_g: number | null;
  granulometria_peso_muestra_g: number | null;
  cargado_por: string | null;
  cargado_en: string;
  actualizado_por: string | null;
  actualizado_en: string | null;
}

export interface Retenido {
  muestra_id: string;
  malla: number;
  retenido_g: number;
}

export interface Limite {
  id: string;
  producto_id: string;
  determinacion: Determinacion;
  /** Sólo para `retenido` y `acumulado`; null en las otras tres. */
  malla: number | null;
  minimo: number | null;
  maximo: number | null;
}

/** De qué lado del límite se fue. */
export type LadoDelDesvio = "alto" | "bajo";

/**
 * El resultado de una determinación.
 *
 * `valor` en null es "no se puede calcular": falta un dato, o la cuenta divide
 * por cero. `problema` **acompaña al valor en vez de reemplazarlo**: una
 * humedad negativa se muestra, con el aviso al lado. Recortarla a cero
 * escondería justo lo que hay que corregir — es la misma regla que la
 * producción negativa en Producción.
 */
export interface ValorEvaluado {
  valor: number | null;
  problema?: string;
  fuera?: LadoDelDesvio;
}
