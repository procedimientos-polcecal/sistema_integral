/**
 * Las cajas de «Preguntar a Compras» abiertas en el modal de repuestos, **una por
 * repuesto**.
 *
 * ── POR QUÉ ESTO ES UNA FUNCIÓN Y NO TRES `setState` EN LA PANTALLA ─────────────
 *
 * Hasta el 30/10/2026 el modal tenía **una sola caja para toda la lista**: abrir
 * «Preguntar a Compras» en un segundo repuesto tiraba en silencio lo que ya se
 * había escrito en el primero. Se arregló pasando a un registro con el id del
 * repuesto como clave.
 *
 * Y el arreglo quedó sin nada que lo defendiera. Medido el 31/10: volver a
 * `setCajas(() => ({ [r.id]: … }))` —la rotura exacta que se había arreglado, y lo
 * primero que sale al escribirlo de nuevo— dejaba **toda la suite en verde**, los
 * 4.464 tests. Es la misma clase de error que la ronda de arreglo vino a cerrar en
 * el «Ya llegó», encontrada en el arreglo mismo.
 *
 * Perder lo que alguien tipeó no tira ningún error, no se ve en una captura y la
 * persona se entera cuando ya lo perdió. Así que la decisión sale de la pantalla y
 * se prueba acá, que es lo que la casa hace con la lógica que importa.
 *
 * **Son transiciones, no estado**: reciben el registro y devuelven uno nuevo, sin
 * tocar el que les llegó. React compara por identidad, y además eso es lo que las
 * vuelve probables sin un navegador.
 */

import { TEXTO_DEL_SEGUIMIENTO } from "./consultaDeRepuesto";

/** La pregunta que se está escribiendo para un repuesto. */
export interface Caja {
  /** Lo que arrancó escrito: el repuesto y los RI. Sirve para no mandar sólo eso. */
  encabezado: string;
  texto: string;
  /** Por qué no se pudo enviar, si no se pudo: se dice donde la persona está actuando. */
  error: string;
}

/** Las que están abiertas, por id de repuesto. */
export type Cajas = Record<string, Caja>;

/**
 * Abre la caja de un repuesto **sin tocar las de los demás**.
 *
 * `esSeguimiento` es si ese repuesto ya tiene una pregunta esperando: entonces lo
 * que se escribe se suma al mismo hilo en vez de abrir otra, que serían dos
 * entradas en la bandeja de Compras diciendo lo mismo.
 *
 * Abrir una caja que ya estaba abierta **la reinicia**, que es lo que se quiere: el
 * botón vuelve a decir «Preguntar» y quien lo aprieta espera empezar de nuevo. Lo
 * que no puede pasar es que reinicie las otras.
 */
export function abrirCaja(
  cajas: Cajas,
  repuestoId: string,
  encabezado: string,
  esSeguimiento: boolean
): Cajas {
  return {
    ...cajas,
    [repuestoId]: {
      encabezado,
      error: "",
      texto: esSeguimiento ? `${encabezado}${TEXTO_DEL_SEGUIMIENTO} ` : encabezado,
    },
  };
}

/**
 * Cambia lo que tiene una caja: el texto mientras se escribe, o su error.
 *
 * Si esa caja no está abierta devuelve **el mismo registro**, no una copia: una
 * respuesta que llega tarde —el error de un envío cuya caja ya se cerró— no puede
 * resucitarla ni hacer que React vuelva a dibujar de gusto.
 */
export function cambiarCaja(cajas: Cajas, repuestoId: string, cambios: Partial<Caja>): Cajas {
  const caja = cajas[repuestoId];
  if (!caja) return cajas;
  return { ...cajas, [repuestoId]: { ...caja, ...cambios } };
}

/** Cierra la de un repuesto y deja las demás como estaban. */
export function cerrarCaja(cajas: Cajas, repuestoId: string): Cajas {
  if (!(repuestoId in cajas)) return cajas;
  const resto = { ...cajas };
  delete resto[repuestoId];
  return resto;
}
