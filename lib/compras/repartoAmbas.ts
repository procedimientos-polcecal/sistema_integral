/**
 * Cómo se parte un requerimiento que pagan las dos empresas.
 *
 * Un RI "AMBAS" (`empresa_id` null + `paga_ambas`) se convierte en **dos órdenes
 * de compra en Odoo**, una por empresa, porque el proveedor factura a cada CUIT
 * por separado. La regla acordada es **50/50**.
 *
 * Pasa en más de un tercio de los RI (ver `017_compras_schema.sql`), así que esto
 * no es un caso de borde: es el camino habitual.
 *
 * El reparto vive acá y no dentro de la sincronización a propósito: es una regla
 * de negocio de Compras, se muestra en pantalla antes de mandar nada a Odoo, y es
 * lo único de todo esto que se puede testear sin red.
 */

/** El porcentaje que se lleva la primera empresa. Hoy, la mitad. */
export const PORCENTAJE_AMBAS = 50;

export interface ParteDeReparto {
  porcentaje: number;
  /** El importe que le toca, ya redondeado al centavo. */
  importe: number;
  /** La cantidad que le toca. `null` si el RI no tiene cantidad cargada. */
  cantidad: number | null;
}

/**
 * Parte un importe entre las dos empresas sin perder ni inventar centavos.
 *
 * Redondear cada mitad por separado no sirve: la mitad de $100,01 es $50,005 dos
 * veces, y redondeando las dos hacia arriba las órdenes suman $100,02. Un centavo
 * de más en Odoo es una diferencia que alguien va a perseguir durante horas, y en
 * un tercio de los RI aparece seguido.
 *
 * Por eso se calcula en centavos, se redondea **una** parte y la otra es el
 * resto: las dos siempre suman exactamente el total.
 */
export function repartirImporte(
  total: number,
  porcentajePrimera: number = PORCENTAJE_AMBAS
): [number, number] {
  const centavos = Math.round(total * 100);
  const primera = Math.round((centavos * porcentajePrimera) / 100);

  return [primera / 100, (centavos - primera) / 100];
}

/**
 * El reparto completo de un RI compartido: importe y cantidad para cada empresa.
 *
 * El orden de las partes es el mismo que el de las empresas que se le pasen a la
 * sincronización; acá son sólo "primera" y "segunda".
 */
export function repartirAmbas(
  total: number,
  cantidad: number | null,
  porcentajePrimera: number = PORCENTAJE_AMBAS
): [ParteDeReparto, ParteDeReparto] {
  const [importePrimera, importeSegunda] = repartirImporte(total, porcentajePrimera);
  const porcentajeSegunda = 100 - porcentajePrimera;

  /*
   * La cantidad se parte con el mismo porcentaje que la plata, y no al entero
   * más cercano, porque en Odoo el importe de una línea **no se pone**: sale de
   * cantidad × precio unitario. Si se repartieran 3 unidades como 2 y 1
   * manteniendo el precio, las órdenes quedarían 67/33 y no 50/50.
   *
   * O sea que el 50/50 exacto y las cantidades enteras no pueden cumplirse las
   * dos a la vez. Se privilegia el importe, que es lo que se acordó, y
   * `cantidadQuedaFraccionada` permite avisar cuando el resultado no es entero.
   */
  const cantidadPrimera =
    cantidad === null ? null : redondearCantidad((cantidad * porcentajePrimera) / 100);
  const cantidadSegunda = cantidad === null ? null : redondearCantidad(cantidad - (cantidadPrimera ?? 0));

  return [
    { porcentaje: porcentajePrimera, importe: importePrimera, cantidad: cantidadPrimera },
    { porcentaje: porcentajeSegunda, importe: importeSegunda, cantidad: cantidadSegunda },
  ];
}

/**
 * ¿El reparto deja una cantidad que no es entera?
 *
 * Con un RI de 1 unidad —una bomba, un repuesto— el 50/50 da media unidad para
 * cada empresa, que como orden de compra no significa nada: nadie recibe media
 * bomba. Con 3 pasa lo mismo. No es un error del cálculo, es que el RI no se
 * puede partir en dos órdenes sin decidir algo más, y quien aprueba tiene que
 * verlo antes de que se mande a Odoo.
 */
export function cantidadQuedaFraccionada(
  cantidad: number | null,
  porcentajePrimera: number = PORCENTAJE_AMBAS
): boolean {
  if (cantidad === null) return false;
  if (!Number.isInteger(cantidad)) return false; // Ya venía fraccionada: kilos, metros, horas.

  const parte = (cantidad * porcentajePrimera) / 100;
  return !Number.isInteger(parte);
}

/**
 * Redondea a tres decimales.
 *
 * Es la precisión de cantidad que usa Odoo por defecto, y evita que `1.5000000002`
 * de la aritmética de punto flotante llegue a una orden de compra.
 */
function redondearCantidad(valor: number): number {
  return Math.round(valor * 1000) / 1000;
}
