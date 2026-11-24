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
 * **Un link de Drive no se puede poner en un `<img>` tal como viene**, y eso
 * está medido: el 19/11/2026, contra la foto del OA A244, las tres formas que
 * suelen servir —`thumbnail?id=`, `uc?export=view` e
 * `lh3.googleusercontent.com/d/`— devolvieron las tres el login de Google.
 * Esa carpeta es privada y lo sigue siendo: lo que cambió ese mismo día es que
 * **se compartió con la cuenta de servicio del SdG** (el 404 de la API pasó a
 * 200), así que ahora el sistema la trae con su credencial y la sirve a quien
 * tenga sesión. Por eso una foto de Drive sale como `imagen` apuntando a
 * `/api/mantenimiento/avisos/foto`, y no al link de Google.
 *
 * **Eso necesita el id del aviso**, porque la ruta no acepta un id de Drive de
 * quien llama —ver el porqué en `fotoDeDrive.ts`— sino que lo saca de la fila.
 * Sin `avisoId` la foto vuelve a salir como enlace, que es exactamente lo que
 * se mostraba antes de compartir la carpeta: sirve de respaldo y no de error.
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
  | {
      tipo: "imagen";
      /** Qué dibujar, y adónde lleva el clic. */
      url: string;
      /**
       * Adónde mandar a la persona si el `<img>` falla. Lo llevan sólo las de
       * Drive: si el SdG no pudiera traerla —porque dejaron de compartir la
       * carpeta—, queda el link original, que al menos abre el dueño.
       */
      respaldo?: string;
    }
  /** No se puede mostrar acá: se abre aparte. `porQue` es lo que ve la persona. */
  | { tipo: "enlace"; url: string; porQue: string };

// El `(^|\.)` de cada alternativa, y no un `$` suelto: ver `fotoDeDrive.ts`.
const DRIVE = /(^|\.)((drive|docs)\.google|googleusercontent)\.com$/i;

/**
 * Los links que hay en UNA celda de la columna "Imagen".
 *
 * **El formulario de Google deja todas las fotos de una respuesta en una sola
 * celda, separadas por coma**, así que la celda no es "un link" sino una
 * lista. Medido el 23/11/2026 sobre la planilla real, el día que la columna
 * volvió a funcionar: 24 celdas con algo, **6 de ellas con más de un link** y
 * 31 fotos en total. Leer la celda como un link solo perdía 13 de las 31, y
 * no en silencio: el texto pegado no es la URL de nada, así que esos seis
 * avisos mostraban una imagen rota.
 *
 * Se buscan los links en vez de cortar por la coma: así una celda con texto
 * alrededor —o con el `#REF!` que esa columna tuvo durante meses— no deja
 * basura haciéndose pasar por una foto. El corte es en el espacio o la coma,
 * que es lo que una URL no puede tener sin escapar.
 */
export function linksDeFotos(celda: string | null | undefined): string[] {
  return (celda ?? "").match(/https?:\/\/[^\s,]+/gi) ?? [];
}

/**
 * Todas las fotos de un aviso, una por URL.
 *
 * **Es la lista que define qué significa el `n`** que viaja a
 * `/api/mantenimiento/avisos/foto`: la pantalla y la ruta la calculan con
 * esta misma función, así que el número quiere decir lo mismo de los dos
 * lados. Contar de distinta forma en cada punta es cómo se sirve la foto de
 * otro aviso sin que nada falle.
 */
export function urlsDeLasFotos(
  fotos: readonly (string | null | undefined)[] | null | undefined
): string[] {
  const salida: string[] = [];
  for (const celda of fotos ?? []) salida.push(...linksDeFotos(celda));
  return salida;
}

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
  fotos: readonly (string | null | undefined)[] | null | undefined,
  /**
   * El id del aviso. Con él, una foto de Drive se sirve desde el SdG y se ve
   * como cualquier otra; sin él queda como enlace, que es lo que se mostraba
   * antes de que la carpeta estuviera compartida.
   */
  avisoId?: string | null
): FotoDelAviso[] {
  const salida: FotoDelAviso[] = [];
  // Una celda puede traer varias fotos, así que el índice es el de la lista
  // aplanada y no el de `reference_photos`. La ruta la arma con esta misma
  // función: ver `urlsDeLasFotos`.
  const lista = urlsDeLasFotos(fotos);

  for (let i = 0; i < lista.length; i++) {
    const texto = lista[i];

    let url: URL;
    try {
      url = new URL(texto);
    } catch {
      continue; // No es un link: una ruta de disco, un "sin foto", un número.
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;

    if (DRIVE.test(url.hostname)) {
      if (avisoId) {
        salida.push({
          tipo: "imagen",
          url: `/api/mantenimiento/avisos/foto?aviso=${encodeURIComponent(avisoId)}&n=${i}`,
          respaldo: texto,
        });
      } else {
        salida.push({
          tipo: "enlace",
          url: texto,
          porQue: "Está en Drive: la abre quien tenga permiso sobre esa carpeta.",
        });
      }
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
