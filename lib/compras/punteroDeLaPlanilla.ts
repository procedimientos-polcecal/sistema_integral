/**
 * Dónde está cada requerimiento en la planilla.
 *
 * `hoja_origen` y `sheets_fila` **no son datos gestionados: son punteros de
 * posición.** Es lo único con lo que `exportarRequerimiento` sabe en qué celda
 * escribir, y el que los escribe es la importación, que lee la columna de N° de
 * cada pestaña fila por fila.
 *
 * Eso choca con `editado_en_app`. Esa marca existe para que la planilla no pise
 * el estado, el proveedor ni los costos de un RI que ya se gestionó desde el
 * sistema, y para eso la importación **saltea** su fila entera. Con la fila
 * salteada, el puntero también se congelaba, y ahí estaba el agujero: aprobar
 * desde el sistema pone la marca, y la aprobación es justamente lo que hace que
 * el `FILTER` lleve el RI a la pestaña de su área. O sea que el puntero se
 * congelaba en `Requerimientos internos` **el día antes** de que el RI llegara
 * a la pestaña donde se escriben las columnas de compra, y como el bloque de
 * `exportarRequerimiento` que las escribe exige una pestaña de área de verdad
 * (`esPestanaDeArea`), a esos RI no se les escribía nunca `SOLICITA`, ni
 * comparativa, ni proveedor, ni estado de compra, ni costos. Medido el
 * 10/09/2026: 12 requerimientos en ese estado, y nada revierte la marca.
 *
 * La separación, entonces: estar editado en la app impide que la planilla pise
 * **el dato**; no impide actualizar **dónde está la fila**.
 *
 * Vive acá y no dentro de `sheets.ts` para poder probarla, igual que
 * `fusionarConLoQueYaHabia`: es una decisión, no una llamada a Google.
 */

/** Dónde encontró la importación un RI en esta corrida. */
export interface DondeEsta {
  nro_ri: number;
  /** La pestaña. Para un RI que está en las dos, gana la del área. */
  hoja: string;
  /** La fila, numerada como la numera la planilla (la 1 es el encabezado). */
  fila: number;
}

/** El puntero que la base ya tenía guardado. */
export interface PunteroGuardado {
  hoja_origen: string | null;
  sheets_fila: number | null;
}

/** Un puntero a corregir, con el nombre que tienen las columnas en la tabla. */
export interface PunteroARefrescar {
  nro_ri: number;
  hoja_origen: string;
  sheets_fila: number;
}

/**
 * De las filas que la importación no pisa, cuáles cambiaron de lugar.
 *
 * Devuelve **sólo las que se movieron**, y eso no es una optimización de paso:
 * es lo que hace que el costo de esto sea cero en régimen. Cada puntero se
 * escribe con su propio `update` —cada fila lleva un par de valores distinto, y
 * un `upsert` en lote tendría que traer las columnas `not null` de la tabla
 * (`descripcion`, `fecha`), que es exactamente lo que acá no se puede pisar—,
 * así que si se escribieran todas las salteadas serían tantos pedidos a
 * PostgREST como RI congelados haya, cada quince minutos y para siempre.
 * Comparando primero, la corrida que sigue a la que acomoda un RI ya no escribe
 * nada.
 *
 * Un RI salteado que la planilla ya no tiene tampoco llega hasta acá: si no
 * apareció en ninguna pestaña, no está en `salteadas`, así que su puntero queda
 * apuntando a la última posición conocida en vez de quedar en null. Es a
 * propósito: es más útil una posición vieja —que la próxima escritura va a
 * fallar y anotar— que ninguna.
 */
export function punterosARefrescar(
  salteadas: DondeEsta[],
  guardado: ReadonlyMap<number, PunteroGuardado>
): PunteroARefrescar[] {
  const aRefrescar: PunteroARefrescar[] = [];

  for (const donde of salteadas) {
    const previo = guardado.get(donde.nro_ri);
    // Sin nada guardado no hay con qué comparar; se escribe, que es lo que
    // corresponde: un RI sin puntero no se puede exportar a ninguna parte.
    if (previo && previo.hoja_origen === donde.hoja && previo.sheets_fila === donde.fila) {
      continue;
    }
    aRefrescar.push({
      nro_ri: donde.nro_ri,
      hoja_origen: donde.hoja,
      sheets_fila: donde.fila,
    });
  }

  return aRefrescar;
}
