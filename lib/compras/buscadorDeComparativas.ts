/**
 * Buscar entre las comparativas ya bajadas, por producto o por proveedor.
 *
 * Las comparativas viven en Drive y `/compras/comparativas/vincular` importa
 * sus filas a `compras_cotizaciones`. Hasta ahora eso sólo se podía mirar
 * desde adentro de un pedido: entrando al RI 1340 se ve lo que se cotizó para
 * el RI 1340. Lo que no había era la pregunta al revés —«¿cuándo pedimos esto
 * antes y a cuánto nos lo cotizaron?»— y ésa es la que contesta esta pantalla.
 *
 * ── POR QUÉ SE AGRUPA POR ARTÍCULO Y NO POR PEDIDO ──────────────────────────
 *
 * Porque agrupar por pedido no mostraría nada. Medido el 26/11/2026 sobre las
 * 1.078 cotizaciones importadas: están repartidas en 1.031 requerimientos, y
 * **1.002 de ésos tienen una sola cotización**. Sólo 29 pedidos tienen dos o
 * más, así que «la comparativa del pedido X» es casi siempre una fila sola.
 *
 * Donde sí hay historia es en el artículo: las mismas 1.078 cotizaciones caen
 * en 840 artículos, y **139 tienen dos o más**, con hasta 9 el más repetido.
 * Son los consumibles que se vuelven a pedir —correas, filtros, guantes—, que
 * es justo donde saber el precio anterior sirve para algo.
 *
 * El agrupador es `clave_articulo` y no la descripción: la clave es la
 * descripción normalizada, y es lo que hace que «CORREA C-153» y «Correa C
 * 153» sean el mismo artículo en vez de dos.
 *
 * ── LO QUE ESTA PANTALLA NO ES ─────────────────────────────────────────────
 *
 * No es el histórico de `lib/compras/historicoDelArticulo.ts`, aunque se
 * parezcan. Aquél mira `monto_conocido`, o sea **lo que la compra terminó
 * costando**, y se muestra adentro de un RI para el artículo de ese RI. Éste
 * mira lo que **se cotizó**, que es otra cosa: hay cotizaciones de proveedores
 * a los que después no se les compró, y son las que dejan comparar. Los dos
 * conviven a propósito.
 */

import { coincide } from "@/lib/core/texto";

/** Una cotización importada, con lo del pedido y del proveedor ya pegado. */
export interface CotizacionHistorica {
  id: string;
  requerimientoId: string;
  nroRi: number | null;
  /** Como la escribió quien cargó el pedido. Es lo que se muestra. */
  descripcion: string;
  /** La descripción normalizada. Es lo que agrupa. */
  claveArticulo: string;
  fecha: string | null;
  proveedorId: string;
  proveedor: string;
  marca: string | null;
  moneda: string;
  precioUnitario: number | null;
  precioTotal: number | null;
  cantidad: number | null;
  unidadMedida: string | null;
  condicionesPago: string | null;
  disponibilidad: string | null;
  /** El archivo de Drive del que salió, para poder volver a la planilla. */
  planillaId: string | null;
  planillaNombre: string | null;
}

export interface FiltrosDeBusqueda {
  texto?: string;
  proveedorId?: string;
}

/** Un artículo con todo lo que se le cotizó alguna vez. */
export interface GrupoDeArticulo {
  clave: string;
  descripcion: string;
  cotizaciones: CotizacionHistorica[];
  /** Cuántas cotizaciones tiene en total. */
  veces: number;
  /**
   * En cuántos pedidos distintos aparece, que no es lo mismo que `veces`.
   *
   * Es la diferencia entre una comparativa y un historial, y de los datos no
   * se deduce mirando sólo el total: el artículo más cotizado tiene 9
   * cotizaciones que son **todas del mismo RI** —dos proveedores compitiendo
   * por una compra— y «Filtro aceite motor» tiene 8 repartidas en pedidos de
   * siete meses distintos. La pantalla las muestra por separado porque quien
   * busca «qué salió la vez pasada» sólo puede contestarse con la segunda.
   */
  pedidos: number;
  proveedores: number;
  /** El piso y el techo del precio unitario, o null si no se puede decir. */
  rango: { moneda: string; minimo: number; maximo: number } | null;
}

/**
 * Las cotizaciones que responden a lo que se buscó.
 *
 * El texto se compara con `coincide()`, el mismo comparador de los
 * desplegables y del listado de órdenes de servicio: ignora los acentos y
 * acepta las palabras en cualquier orden, porque quien busca se acuerda de dos
 * pedazos del nombre y no de cómo estaban ordenados.
 *
 * Contra qué se compara es una decisión y no un descuido: la descripción, la
 * clave, **la marca** y el número de RI. La marca entra porque hay 302 marcas
 * distintas en lo importado y «SKF» es una forma legítima de buscar un
 * rulemán; el número de RI entra porque es lo que alguien tiene a mano cuando
 * viene de un correo. El proveedor **no** entra al texto: tiene su propio
 * desplegable, y dejarlo en los dos lados haría que elegir «Todo Ruleman» y
 * escribir «ruleman» devuelvan cosas distintas sin que se entienda por qué.
 */
export function buscarEnComparativas(
  cotizaciones: CotizacionHistorica[],
  { texto, proveedorId }: FiltrosDeBusqueda
): CotizacionHistorica[] {
  return cotizaciones.filter((c) => {
    if (proveedorId && c.proveedorId !== proveedorId) return false;
    if (!texto?.trim()) return true;

    const donde = [c.descripcion, c.claveArticulo, c.marca, c.nroRi]
      .filter((p) => p !== null && p !== undefined && p !== "")
      .join(" ");

    return coincide(donde, texto);
  });
}

/**
 * Las cotizaciones juntadas por artículo, de la más nueva a la más vieja.
 *
 * La cronología sale del **número de RI y no de la fecha**, por lo mismo que
 * `historicoDelArticulo`: la fecha de un requerimiento puede venir vacía —son
 * 2.159 filas que entraron desde una planilla— y el número siempre está. Entre
 * los 1.031 pedidos cotizados hoy no falta ninguna fecha, pero el importador
 * sigue pudiendo traer una fila sin ella, y ordenar por un campo que a veces
 * no está deja las filas en cualquier lado sin avisar.
 */
export function agruparPorArticulo(cotizaciones: CotizacionHistorica[]): GrupoDeArticulo[] {
  const porClave = new Map<string, CotizacionHistorica[]>();

  for (const c of cotizaciones) {
    const clave = c.claveArticulo || c.descripcion;
    const grupo = porClave.get(clave);
    if (grupo) grupo.push(c);
    else porClave.set(clave, [c]);
  }

  const grupos: GrupoDeArticulo[] = [];

  for (const [clave, filas] of porClave) {
    const ordenadas = [...filas].sort((a, b) => (b.nroRi ?? 0) - (a.nroRi ?? 0));

    grupos.push({
      clave,
      // La del pedido más nuevo: es como se llama hoy a ese artículo.
      descripcion: ordenadas[0].descripcion,
      cotizaciones: ordenadas,
      veces: ordenadas.length,
      pedidos: new Set(ordenadas.map((c) => c.requerimientoId)).size,
      proveedores: new Set(ordenadas.map((c) => c.proveedorId)).size,
      rango: rangoDePrecio(ordenadas),
    });
  }

  return grupos.sort(
    (a, b) => (b.cotizaciones[0].nroRi ?? 0) - (a.cotizaciones[0].nroRi ?? 0)
  );
}

/**
 * El piso y el techo del precio unitario de un artículo.
 *
 * Devuelve null cuando el grupo **mezcla monedas**, y eso no es un caso
 * teórico: de los 840 artículos cotizados hay uno así, porque entre las 1.078
 * cotizaciones hay una sola en dólares. Un mínimo que compara 1.000 pesos con
 * 1.000 dólares no está incompleto, está mal — es la misma regla que el embudo
 * del CRM, donde el monto no se convierte nunca. La pantalla lo dice en vez de
 * mostrar un número que no significa nada.
 *
 * Va el rango y no un promedio por la razón que ya dejó escrita
 * `resumenDelHistorico`: un solo número se lee como una promesa, y el precio
 * de un consumible salta.
 */
function rangoDePrecio(
  filas: CotizacionHistorica[]
): { moneda: string; minimo: number; maximo: number } | null {
  const conPrecio = filas.filter((c) => c.precioUnitario !== null);
  if (conPrecio.length === 0) return null;

  const monedas = new Set(conPrecio.map((c) => c.moneda));
  if (monedas.size > 1) return null;

  const precios = conPrecio.map((c) => c.precioUnitario as number);
  return {
    moneda: conPrecio[0].moneda,
    minimo: Math.min(...precios),
    maximo: Math.max(...precios),
  };
}
