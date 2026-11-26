/**
 * Qué muestras quedan elegidas después de aplicar lo tildado en el selector de
 * un producto.
 *
 * El selector no muestra todo: por omisión, sólo las muestras del producto
 * elegido, y con la casilla del 26/11/2026 también las de los otros productos
 * del mismo juego de tamices. Lo elegido, en cambio, puede cruzar cualquier
 * producto. De ahí las dos reglas que esto existe para sostener, y que no se
 * ven leyendo el componente:
 *
 * - **Lo que el selector no ve no se toca.** Aplicar con todo destildado saca
 *   lo que estaba a la vista y deja lo demás donde estaba. Eso vale para un
 *   producto de otro juego de tamices, y también para uno del mismo juego
 *   mientras la casilla esté apagada. Sacar lo que no se ve se hace con la ×
 *   de su chip, que es el único lugar que lo muestra siempre.
 * - **Lo que ya estaba elegido no se mueve.** El orden decide el color y el
 *   trazo de cada curva (`parDeLaSerie`), así que reordenar al aplicar le
 *   cambiaría el color a una curva que nadie tocó. Las que entran van al
 *   final, y **en el orden en que las lista el selector y no en el de los
 *   tildes**: dos personas que tildan lo mismo en distinto orden tienen que
 *   ver el mismo gráfico.
 */
export function laEleccionQueQueda(
  elegidas: string[],
  visibles: string[],
  tildadas: string[]
): string[] {
  const enElSelector = new Set(visibles);
  const sigueTildada = new Set(tildadas.filter((id) => enElSelector.has(id)));

  const quedan = elegidas.filter((id) => !enElSelector.has(id) || sigueTildada.has(id));
  const yaEstaban = new Set(quedan);
  const entran = visibles.filter((id) => sigueTildada.has(id) && !yaEstaban.has(id));

  return [...quedan, ...entran];
}

/**
 * Los tildes que quedan cuando **cambia qué muestra el selector**, sin que
 * nadie haya tildado nada.
 *
 * Pasa desde el 26/11/2026, con la casilla que suma las muestras de los otros
 * productos del mismo juego de tamices: lo visible se ensancha y se angosta en
 * un clic. Hay que distinguir dos cosas que se parecen y no son lo mismo:
 *
 * - **Lo que ya se veía conserva lo que la persona decidió.** Si estaba elegida
 *   y la destildó sin aplicar todavía, abrir el grupo no se la devuelve.
 * - **Lo que aparece recién arranca de lo que ya está elegido**, para que el
 *   selector siga siendo el estado y no una lista vacía al lado de unos chips
 *   que dicen otra cosa.
 *
 * Al angostar no hace falta nada más: lo que deja de verse sale de los tildes,
 * y `laEleccionQueQueda` ya no lo toca justamente porque el selector no lo ve.
 */
export function losTildesQueSiguen(
  tildadas: string[],
  visiblesAntes: string[],
  visiblesAhora: string[],
  elegidas: string[]
): string[] {
  const seVeia = new Set(visiblesAntes);
  const tildada = new Set(tildadas);
  const elegida = new Set(elegidas);

  return visiblesAhora.filter((id) => (seVeia.has(id) ? tildada.has(id) : elegida.has(id)));
}
