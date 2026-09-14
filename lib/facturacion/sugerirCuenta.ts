/**
 * Qué cuenta contable le correspondería a una línea, según lo que ya hizo el
 * grupo.
 *
 * La cuenta se elegía a mano en cada línea, siempre. Y hay 11.013 líneas de
 * factura de proveedor en Odoo diciendo a qué cuenta fue cada compra: el dato
 * para proponerla estaba, sin usar.
 *
 * ## Los umbrales salen de un backtest, no de una corazonada
 *
 * Se aprendió de las 8.700 líneas más viejas y se predijeron las 2.200 más
 * nuevas —nunca con las mismas con que se aprendió—, en cascada
 * proveedor+producto y, si no hay, proveedor solo:
 *
 * | Confianza mínima | Propone en | Acierta | Resuelve del total |
 * |---|---|---|---|
 * | sin umbral | 94% | 76,3% | 71% |
 * | 0,7 | 69% | 87,2% | 60% |
 * | **0,8** | **64%** | **89,3%** | **58%** |
 * | 0,9 | 57% | 90,4% | 51% |
 *
 * Se eligió **0,8**: subir a 0,9 gana un punto de acierto y pierde siete de
 * cobertura. Y se exigen **dos antecedentes**, porque una sola compra anterior
 * no es una costumbre.
 *
 * ## Por qué propone y no completa
 *
 * Un 89% de acierto es mucho para ahorrar trabajo y **poco para decidir solo**:
 * una de cada diez iría a la cuenta equivocada, y un gasto mal imputado no se
 * nota nunca. Así que la sugerencia se muestra con **el antecedente a la vista**
 * —"18 de 20 veces fue a Repuestos"— y no se guarda hasta que alguien la aplica.
 * Todo lo que queda guardado lo eligió una persona.
 */

/** Cuántas veces esta compra fue a cada cuenta. Por id de `account.account`. */
export type VecesPorCuenta = Record<string, number>;

export interface HistorialDeCuentas {
  /** Por `product.product`: a qué cuenta fue esa compra a este proveedor. */
  porProducto: Record<string, VecesPorCuenta>;
  /** Lo mismo sin mirar el producto, para cuando no hay historia del producto. */
  delProveedor: VecesPorCuenta;
  /** El nombre de cada cuenta, para poder mostrar la sugerencia. */
  nombres: Record<string, string>;
}

export interface SugerenciaDeCuenta {
  cuentaId: number;
  nombre: string;
  /** Cuántas veces fue a esa cuenta, y sobre cuántas. Es la evidencia. */
  veces: number;
  total: number;
  /** De dónde salió, que cambia cuánto confiar. */
  segun: "este proveedor y este producto" | "este proveedor";
}

/** Lo medido: menos de esto no es una costumbre, es una coincidencia. */
const ANTECEDENTES_MINIMOS = 2;
const CONFIANZA_MINIMA = 0.8;

function laMasUsada(veces: VecesPorCuenta): { cuentaId: number; veces: number; total: number } | null {
  const entradas = Object.entries(veces);
  if (!entradas.length) return null;

  const total = entradas.reduce((a, [, n]) => a + n, 0);
  const [cuentaId, cuantas] = entradas.sort((a, b) => b[1] - a[1])[0];

  return { cuentaId: Number(cuentaId), veces: cuantas, total };
}

function bastanteFirme(candidato: { veces: number; total: number }): boolean {
  return candidato.veces >= ANTECEDENTES_MINIMOS && candidato.veces / candidato.total >= CONFIANZA_MINIMA;
}

/**
 * La cuenta que se propone para una línea, o `null` si no hay con qué.
 *
 * Primero lo que este proveedor facturó de **este producto**, que es lo más
 * específico; si de eso no hay suficiente, lo que este proveedor factura en
 * general. Nunca al revés: el producto manda sobre el promedio del proveedor.
 */
export function sugerirCuenta(
  productoId: number | null,
  historial: HistorialDeCuentas
): SugerenciaDeCuenta | null {
  const candidatos: { candidato: ReturnType<typeof laMasUsada>; segun: SugerenciaDeCuenta["segun"] }[] = [
    {
      candidato: productoId === null ? null : laMasUsada(historial.porProducto[String(productoId)] ?? {}),
      segun: "este proveedor y este producto",
    },
    { candidato: laMasUsada(historial.delProveedor), segun: "este proveedor" },
  ];

  for (const { candidato, segun } of candidatos) {
    if (!candidato || !bastanteFirme(candidato)) continue;
    return {
      cuentaId: candidato.cuentaId,
      nombre: historial.nombres[String(candidato.cuentaId)] ?? `#${candidato.cuentaId}`,
      veces: candidato.veces,
      total: candidato.total,
      segun,
    };
  }

  return null;
}

/** Cómo se lee la evidencia en pantalla. Sin esto la sugerencia es magia. */
export function porQueSeSugiere(s: SugerenciaDeCuenta): string {
  return s.veces === s.total
    ? `las ${s.total} veces anteriores fue a esta cuenta, según ${s.segun}`
    : `${s.veces} de ${s.total} veces fue a esta cuenta, según ${s.segun}`;
}
