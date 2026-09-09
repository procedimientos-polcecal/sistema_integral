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

import { indicePorNombre, reconocer, reconocerEquipo, type Indice } from "@/lib/inventario/enlaces";

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

/** Una fila de la lista, como está guardada. */
export interface EquipoDeLaLista {
  id: string;
  nombre: string;
  destino_id: string;
  equipment_id: string | null;
  activo: boolean;
}

export interface CambiosDeEquipos {
  nuevos: { nombre: string; destino_id: string; equipment_id: string | null }[];
  actualizados: { id: string; nombre: string; destino_id: string; equipment_id: string | null; activo: true }[];
  /** Ids de los que ya no están en la pestaña. Se desactivan; no se borran. */
  desactivados: string[];
  /** Sectores que la pestaña nombra y `inventario_destinos` no tiene. */
  sinDestino: string[];
}

/**
 * Qué hay que hacerle a la lista para que refleje la pestaña.
 *
 * Va aparte de la escritura para poder probarla: es la parte que decide, y una
 * decisión equivocada acá deja el select ofreciendo un equipo del sector que no
 * es —o no ofreciendo ninguno—.
 *
 * **La clave es el nombre.** La pestaña no tiene ids, así que es lo único que
 * identifica una fila entre dos corridas. Se compara con la misma normalización
 * que el resto del módulo —sin acentos, sin mayúsculas, espacios colapsados—
 * para que un espacio de más en la planilla no inserte un duplicado; lo que se
 * **guarda** es el texto literal, que es lo que va a la columna K. Por eso,
 * cuando la pestaña reescribe el mismo equipo con otra capitalización o
 * espaciado —la clave no cambia, pero el literal sí—, `actualizados` lo lleva
 * igual: si se guardara el literal viejo, la app terminaría escribiendo en la K
 * un texto que el desplegable de esa fila ya no ofrece.
 *
 * **Estar en la pestaña es lo único que hace falta para contar como "visto".**
 * Eso se marca antes de resolver el sector, así un destino que falta en
 * `inventario_destinos` —problema de catálogo, recuperable agregándolo— no
 * apaga un equipo que la planilla sigue ofreciendo. El sector sin resolver se
 * informa por `sinDestino`; no se traduce en un movimiento sobre el equipo.
 *
 * **No borra nunca.** Lo que desaparece de la pestaña queda `activo = false`:
 * los movimientos históricos le apuntan, y si un día la pestaña se lee mal, una
 * lista vaciada sería un select vacío que nadie relaciona con la sincronización.
 *
 * **Un sector que no es un destino se informa y su equipo no entra.** No se le
 * inventa un destino ni se lo cuelga del que se le parece: enlazar al que se le
 * parece es peor que dejar en null, y acá además dejaría el equipo colgado del
 * sector equivocado en el select de otra persona.
 *
 * La normalización es local y no `claveDeProveedor` porque acá la clave la usan
 * dos lados que no se hablan —la pestaña y la lista— y conviene que no dependa
 * de una función pensada para nombres de proveedor. Es la misma regla, escrita
 * para lo que compara.
 */
export function equiposQueCambian(
  pestana: ParDeLaPestana[],
  lista: EquipoDeLaLista[],
  destinos: { id: string; nombre: string }[],
  nucleo: Indice
): CambiosDeEquipos {
  const porDestino = indicePorNombre(destinos);
  const clave = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  const actual = new Map(lista.map((e) => [clave(e.nombre), e]));
  const cambios: CambiosDeEquipos = {
    nuevos: [], actualizados: [], desactivados: [], sinDestino: [],
  };

  const vistos = new Set<string>();
  const sinDestino = new Set<string>();

  for (const par of pestana) {
    const k = clave(par.equipo);
    if (!k || vistos.has(k)) continue;
    // Visto es "está en la pestaña", y eso ya se sabe acá. Marcarlo antes de
    // resolver el sector es lo que evita que un destino que falta en el
    // catálogo apague un equipo que la planilla sigue ofreciendo: eso sería
    // traducir un problema de catálogo —recuperable agregando el destino que
    // falta— en apagar un dato que existe. El sector que no se reconoce se
    // informa por `sinDestino` y nada más.
    vistos.add(k);

    const destino_id = reconocer(porDestino, par.sector);
    if (!destino_id) { sinDestino.add(par.sector); continue; }

    const equipment_id = reconocerEquipo(nucleo, par.equipo);
    const ya = actual.get(k);

    if (!ya) {
      cambios.nuevos.push({ nombre: par.equipo, destino_id, equipment_id });
      continue;
    }
    if (
      ya.nombre !== par.equipo ||
      ya.destino_id !== destino_id ||
      ya.equipment_id !== equipment_id ||
      !ya.activo
    ) {
      cambios.actualizados.push({ id: ya.id, nombre: par.equipo, destino_id, equipment_id, activo: true });
    }
  }

  for (const e of lista) {
    if (e.activo && !vistos.has(clave(e.nombre))) cambios.desactivados.push(e.id);
  }

  cambios.sinDestino = [...sinDestino].sort();
  return cambios;
}
