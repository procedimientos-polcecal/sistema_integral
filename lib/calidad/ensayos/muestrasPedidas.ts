/**
 * Cuántos ids acepta la curva, y por qué ese número.
 *
 * **No es un tope de cuántas muestras se comparan: comparar no tiene tope.**
 * Es lo que entra en un `.in()` de PostgREST sin armar una URL que conteste un
 * 400 sin decir por qué, que es el lote de 200 que usa todo el sistema. O sea
 * que las muestras de un enlace se traen de un saque, sin recorrerlas
 * (`traerMuestrasConRetenidos`: una consulta para las muestras y otra para sus
 * retenidos).
 *
 * Que el techo sea técnico y no «un número un poco más alto» es a propósito,
 * porque esto crece rápido: medido contra producción, del 19 al 25/11/2026 las
 * muestras con granulometría pasaron de 106 a 135, los productos que tienen
 * alguna de 8 a 11 y el más cargado de 23 a 28. Un tope de 40 se alcanza en
 * dos semanas.
 */
export const MUESTRAS_QUE_SE_ACEPTAN = 200;

/**
 * Los ids de muestra que pide la URL de la curva granulométrica.
 *
 * **Se aceptan las dos formas.** `?muestras=a,b` es la nueva; `?muestra=a` es
 * la que tuvo la pantalla desde el 05/11/2026 y se sigue leyendo porque ya hay
 * enlaces de una muestra sola dando vueltas —se comparten por chat, que es
 * para lo que la muestra viaja en la URL— y romperlos no tiene ninguna ventaja.
 *
 * Saca repetidos —un id dos veces dibujaría la misma curva encima de sí misma—
 * y corta en `MUESTRAS_QUE_SE_ACEPTAN`, que es el techo de la consulta y no
 * una regla sobre cuántas curvas se leen.
 *
 * **Y tira lo que no tiene forma de UUID, que antes del 25/11/2026 no hacía
 * falta y ahora sí.** Cuando las muestras se traían de a una, un id cualquiera
 * hacía una consulta que no encontraba nada y la pantalla salteaba *esa*
 * muestra. Hoy van en un solo `.in()`, así que Postgres rechaza la consulta
 * entera con un `22P02` y no vuelve **ninguna**: un enlace de tres muestras al
 * que el chat le truncó el último id abriría la pantalla vacía, sin un solo
 * mensaje. Medido contra producción el 25/11/2026.
 */

/** La forma de un uuid. La misma que valida la ruta del Excel. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function leerMuestrasPedidas(crudo: {
  muestra?: string | string[];
  muestras?: string | string[];
}): string[] {
  const unico = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

  const pedidos = [...unico(crudo.muestra).split(","), ...unico(crudo.muestras).split(",")]
    .map((id) => id.trim())
    .filter((id) => UUID.test(id));

  return [...new Set(pedidos)].slice(0, MUESTRAS_QUE_SE_ACEPTAN);
}
