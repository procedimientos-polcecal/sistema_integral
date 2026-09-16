import { fechaDeSheets } from "@/lib/core/fechaDeSheets";
import { CORTE_DE_LOS_TIPOS } from "./movimientos";
import type { CarbonReal, TipoDeCarbon, TipoDeMovimiento } from "./types";

/**
 * De un renglón de la planilla vieja a un movimiento del libro.
 *
 * Función pura: no habla con Sheets ni con Supabase. La lee
 * `scripts/importar-stock-carbonilla.mts`, que corre una sola vez.
 *
 * **EL LIBRO TIENE TRES ERAS Y ESTA FUNCIÓN LAS CONOCE:**
 *
 *   07/01 → 25/08/2025   sólo consumos, sin entradas y sin saldo
 *   26/08 → 14/12/2025   entradas y consumos, **un solo saldo**
 *   15/12/2025 → hoy     los dos saldos
 *
 * Todo lo anterior al 15/12/2025 entra con `carbon = 'sin_separar'`, **pase lo
 * que pase con el catálogo**: marcar esos once meses como vegetal sería
 * inventar, porque en esa época Membranex entró más de veinte veces con carbón
 * residual y hubo 82 consumos residuales desde el 13/10. Un CHECK en la base
 * impide que ese valor aparezca con fecha posterior.
 *
 * Spec: docs/superpowers/specs/2026-09-16-calidad-stock-de-carbonilla-design.md
 */

/** Las columnas de `Entradas  Salidas`, por índice. */
const COL = {
  codigo: 0,
  descripcion: 1,
  entradas: 2,
  salidas: 3,
  total: 4,
  vegetal: 5,
  residual: 6,
  fecha: 7,
  stockFisico: 8,
  error: 9,
} as const;

/** Los códigos que no son un carbonillero sino un consumo. */
const CONSUMOS: Record<string, CarbonReal | "sin_tipo"> = {
  "00015": "vegetal",
  "00016": "residual",
  // El `CONSUMO` a secas vivió del 29/08 al 20/11/2025, cuando el libro no
  // distinguía. No se le puede poner tipo sin inventarlo.
  "00001": "sin_tipo",
};

export type CatalogoDeLaPlanilla = Map<string, { id: string; carbon: CarbonReal }>;

export interface MovimientoImportado {
  fecha: string;
  tipo: TipoDeMovimiento;
  carbon: TipoDeCarbon;
  /** Con signo, como se guarda. */
  toneladas: number;
  motivo: string | null;
  carbonillero_id: string | null;
  origen: "importacion";
  /** La fila real del libro, para que una corrección reescriba la misma. */
  sheets_fila: number;
}

export interface ConteoImportado {
  fecha: string;
  carbon: CarbonReal;
  toneladas_contadas: number;
  teorico_al_contar: number;
}

export type RenglonImportado =
  | { clase: "movimiento"; movimiento: MovimientoImportado; conteo?: ConteoImportado }
  | { clase: "sin_importar"; motivo: string }
  | { clase: "vacia" };

function numero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function aTresDecimales(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function movimientoDesdeElRenglon(
  celdas: unknown[],
  fila: number,
  catalogo: CatalogoDeLaPlanilla
): RenglonImportado {
  const codigo = String(celdas[COL.codigo] ?? "").trim();
  const descripcion = String(celdas[COL.descripcion] ?? "").trim();
  if (!codigo && !descripcion) return { clase: "vacia" };

  const fecha = fechaDeSheets(celdas[COL.fecha]);
  if (!fecha) {
    return {
      clase: "sin_importar",
      motivo: `La fila ${fila} (${descripcion || codigo}) no tiene fecha, así que no hay dónde ponerla en el libro.`,
    };
  }

  const entradas = numero(celdas[COL.entradas]);
  const salidas = numero(celdas[COL.salidas]);
  if (!entradas && !salidas) {
    return {
      clase: "sin_importar",
      motivo: `La fila ${fila} (${descripcion || codigo}, ${fecha}) no tiene ni entrada ni salida.`,
    };
  }

  // ANTES DEL CORTE NO SE SABE EL TIPO, y eso gana sobre todo lo demás.
  const antesDelCorte = fecha < CORTE_DE_LOS_TIPOS;

  const consumo = CONSUMOS[codigo];
  const carbonillero = consumo ? undefined : catalogo.get(codigo);

  if (!consumo && !carbonillero) {
    return {
      clase: "sin_importar",
      motivo: `La fila ${fila} (${fecha}) usa el código ${codigo} "${descripcion}", que no está declarado como carbonillero. No se enlaza al que se le parece.`,
    };
  }

  const tipoDeCarbon: TipoDeCarbon = antesDelCorte
    ? "sin_separar"
    : consumo
      ? consumo === "sin_tipo"
        // Un `CONSUMO` a secas después del corte no existió nunca (murió el
        // 20/11/2025), pero si apareciera no se adivina.
        ? "sin_separar"
        : consumo
      : carbonillero!.carbon;

  // El texto en la columna del conteo físico es lo que hoy delata un ajuste
  // disfrazado de consumo: el 20/04 dice "AJUSTE DE STOCK (-46 Tn.)".
  const stockFisico = celdas[COL.stockFisico];
  const contadas = numero(stockFisico);
  const textoDelAjuste =
    contadas === null && String(stockFisico ?? "").trim() ? String(stockFisico).trim() : null;

  const magnitud = entradas ?? salidas ?? 0;
  const enMas = Boolean(entradas);

  const tipo: TipoDeMovimiento = textoDelAjuste ? "ajuste" : consumo ? "consumo" : "entrada";
  const toneladas = aTresDecimales(enMas ? magnitud : -magnitud);

  const movimiento: MovimientoImportado = {
    fecha,
    tipo,
    carbon: tipoDeCarbon,
    toneladas,
    motivo: textoDelAjuste,
    carbonillero_id: tipo === "entrada" ? (carbonillero?.id ?? null) : null,
    origen: "importacion",
    sheets_fila: fila,
  };

  // El conteo sólo sale si se sabe de qué tipo es: antes del corte el número
  // existía pero no tenía a qué saldo pertenecer.
  const teorico = numero(celdas[COL.total]);
  const conteo: ConteoImportado | undefined =
    contadas !== null && !antesDelCorte && tipoDeCarbon !== "sin_separar" && teorico !== null
      ? { fecha, carbon: tipoDeCarbon, toneladas_contadas: contadas, teorico_al_contar: teorico }
      : undefined;

  return conteo ? { clase: "movimiento", movimiento, conteo } : { clase: "movimiento", movimiento };
}
