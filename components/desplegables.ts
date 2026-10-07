import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { norm } from "@/lib/core/texto";

/**
 * Lo que comparten el desplegable de un valor y el de varios.
 *
 * Estaban por separado: el umbral vivía adentro de `MultiSelect` y el filtrado
 * era un `includes` escrito ahí mismo. Con dos piezas que se usan en los diez
 * módulos eso se va separando sin que nadie lo note, y "por qué este busca
 * distinto que el otro" no tiene respuesta.
 */

/**
 * Desde cuántas opciones un desplegable deja de recorrerse con la vista.
 *
 * Abajo de diez, el `<select>` nativo es mejor que cualquier panel propio —en el
 * teléfono abre la rueda del sistema— y una caja de búsqueda sólo estorba. Los
 * 273 proveedores, en cambio, no se recorren con la rueda del mouse.
 */
export const CON_BUSCADOR_DESDE = 10;

/** Una opción ya leída: lo que viaja al formulario y cómo se lee en pantalla. */
export type Opcion = {
  valor: string;
  etiqueta: string;
  deshabilitada: boolean;
};

/**
 * Si una etiqueta responde a lo que se escribió.
 *
 * Dos cosas que un `includes` pelado no hace:
 *
 * - **Ignora los acentos**, porque nadie los escribe al buscar: `olavarria`
 *   tiene que encontrar `Bolsas Olavarría`.
 * - **Acepta las palabras en cualquier orden.** Quien busca un equipo se acuerda
 *   de dos pedazos del nombre, no de cómo estaban ordenados: `olav bolsas`
 *   encuentra `Bolsas Olavarría` igual que `bolsas olav`.
 *
 * Se compara sólo contra la etiqueta visible. Hacer que un uuid que no está en
 * pantalla decida qué aparece da un resultado que después no se puede explicar.
 */
export function coincide(etiqueta: string, consulta: string): boolean {
  const q = norm(consulta);
  if (!q) return true;
  const texto = norm(etiqueta);
  return q.split(" ").every((pedazo) => texto.includes(pedazo));
}

/**
 * Las opciones que hay adentro de un desplegable, leídas de sus `<option>`.
 *
 * El componente recibe sus hijos igual que el `<select>` nativo, así que la
 * migración de las 75 pantallas fue renombrar la etiqueta. El precio es esto:
 * hay que recorrer los hijos a mano, y vienen de tres formas a la vez —un
 * `.map()` que devuelve un arreglo, un `{condicion && <option/>}` que devuelve
 * `false`, y fragmentos que envuelven a los dos—. `Children.toArray` aplana los
 * arreglos y tira los `false`, pero **no** entra en los fragmentos: eso hay que
 * hacerlo acá.
 *
 * De esta función depende el corte de las diez. Si cuenta de menos, una lista de
 * 273 proveedores se dibuja como un `<select>` nativo sin buscador, y el síntoma
 * —"a este no le salió el buscador"— no se parece en nada a la causa.
 */
export function opcionesDeLosHijos(children: ReactNode): Opcion[] {
  const encontradas: Opcion[] = [];

  const recorrer = (nodos: ReactNode) => {
    for (const hijo of Children.toArray(nodos)) {
      if (!isValidElement(hijo)) continue;

      const props = hijo.props as { value?: unknown; disabled?: boolean; children?: ReactNode };

      if (hijo.type === Fragment) {
        recorrer(props.children);
        continue;
      }

      if (hijo.type !== "option") continue;

      const etiqueta = textoDe(props.children);
      encontradas.push({
        // Un `<option>` sin `value` vale lo que dice: así lo resuelve el
        // navegador, y en el repo hay dos escritos de esa forma.
        valor: props.value === undefined ? etiqueta : String(props.value),
        etiqueta,
        deshabilitada: props.disabled === true,
      });
    }
  };

  recorrer(children);
  return encontradas;
}

/**
 * El texto de un `<option>`.
 *
 * Casi siempre son pedazos sueltos —`{e.legajo} - {e.apellido}` llega como cinco
 * nodos— que hay que pegar. Un elemento adentro se ignora en vez de romper: no
 * hay ninguno en el repo, pero una etiqueta a medias se lee, y una excepción en
 * el render deja la pantalla en blanco.
 */
function textoDe(nodo: ReactNode): string {
  if (nodo === null || nodo === undefined || typeof nodo === "boolean") return "";
  if (typeof nodo === "string") return nodo;
  if (typeof nodo === "number") return String(nodo);
  if (Array.isArray(nodo)) return nodo.map(textoDe).join("");
  if (isValidElement(nodo)) return textoDe((nodo.props as { children?: ReactNode }).children);
  return "";
}

/**
 * Qué hacer con una tecla apretada sobre un desplegable **cerrado**.
 *
 * Devuelve `null` si esa tecla no abre nada, o el texto con el que arrancar la
 * búsqueda —`""` cuando abre sin escribir nada—.
 *
 * Existe porque abrir y recién después poder escribir es lo que hacía lento al
 * panel: con el campo enfocado había que apretar una flecha o dar un clic antes
 * de tipear la primera letra, y el `<select>` nativo que este componente
 * reemplaza sí salta escribiendo. Acá además la letra **no se pierde**: arranca
 * la búsqueda en vez de sólo abrir.
 *
 * Es una función aparte y no un `if` adentro del componente para poder probarla:
 * las pantallas no tienen tests, y decidir esto mal deja un desplegable donde
 * `Ctrl+C` escribe una "c" en el buscador.
 */
export function teclaQueAbre(e: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): string | null {
  // Con un modificador la tecla es un atajo del navegador o del sistema, no
  // algo que alguien quiera escribir.
  if (e.ctrlKey || e.metaKey || e.altKey) return null;

  // Las flechas y la barra abren el panel sin escribir, como el nativo.
  if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === " ") return "";

  // Un caracter imprimible arranca la búsqueda con él. Las teclas con nombre
  // —"Enter", "Tab", "Escape", "F3"— tienen `key` de más de un caracter, así
  // que esto las deja pasar de largo sin enumerarlas.
  return e.key.length === 1 ? e.key : null;
}
