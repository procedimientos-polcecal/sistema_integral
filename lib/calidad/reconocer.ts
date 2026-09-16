import type { CarbonReal } from "./types";

/**
 * De una línea de orden de compra de Odoo a un movimiento de stock — o a la
 * bandeja.
 *
 * **Enlazar al que se le parece es peor que dejar en null.** Acá eso significa
 * que nada entra al stock por parecerse: el proveedor tiene que estar declarado
 * como carbonillero y el producto tiene que estar resuelto por id. Lo que no,
 * no entra **y se ve**.
 *
 * Función pura a propósito, como `lib/despacho/ordenDeCarbonilla.ts`: recibe
 * los catálogos ya traídos y devuelve la decisión, así se puede ver antes de
 * escribirla.
 *
 * Spec: docs/superpowers/specs/2026-09-16-calidad-stock-de-carbonilla-design.md
 */

/**
 * Lo que trajo un camión en todo un año, con margen.
 *
 * Atrapa los absurdos y no los verosímiles: la `P02304` con 38.660 —kilos
 * cargados como toneladas— y la `P02292` con 0. Un camión de 45 toneladas pasa,
 * porque pasó.
 */
export const TONELADAS_POSIBLES = { minimo: 0, maximo: 60 } as const;

export interface LineaDeOdoo {
  /** El id de la LÍNEA, no el de la orden: 7 de 577 órdenes del año tienen dos. */
  id: number;
  ordenNombre: string;
  /** `YYYY-MM-DD`, del `date_order` de la orden. */
  fecha: string;
  partnerId: number;
  partnerNombre: string;
  productoId: number;
  productoNombre: string;
  cantidad: number;
}

export interface CarbonilleroResuelto {
  id: string;
  carbon: CarbonReal;
  proveedorId: string | null;
}

export interface Catalogos {
  /** Por `odoo_partner_id`. */
  carbonilleros: Map<number, CarbonilleroResuelto>;
  /** Por `odoo_product_id` → `cuenta`. No estar no es lo mismo que estar en `false`. */
  productos: Map<number, boolean>;
}

export interface MovimientoNuevo {
  fecha: string;
  tipo: "entrada";
  carbon: CarbonReal;
  toneladas: number;
  carbonillero_id: string;
  proveedor_id: string | null;
  origen: "odoo";
  odoo_purchase_line_id: number;
  odoo_purchase_name: string;
  motivo: null;
}

export type Reconocimiento =
  | { resultado: "entra"; movimiento: MovimientoNuevo }
  | { resultado: "a_la_bandeja"; motivo: string }
  /** Resuelto que no cuenta —un flete—. Ni entra ni molesta. */
  | { resultado: "descartado" };

export function movimientoDesdeLaLineaDeOdoo(
  linea: LineaDeOdoo,
  catalogos: Catalogos
): Reconocimiento {
  // El proveedor primero: si no es carbonillero, el producto no importa.
  const carbonillero = catalogos.carbonilleros.get(linea.partnerId);
  if (!carbonillero) {
    return {
      resultado: "a_la_bandeja",
      motivo: `${linea.partnerNombre} (partner ${linea.partnerId}) no está declarado como carbonillero.`,
    };
  }

  const cuenta = catalogos.productos.get(linea.productoId);
  if (cuenta === undefined) {
    return {
      resultado: "a_la_bandeja",
      motivo: `El producto "${linea.productoNombre}" (id ${linea.productoId}) no está resuelto: hay que decir si cuenta como carbonilla o no.`,
    };
  }
  if (cuenta === false) return { resultado: "descartado" };

  if (
    !Number.isFinite(linea.cantidad) ||
    linea.cantidad <= TONELADAS_POSIBLES.minimo ||
    linea.cantidad > TONELADAS_POSIBLES.maximo
  ) {
    return {
      resultado: "a_la_bandeja",
      motivo: `${linea.cantidad} no es una cantidad posible para un camión (se esperan más de ${TONELADAS_POSIBLES.minimo} y hasta ${TONELADAS_POSIBLES.maximo} toneladas). Puede estar cargada en kilos.`,
    };
  }

  return {
    resultado: "entra",
    movimiento: {
      fecha: linea.fecha,
      tipo: "entrada",
      carbon: carbonillero.carbon,
      toneladas: Math.round(linea.cantidad * 1000) / 1000,
      carbonillero_id: carbonillero.id,
      proveedor_id: carbonillero.proveedorId,
      origen: "odoo",
      odoo_purchase_line_id: linea.id,
      odoo_purchase_name: linea.ordenNombre,
      motivo: null,
    },
  };
}
