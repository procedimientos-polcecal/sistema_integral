/**
 * El CUIT que le falta a un proveedor del padrón, sacado de Odoo por el nombre.
 *
 * ## Por qué existe, y por qué es chico
 *
 * El padrón del SdG tiene **479 proveedores y 324 sin CUIT** (medido el
 * 11/11/2026), y sin CUIT no se puede cruzar con Odoo: el cruce por CUIT que ya
 * existe está saturado —correrlo de nuevo enlaza **uno** más—.
 *
 * Lo que esto arregla es deliberadamente poco. De los 324, **sólo 118 tienen
 * actividad** —un requerimiento o una factura—, y de ésos **9** coinciden por
 * nombre con un único CUIT de Odoo. Los otros 109 **no están en Odoo con ese
 * nombre**, ni siquiera mirando los 1.632 partners con CUIT en vez de los 634
 * marcados proveedor: ninguna forma de exportar y cruzar los encuentra, y ésos
 * se resuelven cuando llega su factura.
 *
 * O sea: esto no es "emparejar el padrón", es cerrar los nueve que se pueden
 * cerrar sin adivinar. Decirlo importa, porque el número hace creer que el
 * problema quedó resuelto.
 *
 * ## La regla: exacto después de normalizar, y único
 *
 * **Nunca por parecido.** Es la regla de diseño del sistema —enlazar al que se
 * le parece es peor que dejar en null— y acá muerde más que en otros lados: un
 * CUIT equivocado en el padrón no se nota nunca, y a partir de ahí las facturas
 * de otro proveedor se enganchan solas con éste.
 *
 * Lo único que se normaliza es lo que **no cambia quién es**: los acentos, la
 * puntuación, los espacios de más y la forma societaria —`S.R.L.`, `SA`, `SAS`—,
 * porque el padrón escribe «ZITO Y PRIOLA» donde Odoo escribe «ZITO Y PRIOLA
 * S.R.L.». Dos nombres que después de eso no son idénticos **no se tocan**.
 *
 * Y si el mismo nombre cae en dos CUIT distintos, tampoco: no hay forma de
 * elegir y elegir mal es el caso caro. Medido ese día: de los 48 que coinciden
 * por nombre en todo el padrón, **cero** son ambiguos.
 */

/** Lo que hace falta de un proveedor del padrón. */
export interface ProveedorSinCuit {
  id: string;
  nombre: string;
}

/** Lo que hace falta de un partner de Odoo. */
export interface PartnerConCuit {
  nombre: string;
  cuit: string;
}

export interface CuitPropuesto {
  proveedorId: string;
  /** Como está escrito en el padrón. */
  nombre: string;
  /** Como está escrito en Odoo, para poder mirarlos uno al lado del otro. */
  nombreEnOdoo: string;
  cuit: string;
}

/**
 * Dos filas del padrón que son la misma empresa, y por eso no se tocan.
 *
 * Apareció en el primer ensayo: «Pagano y Kopaitich SRL» y «Pagano y
 * kopaitich» son dos proveedores distintos en el SdG y el mismo en Odoo.
 * Ponerles el CUIT a los dos deja un CUIT repetido en el padrón, que es
 * exactamente lo que `cruzarProveedores` se niega a enlazar — así que el
 * resultado sería trabajo que no sirve, y encima más difícil de deshacer que
 * el problema original.
 *
 * No se elige uno: cuál se queda y cuál se fusiona es una decisión de datos
 * que no sale de los nombres.
 */
export interface CuitRepetido {
  cuit: string;
  nombreEnOdoo: string;
  proveedores: { id: string; nombre: string }[];
}

export interface Propuestas {
  /** Los que se pueden escribir sin crear un duplicado. */
  cuits: CuitPropuesto[];
  /** Los que quedan afuera porque dos filas del padrón son la misma empresa. */
  repetidos: CuitRepetido[];
}

/**
 * Las formas societarias que se sacan antes de comparar.
 *
 * Van sin puntos porque la puntuación ya se quitó, y con bordes de palabra para
 * que «SAS» no se coma el final de «CASAS».
 */
const FORMA_SOCIETARIA = /\b(S\s*R\s*L|SRL|S\s*A|SA|SAS|SACIF|SAIC|SACI|SH|S\s*C\s*C)\b/g;

/** Lo que no cambia quién es: acentos, puntuación, espacios y la forma societaria. */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[.,'"()\-/]/g, " ")
    .replace(FORMA_SOCIETARIA, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Propone un CUIT por proveedor, sólo cuando no hay duda.
 *
 * Devuelve **nada** —no una propuesta débil— cuando el nombre normalizado no
 * aparece en Odoo, cuando aparece con más de un CUIT, o cuando queda vacío
 * después de normalizar (un proveedor llamado «S.A.» no es nadie).
 */
export function proponerCuitPorNombre(
  sinCuit: readonly ProveedorSinCuit[],
  deOdoo: readonly PartnerConCuit[],
  /*
   * Los CUIT que el padrón ya usa. Un CUIT propuesto que ya está en otra fila
   * deja el mismo duplicado que dos filas entre sí, sólo que más difícil de
   * ver — por eso entra al mismo canasto.
   */
  cuitsYaEnElPadron: readonly string[] = []
): Propuestas {
  const porNombre = new Map<string, Map<string, string>>();

  for (const p of deOdoo) {
    const cuit = p.cuit.replace(/\D/g, "");
    if (!cuit) continue;
    const clave = normalizarNombre(p.nombre);
    if (!clave) continue;
    if (!porNombre.has(clave)) porNombre.set(clave, new Map());
    // Por CUIT y no por partner: el mismo proveedor existe una vez por
    // empresa en Odoo, y eso no es una ambigüedad.
    porNombre.get(clave)!.set(cuit, p.nombre);
  }

  const candidatas: CuitPropuesto[] = [];

  for (const prov of sinCuit) {
    const clave = normalizarNombre(prov.nombre);
    if (!clave) continue;

    const candidatos = porNombre.get(clave);
    if (!candidatos || candidatos.size !== 1) continue;

    const [cuit, nombreEnOdoo] = [...candidatos.entries()][0];
    candidatas.push({ proveedorId: prov.id, nombre: prov.nombre, nombreEnOdoo, cuit });
  }

  /*
   * Y recién acá se separa lo que crearía un duplicado. Tiene que ser un
   * segundo paso y no un filtro dentro del bucle: para saber que un CUIT le
   * toca a dos proveedores hay que haberlos visto a los dos.
   */
  const ocupados = new Set(cuitsYaEnElPadron.map((c) => c.replace(/\D/g, "")).filter(Boolean));
  const porCuit = new Map<string, CuitPropuesto[]>();
  for (const c of candidatas) {
    if (!porCuit.has(c.cuit)) porCuit.set(c.cuit, []);
    porCuit.get(c.cuit)!.push(c);
  }

  const cuits: CuitPropuesto[] = [];
  const repetidos: CuitRepetido[] = [];

  for (const [cuit, grupo] of porCuit) {
    if (grupo.length > 1 || ocupados.has(cuit)) {
      repetidos.push({
        cuit,
        nombreEnOdoo: grupo[0].nombreEnOdoo,
        proveedores: grupo.map((g) => ({ id: g.proveedorId, nombre: g.nombre })),
      });
      continue;
    }
    cuits.push(grupo[0]);
  }

  return { cuits, repetidos };
}
