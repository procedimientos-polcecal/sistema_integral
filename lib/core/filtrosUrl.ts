/**
 * Los filtros de un listado, leídos y escritos en la URL.
 *
 * Acá está lo que no depende de qué se filtra: cómo se leen los valores de un
 * query string, cómo se validan contra una lista y cómo se vuelven a escribir.
 * Qué campos tiene cada listado lo dice su módulo —`lib/compras/filtrosUrl.ts`,
 * `lib/mantenimiento/filtrosOt.ts`—, que es donde viven los nombres y los
 * catálogos.
 *
 * Vive en el núcleo porque son dos los que lo usan, y la regla de qué acepta la
 * URL tiene que ser una sola: si Compras aceptara comas y Mantenimiento no, un
 * enlace copiado de una pantalla a la otra dejaría de funcionar sin que nada lo
 * diga.
 *
 * Salieron de Compras, que las tuvo duplicadas unas horas mientras el archivo
 * estaba a medio refactorizar en otra sesión. Ya no: los dos importan de acá.
 *
 * La paginación también: empezó en Compras y subió acá cuando las OT la
 * necesitaron, que es cuando una regla común se justifica. No confundir con el
 * `page=` de `consultaDeLaRuta`, que es de la llamada a la API; esto es lo que
 * queda escrito en la barra de direcciones y se comparte en un enlace.
 */

/**
 * Los valores que trajo la URL para un filtro, ya validados.
 *
 * Se aceptan las dos formas: repetido (`?prioridad=ALTA&prioridad=URGENTE`),
 * que es lo que arma un formulario, y separado por comas
 * (`?prioridad=ALTA,URGENTE`), que es lo que se manda por chat sin que la URL
 * se vuelva ilegible. Ningún id ni ningún estado tiene comas, así que partir
 * por coma no rompe nada.
 *
 * Un valor que no está en la lista se descarta en silencio. Es preferible a
 * dejarlo puesto: un filtro que la persona no ve —porque el desplegable no
 * tiene esa opción— y no puede quitar deja una tabla vacía que se lee como "no
 * hay nada".
 */
export function losQueEstanEnLaLista(
  params: URLSearchParams,
  nombre: string,
  permitidos: readonly string[]
): string[] {
  const vistos = new Set<string>();
  for (const crudo of params.getAll(nombre)) {
    for (const valor of crudo.split(",")) {
      const v = valor.trim();
      // Repetir un valor en la URL no tendría por qué duplicarlo en el `.in()`.
      if (v && permitidos.includes(v)) vistos.add(v);
    }
  }
  return [...vistos];
}

/** Si algún filtro tiene algo puesto. Sirve para saber si arrancar filtrado. */
export function hayAlgunFiltro(f: object): boolean {
  return Object.values(f).some((v) => (Array.isArray(v) ? v.length > 0 : Boolean(v)));
}

/**
 * Los filtros de vuelta como query string, sin el `?`. Vacío si no hay ninguno.
 *
 * Es la inversa de leerlos: lo que sale de acá tiene que volver igual al
 * leerse, porque de eso depende que el botón de atrás devuelva la tabla como
 * estaba.
 *
 * Cada filtro va en un solo parámetro con los valores separados por comas
 * —`?prioridad=ALTA,URGENTE`— y no repetido: es la forma que deja la URL
 * legible y la que se puede pasar por chat. El orden lo fija `nombres` y no el
 * orden en que se tildaron, para que tocar dos veces el mismo desplegable no
 * cambie la URL — si cambiara, el efecto que escribe la barra de direcciones se
 * dispararía de nuevo en cada render.
 */
export function escribirEnLaUrl<T>(
  f: T,
  nombres: readonly [keyof T, string][]
): string {
  const params = new URLSearchParams();
  for (const [clave, nombre] of nombres) {
    const valor: unknown = f[clave];
    if (Array.isArray(valor)) {
      if (valor.length) params.set(nombre, valor.join(","));
    } else if (typeof valor === "string" && valor.trim()) {
      params.set(nombre, valor.trim());
    }
  }
  return params.toString();
}

/**
 * La página que pide la URL. Uno es la primera.
 *
 * Se cuenta desde uno en todos lados donde se la nombre: es lo que dicen los
 * botones de abajo de la tabla y lo que lee quien mira la barra de
 * direcciones. Si adentro un listado la cuenta desde cero —porque así se
 * calcula el `range()` de PostgREST— la convierte en su propio archivo y lo
 * dice ahí; acá y en la URL siempre es la primera, la segunda, la tercera.
 *
 * Sin esto, entrar a una orden desde la página 3 y volver dejaba la tabla en
 * la 1, con los filtros puestos pero cien filas más arriba de donde se estaba.
 *
 * Cualquier cosa que no sea un entero de una página en adelante es la primera.
 * No se valida contra cuántas hay —eso no se sabe hasta consultar—, así que un
 * número de más lo acomoda el listado cuando ve el total: una tabla vacía se
 * lee como "no hay nada" y acá no habría nada que lo desmienta.
 */
export function leerPaginaDeLaUrl(params: URLSearchParams): number {
  const crudo = params.get("pagina");
  if (!crudo) return 1;
  const numero = Number(crudo);
  if (!Number.isInteger(numero) || numero < 1) return 1;
  return numero;
}

/**
 * El query string de los filtros con la página pegada al final.
 *
 * Va última porque no es un filtro y porque así el enlace se lee primero por
 * lo que muestra y después por dónde está parado. La primera no se escribe: un
 * `?pagina=1` colgado de cada enlace sería ruido, y además haría que dos URL
 * distintas signifiquen lo mismo.
 */
export function conLaPagina(query: string, pagina: number): string {
  if (pagina <= 1) return query;
  const cual = `pagina=${pagina}`;
  return query ? `${query}&${cual}` : cual;
}
