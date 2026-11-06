/**
 * Volver a poner en el formulario lo que quedó guardado en una carga parada.
 *
 * POR QUÉ EXISTE. El spec promete, sobre el fallo definitivo: «se avisa y la
 * carga queda parada, **visible y editable**, no borrada». Visible estaba;
 * editable no: lo único que había era «Reintentar igual» —mandar otra vez lo
 * mismo, que por definición va a fallar otra vez— y «Borrar», que pierde lo
 * escrito. Una OT tiene dieciocho campos y se carga parado en la cantera: que
 * la única salida de una coma mal puesta sea tipear todo de nuevo es lo que
 * hace que nadie la vuelva a cargar.
 *
 * QUÉ HACE, Y POR QUÉ ES ESTO Y NO UN EDITOR. La carga guardada es el **cuerpo
 * que se le mandó a la ruta**, no el estado del formulario: tiene campos de más
 * (`clave`, `equipo_raw`, `equipo_code`) y los tipos no coinciden (`horas` viaja
 * como número y el `<input>` quiere texto). Esto toma el formulario vacío y le
 * pisa encima lo que el cuerpo tenga con ese mismo nombre, convertido a lo que
 * el campo ya era. Lo que el cuerpo no nombra se queda con su valor inicial, y
 * lo que el formulario no tiene se descarta: así una carga vieja, de cuando el
 * formulario tenía otros campos, entra igual sin romper nada.
 *
 * Es pura y está acá y no en el componente por lo de siempre: las pantallas no
 * tienen tests y esto sí tiene qué probar —la conversión y qué se descarta—.
 */

/**
 * El formulario con los valores del cuerpo puestos encima.
 *
 * `vacio` manda: define qué campos existen y de qué tipo es cada uno. Un valor
 * del cuerpo que es `null` o `undefined` **no pisa** —es "no vino", no "está
 * vacío"—, y un objeto o un arreglo tampoco: un `String({})` daría
 * «[object Object]» adentro de un campo de texto, que es peor que no traerlo.
 *
 * @param vacio Con qué arranca el formulario.
 * @param cuerpo Lo que se le había mandado a la ruta, o null para no pisar nada.
 */
export function borradorDesdeElCuerpo<T extends Record<string, string | boolean>>(
  vacio: T,
  cuerpo: Record<string, unknown> | null | undefined,
): T {
  if (!cuerpo) return vacio;

  const salida: Record<string, string | boolean> = { ...vacio };
  for (const campo of Object.keys(vacio)) {
    const valor = cuerpo[campo];
    if (valor === null || valor === undefined) continue;
    if (typeof vacio[campo] === "boolean") {
      salida[campo] = Boolean(valor);
      continue;
    }
    if (typeof valor === "object") continue;
    salida[campo] = String(valor);
  }
  return salida as T;
}
