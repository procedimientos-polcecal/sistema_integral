/**
 * Las decisiones de un formulario que guarda lo que se va escribiendo, como
 * funciones puras: la clave bajo la que se guarda y si hay algo que guardar.
 * Nada acá toca el navegador, así que se prueban sin pantalla. Lo único con
 * estado es el almacén del final, y es un `Map` en memoria.
 */

/** De dónde salió el formulario, cuando nació prellenado desde otra cosa. */
export interface Origen {
  tipo: string;
  id: string | number;
}

/**
 * La clave bajo la que vive el borrador de un formulario.
 *
 * **La trampa es que un borrador reaparezca sobre otro registro.** Se abre la
 * OT 2905, se escribe, se cierra, se abre la 2907: si el borrador aparece ahí,
 * alguien guarda lo de una sobre la otra. Perder lo escrito se nota en el acto;
 * guardarlo en el registro equivocado no se nota nunca. Por eso la clave lleva
 * el registro de donde salió el formulario, y no sólo el nombre del formulario.
 *
 * Un alta en blanco y una prellenada desde un aviso o desde un pedido anterior
 * son formularios distintos aunque se llamen igual: sin `origen` la clave no
 * tiene esa parte, así que no se pisan. Dos altas desde el mismo origen sí
 * comparten clave, porque es el mismo trabajo retomado.
 *
 * El `id` se pasa a texto: 7 y "7" son el mismo registro (uno viene de la base y
 * el otro de la URL). La clave se arma como JSON de una lista y no pegando
 * pedazos con un separador, para que un nombre con `:` adentro no pueda
 * confundirse con otro par formulario/origen.
 */
export function claveDelBorrador(formulario: string, origen?: Origen | null): string {
  const partes = origen
    ? [formulario, origen.tipo, String(origen.id)]
    : [formulario];
  return `borrador:${JSON.stringify(partes)}`;
}

/**
 * Si el formulario fue tocado: compara contra **cómo nació y no contra vacío**.
 *
 * Varios formularios nacen con valores por omisión (las horas en «8», un sector
 * ya elegido). Comparado contra vacío, abrirlos y cerrarlos sin tocar nada
 * mostraría el cartel de «¿descartar lo escrito?», y un cartel que salta cuando
 * no debía enseña a pasarlo por alto la vez que sí importaba. Y al revés: volver
 * un campo a su valor inicial deja el formulario intacto, aunque se haya tocado
 * en el medio.
 */
export function hayAlgoEscrito<T extends object>(inicial: T, actual: T): boolean {
  return !iguales(inicial, actual);
}

/**
 * Los campos que cambiaron respecto de cómo nació el formulario, y sólo ésos.
 *
 * **Un borrador guarda el cambio y no el registro.** `RegistrarOTModal` manda en
 * un solo `PATCH` las horas, el contratista, los tres operarios y la falla. Si el
 * borrador llevara el registro entero, al retomarlo reescribiría también lo que
 * otro corrigió mientras tanto — y desde el 16/10/2026 la app vive instalada en
 * los teléfonos, así que «mientras la app esté abierta» puede ser días. Pisar lo
 * que corrigió otro no se nota nunca; es la misma familia de daño que un borrador
 * que reaparece sobre el registro equivocado.
 *
 * La comparación es la misma de `hayAlgoEscrito`, campo por campo y en
 * profundidad: un campo que volvió a su valor inicial no es un cambio y no entra.
 *
 * Devuelve siempre un objeto nuevo. `guardarBorrador` guarda la referencia que le
 * dan y `leerBorrador` devuelve esa misma: si acá saliera `actual`, seguir
 * tipeando reescribiría el borrador ya guardado y nada lo notaría. Los valores de
 * adentro sí se comparten —no se clonan listas ni fechas—, lo que vale mientras
 * el formulario los reemplace en vez de mutarlos, que es lo que ya hace React.
 */
export function soloLoTocado<T extends object>(inicial: T, actual: T): Partial<T> {
  const antes = inicial as Record<string, unknown>;
  const ahora = actual as Record<string, unknown>;
  const tocado: Record<string, unknown> = {};
  for (const clave of Object.keys(ahora)) {
    if (!iguales(antes[clave], ahora[clave])) tocado[clave] = ahora[clave];
  }
  return tocado as Partial<T>;
}

/**
 * El registro como está hoy, con encima los campos que la persona había tocado.
 *
 * Es la otra mitad de `soloLoTocado`: lo que no está en el borrador queda como
 * vino del servidor, incluso si cambió desde que se empezó a escribir. Un campo
 * presente en el borrador pisa aunque valga vacío — haberlo borrado también es
 * haberlo tocado.
 *
 * Devuelve un objeto nuevo: ni el del servidor ni el del borrador se tocan, para
 * que «como nació» siga siendo comparable contra lo que hay en pantalla.
 */
export function conElBorrador<T extends object>(delServidor: T, borrador?: Partial<T> | null): T {
  return { ...delServidor, ...(borrador ?? {}) };
}

/**
 * Igualdad en profundidad para lo que lleva un formulario: valores simples, listas, objetos y fechas.
 * Un campo `undefined` y un campo ausente cuentan como iguales: un formulario no
 * debería figurar como tocado porque una clave existe con valor vacío en un lado y no en el otro.
 */
function iguales(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;

  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((valor, i) => iguales(valor, b[i]))
    );
  }

  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const claves = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const clave of claves) {
    if (!iguales(x[clave], y[clave])) return false;
  }
  return true;
}

/**
 * El almacén de borradores: un `Map` a nivel de módulo.
 *
 * **Está en memoria y no en `localStorage` ni `sessionStorage` a propósito.** Se
 * pidió que un borrador no sobreviva a cerrar la app, y lo que se guarda en el
 * teléfono sobrevive a todo: reaparecería días después sobre un trabajo que ya
 * no es ese. Un `Map` de módulo muere con el bundle, que es exactamente la vida
 * pedida.
 *
 * Lo que se pierde, a propósito: **recargar la página también lo borra.** Se
 * aceptó porque el caso a resolver es el formulario que se cierra por un toque
 * de más, no el navegador que se va.
 */
const borradores = new Map<string, unknown>();

/** Guarda (o pisa) el borrador de esa clave. */
export function guardarBorrador(clave: string, valor: unknown): void {
  borradores.set(clave, valor);
}

/** El borrador de esa clave, o `undefined` si nadie guardó uno: nunca un objeto vacío, que se confundiría con un formulario guardado en blanco. */
export function leerBorrador<T>(clave: string): T | undefined {
  return borradores.get(clave) as T | undefined;
}

/** Saca el borrador de esa clave, y sólo ése. */
export function tirarBorrador(clave: string): void {
  borradores.delete(clave);
}

/** Vacía todo el almacén. Sólo para los tests: el `Map` es de módulo y se arrastra entre casos. */
export function vaciarBorradores(): void {
  borradores.clear();
}
