/**
 * Los repuestos de una OT nueva, cargados renglón por renglón.
 *
 * POR QUÉ EXISTE
 *
 * El formulario tenía **un solo campo de texto libre** —"Repuesto utilizado"—
 * donde la gente escribía "2 grillas 2 mm". Eso alcanza para que lo lea una
 * persona y no alcanza para nada más: no se puede sumar, ni pedir, ni cruzar
 * con el pañol, y cuando hacen falta dos repuestos se escriben los dos en la
 * misma línea de la forma que a cada uno le parezca.
 *
 * Ahora se cargan en renglones, cada uno con su cantidad. Los renglones se
 * guardan en `ordenes_trabajo_repuestos` —la tabla que ya existía para esto y
 * que alimenta el modal de repuestos de la orden— y **además** se juntan en un
 * texto para la planilla.
 *
 * POR QUÉ TAMBIÉN UN TEXTO
 *
 * Porque la planilla tiene **una sola celda**, `REPUESTO UTILIZADO`, y la
 * planilla manda. La regla de la casa es que toda ruta que toque un campo que
 * se exporta tiene que exportarlo: si los renglones se guardaran sólo en la
 * base, la celda quedaría vacía, la próxima sincronización leería ese vacío y
 * `ordenes_trabajo.repuesto` se borraría sola. El texto no es una copia de
 * más: es lo que hace que el espejo siga siendo un espejo.
 *
 * LA VARA DEL TEXTO
 *
 * No es "que se entienda": es que **lo pueda volver a leer el parseo que ya
 * existe**. `itemsDeRepuesto()` de `repuestosDesdeOt.ts` es el que saca los
 * repuestos de las 275 OT viejas, y lo que escribamos acá tiene que caer del
 * mismo lado. Por eso se separa con coma —que es por donde ese parseo corta— y
 * por eso una coma adentro de un nombre se reemplaza por un espacio: si no, un
 * renglón se leería como dos.
 */

/** Un renglón tal como lo carga el formulario. */
export interface LineaDeRepuesto {
  /** Texto y no número: la planilla recibe "2", "1/2", "20 cm". */
  cantidad: string;
  nombre: string;
}

/** Los renglones que valen: los que dicen qué repuesto es. */
export function lineasQueValen(lineas: readonly LineaDeRepuesto[] | undefined | null): LineaDeRepuesto[] {
  if (!Array.isArray(lineas)) return [];
  return lineas
    .map((l) => ({
      cantidad: String(l?.cantidad ?? "").trim(),
      // La coma es el separador del texto de la planilla: adentro de un nombre
      // partiría el renglón en dos al volver a leerlo.
      nombre: String(l?.nombre ?? "").replace(/,/g, " ").replace(/\s+/g, " ").trim(),
    }))
    .filter((l) => l.nombre !== "");
}

/**
 * El texto que va a la celda de la planilla.
 *
 * `null` cuando no hay ningún renglón, que es lo que la columna espera para
 * decir "no se usó nada" — una cadena vacía y un null se ven igual en la
 * planilla, pero en la base no.
 */
export function textoParaLaPlanilla(lineas: readonly LineaDeRepuesto[] | undefined | null): string | null {
  const valen = lineasQueValen(lineas);
  if (valen.length === 0) return null;
  return valen.map((l) => (l.cantidad ? `${l.cantidad} ${l.nombre}` : l.nombre)).join(", ");
}

/**
 * Las filas para `ordenes_trabajo_repuestos`.
 *
 * `codigo` queda en null a propósito: el formulario de alta no lo pide. Se
 * completa después desde el modal de repuestos de la orden, que además busca
 * contra el inventario — y un código inventado es peor que un código vacío.
 */
export function filasParaLaBase(
  workOrderId: string,
  lineas: readonly LineaDeRepuesto[] | undefined | null
): Array<{ work_order_id: string; nombre: string; codigo: null; cantidad: string | null }> {
  return lineasQueValen(lineas).map((l) => ({
    work_order_id: workOrderId,
    nombre: l.nombre,
    codigo: null,
    cantidad: l.cantidad || null,
  }));
}

/**
 * Lo que el cuerpo de la ruta dice que se usó, venga como venga.
 *
 * **Las dos formas conviven a propósito.** La carga sin señal guarda el cuerpo
 * armado y lo manda días después, así que un teléfono que no se actualizó
 * sigue mandando `repuesto` como texto suelto. Tratarlo como ausente le
 * borraría el repuesto a esa OT sin que nadie se entere.
 */
export function repuestosDelCuerpo(body: {
  repuesto?: unknown;
  repuestos?: unknown;
}): { texto: string | null; lineas: LineaDeRepuesto[] } {
  if (Array.isArray(body?.repuestos)) {
    const lineas = lineasQueValen(body.repuestos as LineaDeRepuesto[]);
    return { texto: textoParaLaPlanilla(lineas), lineas };
  }
  const suelto = typeof body?.repuesto === "string" ? body.repuesto.trim() : "";
  return { texto: suelto || null, lineas: [] };
}

/**
 * Los renglones con los que arranca el formulario, a partir de una carga parada.
 *
 * POR QUÉ NO ALCANZA CON `borradorDesdeElCuerpo`
 *
 * Esa función reconstruye el formulario de una carga que quedó parada, y
 * **descarta los objetos y los arreglos a propósito**: un `String({})` daría
 * «[object Object]» adentro de un campo de texto. Los repuestos ahora viajan
 * como arreglo, así que caen justo en esa regla y se perderían en silencio —
 * alguien que corrige una coma de una OT rechazada tendría que volver a cargar
 * todos los repuestos sin que nada se lo diga.
 *
 * Entiende las dos formas porque la cola guarda el cuerpo tal como se armó: una
 * carga parada hace dos semanas tiene `repuesto` de texto, y recuperarla como
 * un renglón es mejor que recuperarla vacía.
 *
 * Siempre devuelve al menos un renglón: el formulario necesita dónde escribir.
 */
export function lineasDesdeElCuerpo(
  cuerpo: Record<string, unknown> | null | undefined
): LineaDeRepuesto[] {
  const vacio = [{ cantidad: "", nombre: "" }];
  if (!cuerpo) return vacio;

  if (Array.isArray(cuerpo.repuestos)) {
    const lineas = lineasQueValen(cuerpo.repuestos as LineaDeRepuesto[]);
    return lineas.length > 0 ? lineas : vacio;
  }

  const suelto = typeof cuerpo.repuesto === "string" ? cuerpo.repuesto.trim() : "";
  // El texto entero al nombre y la cantidad vacía: partir "2 grillas 2 mm" en
  // cantidad y nombre es adivinar, y acá el que mira es quien lo escribió —
  // que lo acomode si quiere.
  return suelto ? [{ cantidad: "", nombre: suelto }] : vacio;
}
