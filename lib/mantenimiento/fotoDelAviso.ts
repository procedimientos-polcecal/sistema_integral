/**
 * La foto de un aviso: qué se puede mostrar y qué sólo se puede enlazar.
 *
 * ── POR QUÉ HACE FALTA DECIDIRLO ──────────────────────────────────────────
 *
 * `avisos.reference_photos` lo llenan **dos fuentes que no se parecen**, y
 * tratarlas igual es lo que hacía que la pantalla no mostrara nada:
 *
 * - El alta del SdG (`NuevoAvisoModal` → `POST /api/mantenimiento/fotos`)
 *   guarda en Supabase Storage y devuelve un link directo al archivo. El
 *   bucket `execution-photos` es público —comprobado el 19/11/2026—, así que
 *   ese link se muestra como imagen y se ve sin sesión.
 * - El formulario de Google deja la foto en el Drive de quien es dueño del
 *   formulario y escribe en la columna K de la planilla un
 *   `drive.google.com/open?id=…`, que `filaAAviso()` copia tal cual.
 *
 * **Un link de Drive no se puede mostrar como imagen, y eso está medido**, no
 * supuesto: el 19/11/2026, contra la única foto que existe hoy (la del OA
 * A244), las tres formas que suelen servir —`thumbnail?id=`, `uc?export=view`
 * e `lh3.googleusercontent.com/d/`— devolvieron las tres el login de Google, y
 * la cuenta de servicio del SdG contestó **404** sobre ese archivo: tampoco lo
 * puede traer el servidor para servirlo de vuelta. O sea que esa carpeta de
 * Drive no está compartida con nadie más que su dueño. Por eso un `<img>` ahí
 * no mostraría una foto sino un cuadro roto, y lo honesto es el enlace: lo
 * abre quien tenga permiso, que hoy es quien recibe las respuestas.
 *
 * El día que alguien comparta esa carpeta con la cuenta de servicio, esto se
 * puede dar vuelta sin tocar la pantalla: el caso `enlace` de Drive pasa a ser
 * `imagen` apuntando a una ruta propia que la traiga.
 *
 * ── POR QUÉ SE FILTRA LO QUE NO ES http(s) ────────────────────────────────
 *
 * La columna K es texto libre que tipea una persona en la planilla, y
 * `filaAAviso()` **no la valida** —la que valida es la ruta del alta, y sólo
 * para lo que entra por la app—. Sin este filtro, un `javascript:…` escrito
 * ahí llegaría entero a un `href`. Es el mismo criterio que
 * `textoParaLaCelda()` por el otro lado del espejo.
 */

/** Una foto del aviso, ya clasificada para la pantalla. */
export type FotoDelAviso =
  | { tipo: "imagen"; url: string }
  /** No se puede mostrar acá: se abre aparte. `porQue` es lo que ve la persona. */
  | { tipo: "enlace"; url: string; porQue: string };

const DRIVE = /^(.+\.)?(drive|docs)\.google\.com$|googleusercontent\.com$/i;

/**
 * Lo que un navegador intenta dibujar en un `<img>`.
 *
 * `heic` entra aunque Chrome no lo sepa dibujar: el `<img>` de la pantalla
 * cae al enlace si la carga falla, así que equivocarse acá no deja un cuadro
 * roto, y Safari —que es la mitad de los teléfonos— sí lo muestra. Dejarlo
 * afuera, en cambio, le escondería la foto a quien sí podía verla.
 */
const EXTENSIONES = /\.(jpe?g|png|webp|gif|avif|heics?|heif)$/i;

export function fotosDelAviso(
  fotos: readonly (string | null | undefined)[] | null | undefined
): FotoDelAviso[] {
  const salida: FotoDelAviso[] = [];

  for (const cruda of fotos ?? []) {
    const texto = (cruda ?? "").trim();
    if (!texto) continue;

    let url: URL;
    try {
      url = new URL(texto);
    } catch {
      continue; // No es un link: una ruta de disco, un "sin foto", un número.
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;

    if (DRIVE.test(url.hostname)) {
      salida.push({
        tipo: "enlace",
        url: texto,
        porQue: "Está en Drive: la abre quien tenga permiso sobre esa carpeta.",
      });
      continue;
    }

    // La extensión se mira en el camino y no en el link entero: un link
    // firmado del bucket lleva el token en la query y terminaría en ".zz".
    if (EXTENSIONES.test(url.pathname)) {
      salida.push({ tipo: "imagen", url: texto });
      continue;
    }

    salida.push({
      tipo: "enlace",
      url: texto,
      porQue: "No se sabe si este link es una foto; se abre aparte.",
    });
  }

  return salida;
}
