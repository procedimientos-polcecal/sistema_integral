/**
 * De dónde sale el próximo N° de RI.
 *
 * La serie la reparten dos escritores y **no cuentan lo mismo**, que es el
 * agujero que esto viene a tapar:
 *
 *   - el Apps Script numera cada respuesta del formulario con `max(A) + 1`
 *     sobre las dos pestañas de la planilla, en el momento en que entra;
 *   - el sistema numeraba con `max(nro_ri) + 1` sobre la base, y la base
 *     **sólo se entera de las respuestas cuando corre la sincronización**.
 *
 * Y esa ventana no son los quince minutos del cron. Medido el 14/09/2026 sobre
 * `compras_sincronizaciones`: en tres días el cron corrió **24 veces, no 288**,
 * con huecos de hasta cinco horas —los crons de GitHub Actions son "mejor
 * esfuerzo" y saltean corridas—. El webhook de la planilla, que es lo que
 * tapaba ese agujero, **no sirve para este caso**: avisa cuando alguien *edita*
 * el master, y una respuesta del formulario no lo edita — entra en la otra
 * planilla y llega por `IMPORTRANGE`, que es un recálculo y no dispara nada. O
 * sea que un RI nuevo del formulario puede tardar **horas** en llegar a la
 * base, y todo ese tiempo el máximo de la base miente por defecto.
 *
 * Pasó en el primer alta real, el
 * 14/09/2026: a las 10:45 entró "Pinza amperometrica" por el formulario y el
 * script la numeró 1970; a las 10:47 se cargó un pedido desde el sistema, la
 * base todavía tenía 1969 como máximo y eligió 1970 también. La escritura no
 * llegó a hacerse porque `exportarAltaAlFormulario` mira la otra pestaña antes
 * de escribir y encontró el número tomado — pero el pedido quedó trabado
 * pidiendo que alguien lo renumerara a mano.
 *
 * La cuenta pasa a hacerse sobre **las tres fuentes**. Con eso el caso de
 * arriba elige 1971 y no hay nada que arreglar después.
 *
 * Lo que esto **no** resuelve, y conviene tenerlo escrito: si una respuesta del
 * formulario entra entre que se lee la planilla y se escribe la fila, los dos
 * vuelven a elegir el mismo número. Esa ventana pasa de quince minutos a los
 * pocos segundos que separan las dos llamadas, y para lo que quede está la
 * comprobación previa a escribir, que es la que evitó el daño esta vez. Cerrarla
 * del todo pediría que el sistema tomara el `LockService` del Apps Script, y a
 * ese lock no se llega desde afuera.
 */

/**
 * El N° de RI más alto de una columna de la planilla.
 *
 * `filas` son las filas de la hoja con el N° en la primera columna, tal como
 * las devuelve la API. `primeraFila` es la primera que contiene un pedido, en
 * la numeración de la planilla (la 1 es el encabezado): las hojas tienen filas
 * de cebado arriba —en la de respuestas la 2 tiene un `-1` y la 3 un `0`— y un
 * número que aparezca ahí no es un pedido.
 *
 * Los valores se leen crudos (`UNFORMATTED_VALUE`) por lo mismo que explica
 * `filaConEsteRi`: el texto formateado de `1.954` limpiado a mano da 195400, y
 * un máximo inventado de cien mil repartiría números que nadie va a poder
 * reconciliar nunca.
 */
export function maximoDeLaColumna(filas: string[][], primeraFila: number): number {
  let maximo = 0;
  for (let i = primeraFila - 1; i < filas.length; i++) {
    const n = Number(String(filas[i]?.[0] ?? "").trim());
    if (Number.isFinite(n) && n > maximo) maximo = n;
  }
  return maximo;
}

/**
 * El próximo número de la serie, mirando todo lo que la reparte.
 *
 * Toma el máximo de los máximos y le suma uno. Un cero es "esta fuente no dice
 * nada" —una pestaña vacía, o la planilla que no se pudo leer— y no arrastra la
 * cuenta para abajo, que es justo lo que tiene que pasar cuando Google falla:
 * el alta no se puede frenar porque la planilla no conteste, así que se sigue
 * con lo que sepa la base y la comprobación previa a escribir queda de red.
 */
export function proximoNroRi(maximos: number[]): number {
  let maximo = 0;
  for (const n of maximos) {
    if (Number.isFinite(n) && n > maximo) maximo = n;
  }
  return maximo + 1;
}
