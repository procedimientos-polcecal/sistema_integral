/**
 * De qué área es un aviso.
 *
 * Quien avisa que una máquina anda mal lo escribe en texto libre —«MARTIN
 * SANDOVAL», «Martín  Sandoval»— y de ahí hay que sacar el área para que el
 * aviso aparezca en la pantalla de quien corresponde. Es una sola regla porque
 * la llaman los tres caminos por los que entra un aviso (el relleno de los que
 * ya existen, el alta desde la app y la sincronización desde la planilla): si
 * cada uno decidiera por su cuenta, el mismo aviso caería en áreas distintas
 * según por dónde entró.
 *
 * LO QUE NO SE ADIVINA, Y POR QUÉ
 *
 * **Con dos áreas no se elige ninguna.** La administración permite asignar
 * varias a una persona, y quedarse con una de dos es adivinar. **Con un nombre
 * parecido tampoco**: si dos usuarios se escriben igual una vez sacados los
 * acentos, ninguno gana. En los dos casos el resultado es `null` y no «la más
 * probable», porque un área equivocada no se nota nunca: el aviso se guarda
 * igual, simplemente aparece en la pantalla de otro y desaparece de la de quien
 * tenía que verlo. Un aviso sin área, en cambio, se ve —queda a la vista de
 * quien administra— y se arregla a mano. Es la regla del sistema: enlazar al que
 * se le parece es peor que dejar en null.
 *
 * Los acentos, las mayúsculas y los espacios de más los resuelve
 * `claveDeNombre()`: la planilla escribe «MARTIN  SANDOVAL» con dos espacios en
 * quince avisos, y eso es el mismo nombre.
 */
import { indiceDeCatalogo, elQueNombra } from "@/lib/core/catalogo";
import { areaPorDefecto } from "@/lib/compras/areaDelUsuario";

export interface UsuarioConAreas {
  id: string;
  nombre: string;
  apellido: string;
  areas: readonly string[];
}

/**
 * Devuelve la función que, dado el texto de `quien_aviso`, dice de qué área
 * es el aviso. `null` cuando no se lo reconoce con certeza.
 *
 * Es un resolvedor y no una función de un solo tiro porque la sincronización la
 * llama una vez por aviso en cada corrida, y el índice se arma una sola vez.
 */
export function resolverElArea(
  usuarios: readonly UsuarioConAreas[]
): (quienAviso: string | null | undefined) => string | null {
  const indice = indiceDeCatalogo(
    usuarios.map((u) => ({ id: u.id, nombre: `${u.nombre} ${u.apellido}` }))
  );
  const areasDe = new Map(usuarios.map((u) => [u.id, u.areas]));

  return (quienAviso) => {
    const { id } = elQueNombra(indice, quienAviso ?? "");
    if (!id) return null;
    return areaPorDefecto(areasDe.get(id) ?? []) || null;
  };
}

/**
 * Qué `area_id` le toca a una fila que llega de la planilla. `undefined` quiere
 * decir «no mandes la columna», y **no es lo mismo que `null`**.
 *
 * El `upsert` de PostgREST escribe todas las columnas que van en el payload.
 * Mandar `area_id: null` porque la fila no se pudo resolver pisaría, en la
 * próxima corrida del cron y sin avisar, el área que alguien eligió en el modal
 * o corrigió a mano: la planilla no tiene columna de área, así que ella nunca
 * puede ser la que mande. Por eso la sincronización sólo **completa** —cuando el
 * aviso no tiene área y el nombre la resuelve— y en cualquier otro caso se queda
 * callada. El día que alguien «simplifique» esto a `area_id: x ?? null`, el bug
 * vuelve y no avisa.
 *
 * Es la misma familia de regla que `borradoDeEspejo`: sólo se escribe aquello
 * cuya ausencia —o en este caso, cuya presencia— prueba algo.
 */
export function areaParaElUpsert(
  areaGuardada: string | null | undefined,
  areaResuelta: string | null
): string | undefined {
  if (areaGuardada) return undefined;
  return areaResuelta ?? undefined;
}

/**
 * Parte las filas de la planilla en dos lotes para dos `upsert` distintos:
 * `conArea` lleva la columna `area_id`; `sinArea` no la tiene, ni siquiera como
 * null.
 *
 * **Con un solo lote no alcanza, y esta es la segunda mitad de la misma
 * trampa.** supabase-js arma el parámetro `columns` del upsert con la unión de
 * las claves de **todas** las filas, y a la fila que no trae una de ellas le
 * pone null. Basta una fila con `area_id` en el lote para que todas las demás
 * lo lleven como null en el `EXCLUDED` del `ON CONFLICT DO UPDATE`, y pisen el
 * área elegida a mano. Omitir la clave fila por fila no protege nada si viajan
 * juntas: tienen que viajar en llamadas separadas.
 */
export function repartirPorArea<T extends { oa_number: string; quien_aviso?: string | null }>(
  filas: readonly T[],
  areasGuardadas: ReadonlyMap<string, string>,
  areaDe: (quienAviso: string | null | undefined) => string | null
): { conArea: (T & { area_id: string })[]; sinArea: T[] } {
  const conArea: (T & { area_id: string })[] = [];
  const sinArea: T[] = [];

  for (const fila of filas) {
    const area = areaParaElUpsert(areasGuardadas.get(fila.oa_number), areaDe(fila.quien_aviso));
    if (area === undefined) sinArea.push(fila);
    else conArea.push({ ...fila, area_id: area });
  }

  return { conArea, sinArea };
}
