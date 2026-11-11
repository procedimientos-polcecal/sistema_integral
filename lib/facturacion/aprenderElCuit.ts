/**
 * Guardarle al proveedor del padrón el CUIT que trajo la factura.
 *
 * ## Por qué
 *
 * El padrón del SdG tiene **479 proveedores y 311 sin CUIT** (al 11/11/2026),
 * y sin CUIT no se engancha nada solo: ni el proveedor de la factura que entra,
 * ni el cruce con Odoo. Exportar Odoo y emparejar por nombre **no lo resuelve**
 * —medido: de los 118 proveedores sin CUIT que tienen actividad, sólo 9
 * coinciden por nombre, y los otros 109 no están en Odoo con ese nombre—.
 *
 * Pero el dato **ya pasa por el sistema y nadie lo escribe**: cada factura que
 * entra trae el CUIT del emisor firmado por ARCA, y el alta deja el aviso «el
 * CUIT no figura en ningún proveedor del padrón; cargáselo para que se enganche
 * sola la próxima». Esto es ese «cargáselo», hecho de a un clic y sólo sobre
 * los proveedores que efectivamente facturan — que son justo los que importan.
 *
 * ## Quién decide
 *
 * **Una persona, siempre.** Acá no se adivina a qué proveedor del padrón
 * corresponde el CUIT: eso lo elige quien está mirando la factura. Lo único que
 * hace esta función es decir si ese CUIT **se puede** guardar, que es otra cosa.
 */

import { normalizarCuit } from "@/lib/core/cuit";

export interface QueSeSabe {
  /** El CUIT del emisor, como vino de la factura. */
  cuitDeLaFactura: string | null;
  /** Lo que el proveedor elegido tiene hoy. */
  cuitDelProveedor: string | null;
  /** Los CUIT que ya usa el padrón, **sin contar el del proveedor elegido**. */
  cuitsDeOtrosProveedores: readonly string[];
}

export type Veredicto =
  | { se: true; cuit: string }
  | { se: false; porque: string };

export function sePuedeAprenderElCuit({
  cuitDeLaFactura,
  cuitDelProveedor,
  cuitsDeOtrosProveedores,
}: QueSeSabe): Veredicto {
  const cuit = normalizarCuit(cuitDeLaFactura);
  if (!cuit) {
    return { se: false, porque: "La factura no trae el CUIT del emisor." };
  }

  /*
   * **Un CUIT que ya está no se pisa.** Si el proveedor tiene otro, o es el
   * proveedor equivocado o el padrón estaba mal, y las dos cosas las resuelve
   * una persona mirando — no una escritura que se lleva por delante un dato
   * que alguien puso.
   */
  const actual = normalizarCuit(cuitDelProveedor);
  if (actual && actual !== cuit) {
    return {
      se: false,
      porque:
        `Ese proveedor ya tiene el CUIT ${cuitDelProveedor} y la factura dice ${cuit}. ` +
        "Si el del padrón está mal, corregilo desde el proveedor.",
    };
  }
  if (actual === cuit) {
    return { se: false, porque: "Ese proveedor ya tiene ese CUIT." };
  }

  /*
   * Y no se crea un duplicado. Es la misma trampa que apareció llenando CUIT
   * por nombre el 11/11/2026: el padrón tiene la misma empresa cargada más de
   * una vez —«Marfra» y «FERRETERIA MARFRA», y los tres vendedores de ZITO Y
   * PRIOLA con el CUIT de la empresa—, y dos filas con el mismo CUIT son
   * exactamente las que `cruzarProveedores` se niega a enlazar. Enlazar de más
   * no es mejor que no enlazar: es un enlace que después hay que deshacer.
   */
  const ocupado = cuitsDeOtrosProveedores.some((c) => normalizarCuit(c) === cuit);
  if (ocupado) {
    return {
      se: false,
      porque:
        `Ese CUIT ya lo tiene otro proveedor del padrón. Probablemente sea la misma empresa ` +
        "cargada dos veces: conviene usar ésa, o fusionarlas.",
    };
  }

  return { se: true, cuit };
}
