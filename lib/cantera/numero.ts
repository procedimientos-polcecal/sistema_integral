/**
 * Un número que se tipeó en un campo de Cantera.
 *
 * POR QUÉ EXISTE
 *
 * El 05/11/2026, arreglando en Calidad/Ensayos un bug de la coma decimal, se
 * encontró el mismo en Cantera y repetido cuatro veces: había un `n()` idéntico
 * en el cliente de bochones y en el de voladuras, y un `num()` idéntico en las
 * dos rutas, los cuatro haciendo `Number(v)`. Con "2,5" eso da `NaN`, y de ahí
 * salían las dos mitades:
 *
 *   - En **voladuras** el cliente mandaba el `NaN`, que `JSON.stringify`
 *     convierte en `null`: el burden, el espaciamiento y la densidad se
 *     guardaban **vacíos**, después de que la pantalla hubiera mostrado el
 *     tonelaje estimado calculado con el número bueno.
 *   - En **bochones** el cliente manda el texto crudo y era la ruta la que lo
 *     leía con `Number()`: mismo resultado, campo vacío y sin aviso.
 *   - En **acarreo** y en **destape** frenaba con "la cantidad tiene que ser un
 *     número" sobre un campo que tenía un número escrito.
 *
 * La causa de fondo no era ninguno de esos `Number()` sino que hubiera dos
 * funciones leyendo la misma cadena, una de cada lado. Acá hay una sola.
 *
 * LA REGLA DE MILES VA, Y ESO SE MIDIÓ
 *
 * A diferencia de `numeroTipeado` en Calidad/Ensayos —donde la balanza está
 * acotada por la física y "299.668" son 299,668 g—, acá el punto de miles es
 * real y esperable. Medido el 05/11/2026 contra la base:
 *
 *   - `cantera_voladuras.perf_tc_usd` y `vol_tc_usd`: 54 de 54 pasan los mil
 *     (1390 a 1560), sin decimales. "1.450" es mil cuatrocientos cincuenta.
 *   - `perf_monto_noche`: 14 de 14 entre 35.000 y 40.000.
 *   - `cantera_bochones.tc_usd`: 28 de 28 entre 1390 y 1560.
 *   - `cantera_consumos.cantidad`: 7 valores de más de mil, el mayor 1680.
 *   - `cantera_cubicaciones.existencia_final`: 3 de 16 pasan las mil toneladas,
 *     la mayor 2240.
 *
 * LO QUE ESTA DECISIÓN PIERDE, DICHO
 *
 * Los campos chicos de geometría —`burden_m` y `espaciamiento_m` van de 2,5 a
 * 2,8 m, `densidad_t_m3` es 2,7— quedan bajo la misma regla, así que un
 * "2.800" tipeado queriendo decir 2,8 entra como 2800. Se aceptó porque el
 * caso al revés es peor y está medido: un tipo de cambio es el número que más
 * se carga en este módulo y siempre lleva el punto. Un "2,8" y un "2.8" —que
 * son cómo se escribe eso de verdad— siguen dando 2,8: la regla de miles pide
 * exactamente tres dígitos detrás del punto.
 */

import { numeroDelFormulario } from "@/lib/core/numeroArgentino";

/** `null` es "no se puede leer", que incluye el campo vacío. Nunca `NaN`. */
export function numeroDeCampo(v: unknown): number | null {
  return numeroDelFormulario(v);
}
