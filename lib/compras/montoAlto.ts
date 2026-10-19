/**
 * Qué requerimientos son de monto alto, y por qué.
 *
 * Son dos preguntas que se contestan en momentos distintos del circuito, y por
 * eso hacen falta las dos mitades. Medido el 19/10/2026 sobre los 2.159
 * requerimientos: el costo real **no existe** hasta que se compró —cero en
 * SIN_INICIAR, cero en comparativa, uno de cuarenta en APROBADO— y los RI que
 * esperan la aprobación de gerencia no tienen ningún monto, ninguno. O sea que
 * el automático es exacto pero llega tarde, y el manual llega a tiempo pero
 * depende de que alguien sepa.
 *
 * `monto_conocido` lo mantiene un trigger en la base (ver la migración
 * `20261019092428`): es `costo_iva + costo_envio` si el RI ya se compró, y si no
 * el presupuesto en pesos más alto. Null es "todavía no hay ningún número",
 * que hoy son 308 requerimientos.
 */

/** Lo que mandó la persona, si mandó. `null` es "no opinó nadie". */
export type MarcaManual = boolean | null;

/**
 * Si un requerimiento es de monto alto.
 *
 * La decisión de una persona le gana al monto **en los dos sentidos**: `true`
 * marca uno que todavía no tiene número, y `false` desmarca una compra grande
 * pero rutinaria —30.000 bolsas de cal— que si no quedaría marcada para siempre
 * y enseñaría a ignorar la marca.
 */
export function esMontoAlto(
  montoConocido: number | null,
  manual: MarcaManual,
  umbral: number
): boolean {
  if (manual !== null) return manual;
  return montoConocido !== null && montoConocido >= umbral;
}

/**
 * Cuál de los dos mandó, para poder decirlo en pantalla.
 *
 * Que un monto de 29 millones figure como "no alto" porque alguien lo desmarcó
 * tiene que poder verse: si no, parece un error del sistema y alguien lo vuelve
 * a marcar.
 */
export function porQueEsAlto(
  montoConocido: number | null,
  manual: MarcaManual,
  umbral: number
): string | null {
  const superaElUmbral = montoConocido !== null && montoConocido >= umbral;

  if (manual === true) return "lo marcó una persona";
  if (manual === false) return superaElUmbral ? "una persona lo desmarcó" : null;
  return superaElUmbral ? "por el monto" : null;
}

/**
 * La misma regla, en el idioma de PostgREST.
 *
 * Existe porque **el listado pagina en el servidor**: filtrar `esMontoAlto`
 * sobre una lista ya traída daría páginas incompletas sin avisar. Vive pegada a
 * `esMontoAlto` a propósito — separarlas es la forma de que se contradigan sin
 * que nada lo note, y hay un test que fija las dos.
 *
 * El valor se le pasa a `.or()`. Ojo con el negado: **no es "lo que no es alto"
 * a secas**. Un RI desmarcado a mano entra ahí aunque su monto supere el
 * umbral, y uno sin monto también.
 */
export function filtroDeMontoAlto(alto: boolean, umbral: number): string {
  if (alto) {
    return [
      "monto_alto_manual.is.true",
      `and(monto_alto_manual.is.null,monto_conocido.gte.${umbral})`,
    ].join(",");
  }
  return [
    "monto_alto_manual.is.false",
    `and(monto_alto_manual.is.null,or(monto_conocido.is.null,monto_conocido.lt.${umbral}))`,
  ].join(",");
}
