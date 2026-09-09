/**
 * La lista de equipos del pañol: el vocabulario de la columna K del kardex.
 *
 * En la planilla la K no es texto libre. Un `onEdit` de Apps Script le arma un
 * desplegable dependiente: cuando cambia el sector de la J, borra la K y le
 * pone una validación con los equipos de ese sector, leídos de la pestaña
 * **`Sectores/Equipos`** —columna A el sector, columna B el equipo—.
 *
 * Esa pestaña es la validación de verdad, así que **esta lista se espeja de
 * ella en cada sincronización** en vez de administrarse por pantalla. Es la
 * diferencia con `inventario_destinos` y `inventario_solicitantes`, que son
 * catálogos del SdG: a esos la planilla no los publica en ningún lado legible,
 * sólo en un rango de validación, y por eso se siembran una vez y se editan
 * acá. Un equipo nuevo, en cambio, el pañol lo tiene que agregar a la pestaña
 * igual —o el desplegable de la planilla no lo ofrece—, y el SdG lo levanta
 * solo.
 *
 * **El nombre se guarda literal.** Es lo que la app va a escribir en la K, y
 * tiene que ser un valor que el desplegable ofrezca: `EM8` es
 * "SCANIA 420 4x4" en la planilla y "CAMIÓN VOLCADOR 1" en `equipos`, así que
 * armar el texto desde el núcleo escribiría 26 nombres que nadie puede volver a
 * elegir. El núcleo se usa para enganchar por código y nada más.
 */

/** Un par de la pestaña, ya recortado. */
export interface ParDeLaPestana {
  sector: string;
  equipo: string;
}

/**
 * Un par de la pestaña. `null` si la fila no lo es.
 *
 * Hacen falta las dos columnas: un equipo sin sector no se puede colgar de
 * ningún destino y un sector sin equipo no aporta nada. Hoy la pestaña no tiene
 * ninguna a medias —se midieron las 255—, y esto es para que el día que
 * aparezca no entre una fila muda.
 */
export function filaDeSectorYEquipo(fila: unknown[]): ParDeLaPestana | null {
  const limpio = (v: unknown): string => {
    const s = String(v ?? "").trim();
    return s === "-" ? "" : s;
  };

  const sector = limpio(fila?.[0]);
  const equipo = limpio(fila?.[1]);
  if (!sector || !equipo) return null;

  return { sector, equipo };
}
