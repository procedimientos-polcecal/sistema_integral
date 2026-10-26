/**
 * Lo que este proveedor factura **siempre igual**.
 *
 * ## Qué problema resuelve
 *
 * Hay proveedores que facturan lo mismo todos los meses: un flete, un abono, un
 * servicio. Para ésos, elegir producto, cuenta y analítica en cada factura es
 * copiar a mano lo que ya se copió el mes pasado — y para una factura sin
 * detalle legible, que entra con una sola línea por el total, es *todo* el
 * trabajo que hay que hacer.
 *
 * ## Por qué no sirve el aprendizaje que ya había
 *
 * `sugerirProducto` aprende por **descripción** (`compras_producto_odoo`,
 * indexada por `descripcion_normalizada`). La descripción de la línea del total
 * es `Factura C 0003-00000108`: **única por factura**, así que no coincide con
 * nada nunca. La clave acá tiene que ser el proveedor.
 *
 * ## La regla: unanimidad, y por qué se pone en vez de sugerirse
 *
 * El resto de las propuestas del módulo **no se pre-llenan**, a propósito: la
 * de cuenta acierta el 89% y la de analítica el 78%, que es mucho para ahorrar
 * trabajo y poco para decidir solas. Esto no baja esa vara, **la parte en dos**:
 *
 * - **Unánime** — las últimas `CUANTAS` facturas de ese proveedor fueron todas
 *   al mismo producto, la misma cuenta y el mismo reparto → se pone.
 * - **Cualquier otra cosa** → no se pone nada, y siguen valiendo las
 *   sugerencias por mayoría que ya existen.
 *
 * ## Los números que eligieron el umbral
 *
 * Medido el 26/10/2026 sobre las 5.419 líneas de las 3.144 facturas de
 * proveedor posteadas de 2026, de 419 proveedores:
 *
 * | últimas | proveedores con esa historia | unánimes | facturas que cubren |
 * |---|---|---|---|
 * | 2  | 280 | 112 (40%) | 37% |
 * | 3  | 220 |  72 (33%) | **30%** |
 * | 5  | 171 |  44 (26%) | 22% |
 * | 10 |  98 |  12 (12%) | 11% |
 *
 * Se eligió **3**: cubre una de cada tres facturas, y "tres seguidas iguales"
 * es una definición defendible de *siempre*. Con 2 se ganan siete puntos a
 * cambio de que dos casualidades alcancen para dar algo por sabido.
 *
 * Y lo que convenció más que el porcentaje fue **quién cae de cada lado**:
 * unánimes son RUBIALES (115 facturas), EXPRESO 7400, TELEFÓNICA, LOMA NEGRA
 * —fletes y servicios—; no unánimes son ZITO Y PRIOLA (166) y REPUESTOS
 * AGRÍCOLAS COLON —repuestos y materiales, que son distintos cada vez—. La
 * regla separa sola lo que una persona separaría.
 */

import type { DistribucionAnalitica } from "./lineas";

/** Cuántas facturas hacia atrás se miran. Ver la tabla del encabezado. */
export const CUANTAS = 3;

/** Una línea de una factura que ya se contabilizó en Odoo. */
export interface LineaContabilizada {
  productoId: number | null;
  productoNombre: string | null;
  cuentaId: number | null;
  cuentaNombre: string | null;
  analitica: DistribucionAnalitica | null;
}

/** Una factura anterior de ese proveedor, con las líneas que tuvo. */
export interface FacturaAnterior {
  lineas: LineaContabilizada[];
}

/** Lo que se le pone a la línea nueva, cuando hay algo que poner. */
export interface LoQueSeRepite {
  productoId: number | null;
  productoNombre: string | null;
  cuentaId: number | null;
  cuentaNombre: string | null;
  analitica: DistribucionAnalitica | null;
  /** Para mostrarlo: "las últimas 3 de este proveedor fueron todas así". */
  porque: string;
}

/** Dos imputaciones son la misma si coinciden en los tres campos. */
function firma(l: LineaContabilizada): string {
  const reparto = l.analitica
    ? Object.entries(l.analitica)
        .map(([k, v]) => `${k}:${v}`)
        .sort()
        .join("+")
    : "-";
  return `${l.productoId ?? "-"}|${l.cuentaId ?? "-"}|${reparto}`;
}

/**
 * Qué imputación repite este proveedor, si repite alguna.
 *
 * Las facturas llegan **de la más nueva a la más vieja**. Se devuelve `null`
 * —y no una propuesta débil— en los cuatro casos en que no hay unanimidad:
 * poca historia, alguna factura con más de una imputación adentro, imputaciones
 * distintas entre facturas, o una factura sin líneas.
 */
export function laLineaQueSeRepite(
  anteriores: readonly FacturaAnterior[],
  cuantas: number = CUANTAS
): LoQueSeRepite | null {
  const ultimas = anteriores.slice(0, cuantas);
  if (ultimas.length < cuantas) return null;

  let comun: LineaContabilizada | null = null;
  let firmaComun: string | null = null;

  for (const factura of ultimas) {
    if (!factura.lineas.length) return null;

    /*
     * Una factura con varias imputaciones distintas adentro no dice "siempre
     * lo mismo", dice "varias cosas". No se promedia ni se elige la mayoritaria:
     * eso es justo lo que convertiría una regla de certeza en una estadística.
     */
    const firmas = new Set(factura.lineas.map(firma));
    if (firmas.size !== 1) return null;

    const actual = [...firmas][0];
    if (firmaComun === null) {
      firmaComun = actual;
      comun = factura.lineas[0];
    } else if (actual !== firmaComun) {
      return null;
    }
  }

  if (!comun) return null;

  /*
   * Una imputación vacía no es un antecedente. Tres facturas sin producto, sin
   * cuenta y sin reparto son unánimes en no decir nada, y poner eso sería
   * afirmar que se aprendió algo.
   */
  if (comun.productoId === null && comun.cuentaId === null && !comun.analitica) return null;

  return {
    productoId: comun.productoId,
    productoNombre: comun.productoNombre,
    cuentaId: comun.cuentaId,
    cuentaNombre: comun.cuentaNombre,
    analitica: comun.analitica,
    porque: `las últimas ${cuantas} de este proveedor fueron todas así`,
  };
}
