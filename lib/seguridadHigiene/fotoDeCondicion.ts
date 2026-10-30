/**
 * Qué foto se acepta y dónde se guarda dentro del bucket.
 *
 * Está acá y no en una ruta porque **lo usan dos**: el alta de una condición
 * —que desde la cola sin señal llega con la foto adentro del mismo pedido— y
 * la ruta de fotos, que es por donde se agregan desde la ficha. Escrito dos
 * veces, un día la lista de tipos de una deja de decir lo mismo que la otra y
 * la foto que entra por un camino la rechaza el otro.
 *
 * Son funciones puras: no hablan con Storage ni con la base. Lo que sube el
 * archivo y lo enlaza está en `guardarLaFoto.ts`, que no se puede probar sin
 * una base.
 */

/**
 * Lo que una cámara de teléfono puede producir. Nada más.
 *
 * **TIENE QUE DECIR LO MISMO QUE `allowed_mime_types` DEL BUCKET**
 * (`20261029111056_syh_bucket_de_fotos.sql`). `image/heif` no va: cuando la
 * ruta de Mantenimiento lo aceptaba y el bucket no, una foto HEIF pasaba el
 * chequeo de la ruta y la rechazaba Storage con un 502 que no explicaba nada.
 * Si se suma un tipo, va en los dos lados.
 */
export const TIPOS_DE_FOTO = ["image/jpeg", "image/png", "image/webp", "image/heic"] as const;

/**
 * Lo que aguanta el bucket (`file_size_limit`), y **nada más que eso**.
 *
 * **NO ES EL LÍMITE DE NINGÚN CAMINO DE LA APLICACIÓN, Y NO SE PUEDE ALCANZAR
 * POR NINGUNO.** Describe lo que el archivo pesaría como mucho si llegara a
 * Storage; `MAXIMO_POR_PEDIDO`, abajo, describe lo que llega. Está exportado
 * para dos cosas: para que el número del bucket viva escrito en algún lado del
 * código, y para que un test lo ate con el de abajo — el día que alguien suba
 * el de abajo por encima de éste, el bucket rechazaría lo que la app aceptó.
 *
 * Si cambia `file_size_limit`, cambia acá.
 */
export const MAXIMO_DE_FOTO = 10 * 1024 * 1024;

/**
 * Lo que entra en un pedido, que es **el único límite que la aplicación puede
 * hacer cumplir**, y por eso vale para los dos caminos.
 *
 * Vercel corta el cuerpo de un pedido en 4,5 MB **antes de invocar la
 * función**, así que la respuesta es un 413 que el código de la ruta no llega
 * a contestar: ninguno de los mensajes de este archivo se usa, y lo que la
 * persona ve es un error genérico sobre una foto que no va a entrar nunca.
 *
 * **ESO LE PASA A LOS DOS CAMINOS Y NO SÓLO A LA COLA**, que es la corrección
 * del 30/10/2026 por la tarde: esta constante se llamaba `MAXIMO_EN_LA_COLA` y
 * la ruta de fotos —la de la ficha— seguía declarando el techo del bucket, con
 * el argumento de que ahí «el pedido lleva la foto y poco más y hay una
 * persona mirando». Lo primero es cierto y no importa: 6 MB de foto pasan los
 * 4,5 igual, vayan solos o acompañados. Lo segundo tampoco salva nada: la
 * persona miraba, sí, pero lo que había mirado **antes** de elegir el archivo
 * era un cartel que le prometía 10 MB. Una validación que promete un margen
 * que no existe es peor que no tener ninguna.
 *
 * Cuatro megas, debajo de los 4,5 con margen para el resto del multipart —por
 * el alta la foto viaja junto al cuerpo de la condición—. El margen vale para
 * los dos caminos aunque uno lo necesite menos: dos números distintos acá
 * serían otra vez dos promesas distintas sobre la misma foto.
 *
 * El otro lado de esta defensa es `clasificarFallo` en
 * `public/cola/colaOffline.js`, que desde el 30/10/2026 trata un 413 como
 * definitivo: ésta evita que la foto grande salga, y aquélla evita que una que
 * igual rebote se reintente para siempre.
 *
 * **Los 4,5 MB son de la documentación de Vercel y no están medidos contra
 * producción.** Es lo que falta para que este número deje de ser una
 * estimación prudente.
 */
export const MAXIMO_POR_PEDIDO = 4 * 1024 * 1024;

/**
 * La extensión que le corresponde al archivo **por su tipo**, y no por cómo se
 * llamaba en el teléfono.
 *
 * El nombre no sirve para esto en el camino que importa: la foto que viaja en
 * la cola se guarda como `Blob` en IndexedDB y un `Blob` no tiene nombre, así
 * que llega al servidor llamándose `foto` a secas. El tipo sí viaja siempre, y
 * además es el que ya se validó contra la lista de arriba.
 */
export function extensionDeLaFoto(tipo: string): string {
  if (tipo === "image/jpeg") return "jpg";
  if (tipo === "image/png") return "png";
  if (tipo === "image/webp") return "webp";
  if (tipo === "image/heic") return "heic";
  // No debería llegar nunca: `problemaDeLaFoto` corre antes y sólo deja pasar
  // los cuatro de arriba. Si algún día pasa, un archivo con extensión de más
  // es mejor que una ruta terminada en punto.
  return "jpg";
}

/** «4», «4,2»: los megas de un tamaño, sin el «,0» de los redondos. */
function enMegas(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "").replace(".", ",");
}

/**
 * Lo que está mal con esta foto, **con las palabras que va a leer quien la
 * sacó**, o null si está bien.
 *
 * Los dos mensajes importan más de lo que parece: para la cola sin señal un
 * 400 es definitivo, así que la carga queda parada y este texto es lo único
 * que va a leer quien tenga que decidir si vuelve a la planta a sacarla de
 * nuevo. «No se pudo guardar la foto» no alcanza; «pesa 6 MB y el máximo son
 * 4» se puede accionar, porque dice **cuánto entra** y no sólo que no entra.
 *
 * **EL MÁXIMO ES UNO SOLO Y NO UN PARÁMETRO**, y eso se corrigió el
 * 30/10/2026: llegó a serlo durante unas horas, con la idea de que cada camino
 * tuviera el suyo. No hay dos: todos los caminos de la app pasan por una
 * función de Vercel, así que todos chocan con el mismo corte de 4,5 MB (ver
 * `MAXIMO_POR_PEDIDO`). Un parámetro acá sólo servía para que un camino
 * prometiera un margen que no existe — que es exactamente lo que hacía la ruta
 * de fotos con sus 10 MB.
 */
export function problemaDeLaFoto(foto: { type: string; size: number }): string | null {
  if (!(TIPOS_DE_FOTO as readonly string[]).includes(foto.type)) {
    return `"${foto.type || "el archivo"}" no es una foto.`;
  }
  if (foto.size > MAXIMO_POR_PEDIDO) {
    return `La foto pesa ${enMegas(foto.size)} MB y el máximo son ${enMegas(MAXIMO_POR_PEDIDO)}.`;
  }
  // Un archivo de cero bytes pasa los dos chequeos de arriba y llega al bucket
  // sin que nada falle: queda una foto que no se puede abrir, indistinguible
  // de una que se rompió. Pasa de verdad cuando la cámara se interrumpe.
  if (foto.size === 0) return "La foto llegó vacía: volvé a sacarla.";
  return null;
}

/**
 * Dónde va el archivo dentro del bucket: `condiciones/<id>/<marca>.<ext>`.
 *
 * `marca` la pone quien llama (`Date.now()`) y no esta función, para que sea
 * pura y se pueda probar. El id se limpia aunque sea un uuid: lo que llega de
 * afuera termina siendo parte de una ruta, y un `a/../b` escribiría en otra
 * carpeta.
 */
export function rutaDeLaFoto(condicionId: string, tipo: string, marca: number): string {
  const limpio = condicionId.trim().replace(/[^A-Za-z0-9_-]/g, "-") || "sin-condicion";
  return `condiciones/${limpio}/${marca}.${extensionDeLaFoto(tipo)}`;
}
