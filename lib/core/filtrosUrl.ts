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
 * Lo que no está es la paginación. Compras la pone en la barra de direcciones
 * —`?pagina=2`, que es la segunda— y Mantenimiento todavía no; su `page=` es
 * de la llamada a la API y no de la URL que se comparte. La regla la escribe
 * el segundo que la necesita: hasta entonces vive en `lib/compras/filtrosUrl.ts`.
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
