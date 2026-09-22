/**
 * Comparar el conteo de dos proyectos de Supabase: lo puro.
 *
 * Es lo único de la mudanza que se puede probar sin una base al lado, así que
 * es acá donde vive la decisión de qué cuenta como "está mal" —y no repartida
 * entre los comandos, que es donde no se puede mirar—.
 *
 * El I/O está en `supabase.ts`.
 */

/** Lo que se pudo contar de una tabla. `null` significa que NO se pudo leer. */
export interface Conteo {
  tabla: string;
  filas: number | null;
}

export interface Diferencia {
  tabla: string;
  origen: number | null;
  destino: number | null;
  motivo: string;
  /** Si es `true`, no se sigue con la mudanza. */
  fatal: boolean;
}

/**
 * Qué está mal entre dos conteos.
 *
 * **`null` no es cero, y ésa es toda la razón de que esta función exista.** Una
 * tabla que no se pudo leer y una tabla que quedó vacía se ven parecidas y son
 * cosas opuestas: la segunda es una pérdida de datos y la primera es no saber.
 * Si el comparador tratara el `null` como cero, las dos saldrían en la lista
 * como "faltan filas" y la que importa se perdería entre las otras —o peor, si
 * el ilegible fuera el origen, daría "sobran filas" en el destino y pasaría
 * por verde—.
 *
 * Es la misma regla que el resto del repo aplica a los enlaces por nombre:
 * cuando no se sabe, se deja vacío y se informa, en vez de poner el que se le
 * parece.
 *
 * Devuelve **todas** las diferencias, no la primera: en la ventana conviene ver
 * la lista entera de una sola pasada.
 */
export function compararConteos(origen: Conteo[], destino: Conteo[]): Diferencia[] {
  const enDestino = new Map(destino.map((c) => [c.tabla, c.filas]));
  const diferencias: Diferencia[] = [];

  for (const { tabla, filas } of origen) {
    // `has` y no `get() === undefined`: una tabla presente con valor `null` es
    // "no se pudo contar", que es distinto de "no existe".
    if (!enDestino.has(tabla)) {
      diferencias.push({
        tabla, origen: filas, destino: null,
        motivo: "no existe en el destino", fatal: true,
      });
      continue;
    }

    const otro = enDestino.get(tabla)!;

    if (filas === null || otro === null) {
      diferencias.push({
        tabla, origen: filas, destino: otro,
        motivo: "no se pudo contar", fatal: true,
      });
      continue;
    }

    if (otro < filas) {
      diferencias.push({
        tabla, origen: filas, destino: otro,
        motivo: "faltan filas", fatal: true,
      });
      continue;
    }

    if (otro > filas) {
      // No es fatal: pasa si alguien cargó algo después del dump. Hay que
      // verlo —puede significar que la base vieja se siguió usando— pero no
      // significa que se haya perdido nada.
      diferencias.push({
        tabla, origen: filas, destino: otro,
        motivo: "sobran filas", fatal: false,
      });
    }
  }

  const enOrigen = new Set(origen.map((c) => c.tabla));
  for (const { tabla, filas } of destino) {
    if (!enOrigen.has(tabla)) {
      diferencias.push({
        tabla, origen: null, destino: filas,
        motivo: "sobra en el destino", fatal: false,
      });
    }
  }

  return diferencias;
}

/** Si alguna de las diferencias impide seguir. */
export const hayAlgoFatal = (diferencias: Diferencia[]) => diferencias.some((d) => d.fatal);
