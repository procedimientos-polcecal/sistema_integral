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
