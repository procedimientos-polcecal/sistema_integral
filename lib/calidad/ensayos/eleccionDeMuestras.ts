/**
 * Qué muestras quedan elegidas después de aplicar lo tildado en el selector de
 * un producto.
 *
 * El selector de la curva muestra **un producto por vez**, pero lo elegido
 * puede cruzar productos: así se arma una comparación de Filler 1 contra
 * Filler 2 sin otra pantalla. De ahí las dos reglas que esto existe para
 * sostener, y que no se ven leyendo el componente:
 *
 * - **Lo que no está en el selector no se toca.** Las muestras de otro
 *   producto no se pueden tildar ni destildar desde acá, así que aplicar con
 *   todo destildado saca las de este producto y deja las otras donde estaban.
 *   Sacarlas se hace con la × de su chip, que es el único lugar que las ve.
 * - **Lo que ya estaba elegido no se mueve.** El orden decide el color y el
 *   trazo de cada curva (`parDeLaSerie`), así que reordenar al aplicar le
 *   cambiaría el color a una curva que nadie tocó. Las que entran van al
 *   final, y **en el orden del producto y no en el de los tildes**: dos
 *   personas que tildan lo mismo en distinto orden tienen que ver el mismo
 *   gráfico.
 */
export function laEleccionQueQueda(
  elegidas: string[],
  delProducto: string[],
  tildadas: string[]
): string[] {
  const enElSelector = new Set(delProducto);
  const sigueTildada = new Set(tildadas.filter((id) => enElSelector.has(id)));

  const quedan = elegidas.filter((id) => !enElSelector.has(id) || sigueTildada.has(id));
  const yaEstaban = new Set(quedan);
  const entran = delProducto.filter((id) => sigueTildada.has(id) && !yaEstaban.has(id));

  return [...quedan, ...entran];
}
