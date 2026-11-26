/**
 * Qué productos se pueden comparar entre sí, y por qué ése es el criterio.
 *
 * Se pidió el 26/11/2026: «que se puedan comparar distintos productos, de los
 * que tengan el mismo juego de tamices» —el caso concreto, Arena Chocolata
 * contra Arena caliza LN—. Cruzar productos ya se podía desde el 19/11; lo que
 * no había era cómo *encontrar* con cuáles vale la pena.
 *
 * **Es el juego DECLARADO del producto y no el que midió cada muestra**, y esa
 * elección decide todo lo demás. Un producto declara un juego
 * (`calidad_ensayos_productos.mallas`, lo que la pantalla de carga propone) y
 * sus muestras pueden haber medido otro: medido contra producción el
 * 26/11/2026, los 12 productos que declaran algo caen en **dos** juegos
 * —`20·50·100·200` y `6·7·10·12·20·50·100·200`, seis cada uno— mientras que lo
 * medido se abre en **cinco**, y Filler 1 solo tiene tres (23 muestras en uno,
 * 4 en otro, 1 en otro). Agrupar por lo medido dejaría a un producto en tres
 * grupos a la vez, que no es un criterio sino un ruido; y además lo que falta
 * ya no es un problema: el eje de la curva es la unión, la malla que una
 * muestra no midió queda en `null` y el hueco se nombra debajo de los gráficos.
 *
 * **Y el juego vacío no empareja con nadie.** 11 de los 23 productos no
 * declaran mallas —hoy ninguno tiene muestras con granulometría, así que no se
 * pierde nada—, y juntarlos entre sí sería emparejar «Caliza galpón» con
 * «Acopio» por lo único que tienen en común, que es no haber dicho nada. Es la
 * regla de la casa: enlazar al que se le parece es peor que dejar en null.
 */

/** Un producto, visto por esto: sólo su id y el juego que declara. */
export interface ProductoConJuego {
  id: string;
  mallas: number[];
}

/**
 * La clave de un juego de tamices. Ordena antes de unir, porque `mallas` es un
 * array de Postgres y nada del otro lado garantiza el orden —lo ordena
 * `normalizarMallas()` al escribir, que es código de esta app y no una
 * restricción de la base—.
 *
 * El juego vacío da la cadena vacía, que es de lo que se agarra
 * `losQueComparten` para no emparejar a nadie.
 */
export function claveDelJuego(mallas: number[] | null | undefined): string {
  return [...(mallas ?? [])].sort((a, b) => a - b).join("·");
}

/**
 * Los **otros** productos que declaran el mismo juego que `productoId`, en el
 * orden en que venga el catálogo —que es `orden`, el que elige la pantalla de
 * productos—.
 *
 * Devuelve vacío si el producto no está, o si no declara juego.
 */
export function losQueComparten<T extends ProductoConJuego>(
  productos: T[],
  productoId: string
): T[] {
  const suyo = productos.find((p) => p.id === productoId);
  if (!suyo) return [];

  const clave = claveDelJuego(suyo.mallas);
  if (clave === "") return [];

  return productos.filter((p) => p.id !== productoId && claveDelJuego(p.mallas) === clave);
}
