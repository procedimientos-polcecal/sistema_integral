/**
 * Las decisiones de un formulario que guarda lo que se va escribiendo, como
 * funciones puras: la clave bajo la que se guarda y si hay algo que guardar.
 * Nada acá toca el navegador, así que se prueban sin pantalla.
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

/** Igualdad en profundidad para lo que lleva un formulario: valores simples, listas, objetos y fechas. */
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
