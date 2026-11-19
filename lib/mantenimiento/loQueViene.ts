/**
 * La cuenta de lo que viene: cuánto de lo que está en camino ya tiene dueño.
 *
 * Es aritmética pura, sin base ni red, y **no se guarda**: se recalcula cada vez
 * que se mira, con los RI pegados a mano y las órdenes abiertas que le pasen.
 * Cuatro decisiones que el código no delata:
 *
 * **El stock del pañol no descuenta.** Si la orden necesita 80 y hay 61 en el
 * estante, igual toma los 80 de lo que viene. Pedir sólo la diferencia deja el
 * estante en cero apenas se hace el trabajo, y Compras repone cuando de verdad
 * se usó —no antes—. Descontar el pañol acá haría que todas las órdenes
 * parezcan cubiertas con lo mismo que ya se va a gastar.
 *
 * **Lo que viene es lo pedido menos lo que ya llegó.** Contar un RI recibido
 * como «en camino» lo cuenta dos veces: una como stock del pañol y otra como
 * pendiente. Medido en producción (13/11/2026): `cantidad_recibida` es mayor
 * que cero en 1.653 de 2.304 requerimientos, así que no es un caso borde.
 * Y `cantidad` es null en 90 de 2.304: sin número legible un RI trae 0, no se
 * inventa.
 *
 * **El desempate es el número de OT, ascendente.** No es un detalle mecánico:
 * la única competencia real hoy es un empate triple —las órdenes 2896, 2897 y
 * 2898 llevan todas `fecha = 2026-10-26`—. Sin una regla, el orden lo decide la
 * base y la misma pantalla le diría a dos personas cosas distintas en dos
 * cargas. `ordenes_trabajo` no tiene `created_at`, y de los campos que sí hay
 * el número es el único que una sincronización no reescribe. Sin fecha, la
 * orden va al final (nunca primera por accidente).
 *
 * **Dónde termina esta responsabilidad, que es la mitad que no se puede probar
 * acá:** `repartir` reparte lo que le dan. Que lo que entre sean **sólo RI
 * pegados a mano** —nunca los que el cruce por texto adivina— y **sólo órdenes
 * abiertas** lo decide quien la llama, y se prueba en esa ruta. Las dos reglas
 * salen del anti-objetivo de la función: un falso positivo del cruce, o una
 * orden ya terminada reclamando piezas, hace que otra lea «cubierta» por algo
 * que no es suyo.
 *
 * Para decidir si un RI todavía cuenta se reusa `estaEnVuelo`: una segunda
 * definición de «en vuelo» sería la misma regla escrita dos veces y probada una.
 */
import { estaEnVuelo } from "./riDelRepuesto";

export interface RiPegado {
  nro_ri: number;
  cantidad: number | null;
  cantidad_recibida: number | null;
  estado_compra: string | null;
  estado_aprobacion: string | null;
}

export interface OrdenQuePide {
  orden_id: string;
  ot_number: number | null;
  fecha: string | null;
  pide: number | null;
}

export interface ParteDeLaOrden {
  orden_id: string;
  pide: number | null;
  cubiertas: number;
  faltaPedir: number;
}

/** Lo que un RI todavía va a traer: lo pedido menos lo recibido, nunca negativo. */
export function loQueTraeUnRi(ri: RiPegado): number {
  if (!estaEnVuelo({ ...ri, descripcion: null, codigo: null })) return 0;
  if (ri.cantidad == null || !(ri.cantidad > 0)) return 0;
  return Math.max(0, ri.cantidad - Math.max(0, ri.cantidad_recibida ?? 0));
}

const AL_FINAL = Number.POSITIVE_INFINITY;

/**
 * Reparte lo que traen los RI entre las órdenes, la más vieja primero.
 *
 * **Devuelve las partes en el orden en que se repartió** (fecha, luego número
 * de OT, sin fecha o sin número al final) y no en el orden de entrada: la
 * pantalla usa ese mismo orden, y si lo reordenara por su cuenta habría dos
 * definiciones del mismo orden.
 */
export function repartir(ris: RiPegado[], ordenes: OrdenQuePide[]): ParteDeLaOrden[] {
  let queda = ris.reduce((s, ri) => s + loQueTraeUnRi(ri), 0);

  const ordenadas = [...ordenes].sort((a, b) => {
    const fa = a.fecha ? Date.parse(a.fecha) : AL_FINAL;
    const fb = b.fecha ? Date.parse(b.fecha) : AL_FINAL;
    if (fa !== fb) return fa < fb ? -1 : 1;
    const na = a.ot_number ?? AL_FINAL;
    const nb = b.ot_number ?? AL_FINAL;
    if (na !== nb) return na < nb ? -1 : 1;
    return a.orden_id < b.orden_id ? -1 : a.orden_id > b.orden_id ? 1 : 0;
  });

  return ordenadas.map((o) => {
    if (o.pide == null || !(o.pide > 0)) {
      return { orden_id: o.orden_id, pide: o.pide, cubiertas: 0, faltaPedir: 0 };
    }
    const cubiertas = Math.min(o.pide, queda);
    queda -= cubiertas;
    return { orden_id: o.orden_id, pide: o.pide, cubiertas, faltaPedir: o.pide - cubiertas };
  });
}
