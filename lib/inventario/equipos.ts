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

import type { SupabaseClient } from "@supabase/supabase-js";
import { leerValores } from "@/lib/core/sheets";
import { traerTodo } from "@/lib/core/paginado";
import {
  indicePorNombre, indiceDeEquipos, reconocer, reconocerEquipo, type Indice,
} from "@/lib/inventario/enlaces";
import { claveDeProveedor } from "@/lib/core/proveedores";

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
  /**
   * Equipos que la pestaña pone bajo más de un sector. No se insertan ni se
   * actualizan: cuál es el sector bueno no se puede saber acá, y elegir el
   * primero sería elegir por el orden en que Google devolvió las filas. Se
   * informan para que alguien lo arregle en la pestaña.
   */
  enDosSectores: string[];
}

/**
 * Qué hay que hacerle a la lista para que refleje la pestaña.
 *
 * Va aparte de la escritura para poder probarla: es la parte que decide, y una
 * decisión equivocada acá deja el select ofreciendo un equipo del sector que no
 * es —o no ofreciendo ninguno—.
 *
 * **La clave es el nombre.** La pestaña no tiene ids, así que es lo único que
 * identifica una fila entre dos corridas. Se compara con `claveDeProveedor`
 * —sin acentos, sin mayúsculas, espacios colapsados— para que un espacio de más
 * en la planilla no inserte un duplicado; lo que se **guarda** es el texto
 * literal, que es lo que va a la columna K. Por eso, cuando la pestaña reescribe
 * el mismo equipo con otra capitalización o espaciado —la clave no cambia, pero
 * el literal sí—, `actualizados` lo lleva igual: si se guardara el literal
 * viejo, la app terminaría escribiendo en la K un texto que el desplegable de
 * esa fila ya no ofrece.
 *
 * Es `claveDeProveedor` y no una normalización propia porque la misma función
 * enlaza esta comparación pestaña↔lista y el enganche al núcleo (vía
 * `reconocerEquipo`, que también usa `claveDeProveedor` puertas adentro): si las
 * dos respondieran distinto sobre el mismo texto, la misma fila se identificaría
 * de dos formas dentro de una sola corrida.
 *
 * **Un equipo bajo dos sectores distintos de la pestaña no se resuelve solo.**
 * Elegir el primero que trajo Google sería resolver la ambigüedad por orden de
 * llegada, y este módulo no adivina: se informa por `enDosSectores` y ese equipo
 * no se toca —ni se inserta, ni se actualiza, ni se desactiva—.
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
 */
export function equiposQueCambian(
  pestana: ParDeLaPestana[],
  lista: EquipoDeLaLista[],
  destinos: { id: string; nombre: string }[],
  nucleo: Indice
): CambiosDeEquipos {
  const porDestino = indicePorNombre(destinos);

  const actual = new Map(lista.map((e) => [claveDeProveedor(e.nombre), e]));
  const cambios: CambiosDeEquipos = {
    nuevos: [], actualizados: [], desactivados: [], sinDestino: [], enDosSectores: [],
  };

  const vistos = new Set<string>();
  const sinDestino = new Set<string>();
  const enDosSectores = new Set<string>();

  // Primera pasada: agrupar la pestaña por equipo. Hace falta antes de decidir
  // nada, porque un equipo bajo dos sectores no se puede resolver eligiendo el
  // primero —eso sería elegir por el orden en que Google devolvió las filas— y
  // acá la ambigüedad se informa, no se resuelve sola.
  const agrupado = new Map<string, { nombre: string; destinos: Set<string>; sinResolver: string[] }>();

  for (const par of pestana) {
    const k = claveDeProveedor(par.equipo);
    if (!k) continue;

    if (!agrupado.has(k)) {
      agrupado.set(k, { nombre: par.equipo, destinos: new Set(), sinResolver: [] });
    }
    const grupo = agrupado.get(k)!;

    const destino_id = reconocer(porDestino, par.sector);
    if (destino_id) grupo.destinos.add(destino_id);
    else grupo.sinResolver.push(par.sector);
  }

  // Segunda pasada: decidir.
  for (const [k, grupo] of agrupado) {
    // Visto es "está en la pestaña", y eso ya se sabe. Marcarlo antes de
    // cualquier otra cosa es lo que evita que un destino que falta en el
    // catálogo, o un sector ambiguo, apaguen un equipo que la planilla sigue
    // ofreciendo: sería traducir un problema de catálogo —recuperable— en
    // apagar un dato que existe.
    vistos.add(k);

    for (const s of grupo.sinResolver) sinDestino.add(s);

    if (grupo.destinos.size > 1) { enDosSectores.add(grupo.nombre); continue; }

    const destino_id = [...grupo.destinos][0];
    // Ningún sector de este equipo resolvió: ya se informó por `sinDestino`.
    if (!destino_id) continue;

    const equipment_id = reconocerEquipo(nucleo, grupo.nombre);
    const ya = actual.get(k);

    if (!ya) {
      cambios.nuevos.push({ nombre: grupo.nombre, destino_id, equipment_id });
      continue;
    }
    if (
      ya.nombre !== grupo.nombre ||
      ya.destino_id !== destino_id ||
      ya.equipment_id !== equipment_id ||
      !ya.activo
    ) {
      cambios.actualizados.push({
        id: ya.id, nombre: grupo.nombre, destino_id, equipment_id, activo: true,
      });
    }
  }

  for (const e of lista) {
    if (e.activo && !vistos.has(claveDeProveedor(e.nombre))) cambios.desactivados.push(e.id);
  }

  cambios.sinDestino = [...sinDestino].sort();
  cambios.enDosSectores = [...enDosSectores].sort();
  return cambios;
}

/**
 * Deja la lista igual a la pestaña, y dice qué encontró.
 *
 * Lo que decide es `equiposQueCambian`; acá vive nada más que el orden en que
 * se llama y cómo se aplica. Si la pestaña no se puede leer, **no falla la
 * sincronización entera**: devuelve el error con lo que dijo Google, sin
 * traducir, y la lista queda como estaba. El kardex y los artículos entran
 * igual — perder las tres cosas porque una pestaña no se pudo leer es peor.
 */
export async function sincronizarEquipos(
  admin: SupabaseClient,
  planillaId: string,
  pestana: string
): Promise<{
  nuevos: number; actualizados: number; desactivados: number;
  sinDestino: string[]; enDosSectores: string[]; error?: string;
}> {
  const vacio = {
    nuevos: 0, actualizados: 0, desactivados: 0,
    sinDestino: [] as string[], enDosSectores: [] as string[],
  };

  let filas: string[][];
  try {
    filas = await leerValores(planillaId, pestana);
  } catch (e) {
    return { ...vacio, error: `No se pudo leer «${pestana}»: ${e instanceof Error ? e.message : String(e)}` };
  }

  const pares = filas
    .slice(1)
    .map((f) => filaDeSectorYEquipo(f))
    .filter((p): p is ParDeLaPestana => p !== null);

  // Una pestaña vacía no se aplica: desactivaría los 255 de una. Es más
  // probable que sea un rango mal leído que un pañol que borró la lista.
  if (pares.length === 0) {
    return { ...vacio, error: `La pestaña «${pestana}» vino sin pares sector/equipo. No se toca la lista.` };
  }

  const [lista, destinos, nucleo] = await Promise.all([
    traerTodo<EquipoDeLaLista>((desde, hasta) =>
      admin.from("inventario_equipos")
        .select("id, nombre, destino_id, equipment_id, activo").range(desde, hasta)
    ),
    traerTodo<{ id: string; nombre: string }>((desde, hasta) =>
      admin.from("inventario_destinos").select("id, nombre").eq("activo", true).range(desde, hasta)
    ),
    traerTodo<{ id: string; code: string | null; name: string }>((desde, hasta) =>
      admin.from("equipos").select("id, code, name").eq("is_active", true).range(desde, hasta)
    ).then(indiceDeEquipos),
  ]);

  const cambios = equiposQueCambian(pares, lista, destinos, nucleo);

  if (cambios.nuevos.length > 0) {
    const { error } = await admin.from("inventario_equipos").insert(cambios.nuevos);
    if (error) {
      return {
        ...vacio,
        sinDestino: cambios.sinDestino,
        enDosSectores: cambios.enDosSectores,
        error: error.message,
      };
    }
  }

  // De a uno: son unos pocos por corrida, y un upsert obligaría a mandar el
  // resto de las columnas — que es cómo se pisa sin querer lo que otro editó.
  //
  // `nombre` viaja acá y no sólo en los nuevos: si la pestaña reescribe el
  // literal sin cambiar su clave —mayúsculas, un espacio de más—, la base tiene
  // que quedarse con el nuevo. Es lo que la app escribe en la columna K, y el
  // desplegable acepta ese texto y no otro parecido.
  for (const c of cambios.actualizados) {
    await admin.from("inventario_equipos")
      .update({ nombre: c.nombre, destino_id: c.destino_id, equipment_id: c.equipment_id, activo: true })
      .eq("id", c.id);
  }

  // De a lotes de 200: un `.in()` con muchos ids arma una URL que PostgREST
  // rechaza con un 400 sin decir por qué.
  for (let i = 0; i < cambios.desactivados.length; i += 200) {
    await admin.from("inventario_equipos")
      .update({ activo: false })
      .in("id", cambios.desactivados.slice(i, i + 200));
  }

  return {
    nuevos: cambios.nuevos.length,
    actualizados: cambios.actualizados.length,
    desactivados: cambios.desactivados.length,
    sinDestino: cambios.sinDestino,
    enDosSectores: cambios.enDosSectores,
  };
}
