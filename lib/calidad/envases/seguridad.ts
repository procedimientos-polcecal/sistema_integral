/**
 * Cuánto falta para llegar al stock de seguridad, que es una cuenta **de grupo**.
 *
 * En el listado de la planilla, `STOCK DE SEGURIDAD` vive en celdas combinadas
 * que abarcan varias filas: el mínimo es del conjunto —cuántos bolsones de 1,20
 * hay en total, sin importar de qué proveedor— y se compara contra la suma de
 * todos ellos.
 *
 * Esto no puede ser una columna generada en la base: una columna generada sólo
 * ve su propia fila, y acá hace falta sumar las del grupo. Por eso vive en `lib`
 * y tiene tests, que es donde el repo pone lo que decide algo.
 *
 * Medido en la planilla real el 13/10/2026, y la cuenta cierra con los tres
 * bloques: 905 contra 2000 dan 1095, 1192 contra 1500 dan 308, y 600 contra 500
 * dan 0.
 */

export interface ArticuloConSeguridad {
  codigo: string;
  /** El código del primer artículo del bloque combinado. Un suelto es grupo de uno. */
  grupo_seguridad: string | null;
  stock_actual: number;
  /** El mínimo del grupo, repetido en cada miembro. */
  stock_seguridad: number;
}

export interface FaltanteDeGrupo {
  grupo: string;
  /** La suma del stock de todos los artículos del grupo. */
  stock: number;
  stock_seguridad: number;
  /** Cuánto falta para llegar al mínimo. Nunca negativo: sobrar no es faltar. */
  faltante: number;
  /** Cuántos artículos lo componen. Uno significa que no está combinado. */
  articulos: number;
}

/**
 * El faltante de cada grupo.
 *
 * Un artículo sin `grupo_seguridad` —porque la sincronización todavía no corrió
 * desde que existe la columna— cuenta como grupo de uno con su propio código, y
 * así la pantalla sigue mostrando algo razonable en vez de un renglón vacío.
 *
 * El mínimo del grupo se toma como el **mayor** de los que traen sus miembros, y
 * no el del primero: la sincronización los deja todos iguales, pero si alguna
 * fila quedara en cero por una lectura vieja, tomar el máximo da el mínimo real
 * del grupo en vez de apagar la alarma sin avisar. Quedarse corto acá se traduce
 * en no comprar algo que hace falta.
 */
export function faltantesPorGrupo(
  articulos: ArticuloConSeguridad[]
): Map<string, FaltanteDeGrupo> {
  const porGrupo = new Map<string, FaltanteDeGrupo>();

  for (const a of articulos) {
    const grupo = a.grupo_seguridad ?? a.codigo;
    const f = porGrupo.get(grupo) ?? {
      grupo, stock: 0, stock_seguridad: 0, faltante: 0, articulos: 0,
    };
    f.stock += a.stock_actual;
    f.stock_seguridad = Math.max(f.stock_seguridad, a.stock_seguridad);
    f.articulos += 1;
    porGrupo.set(grupo, f);
  }

  for (const f of porGrupo.values()) {
    f.faltante = Math.max(f.stock_seguridad - f.stock, 0);
  }

  return porGrupo;
}
