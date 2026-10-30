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

/** Diez megas, que es también el `file_size_limit` del bucket. */
export const MAXIMO_DE_FOTO = 10 * 1024 * 1024;

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

/**
 * Lo que está mal con esta foto, **con las palabras que va a leer quien la
 * sacó**, o null si está bien.
 *
 * Los dos mensajes importan más de lo que parece: para la cola sin señal un
 * 400 es definitivo, así que la carga queda parada y este texto es lo único
 * que va a leer quien tenga que decidir si vuelve a la planta a sacarla de
 * nuevo. «No se pudo guardar la foto» no alcanza; «pesa 14 MB y el máximo son
 * 10» se puede accionar.
 */
export function problemaDeLaFoto(foto: { type: string; size: number }): string | null {
  if (!(TIPOS_DE_FOTO as readonly string[]).includes(foto.type)) {
    return `"${foto.type || "el archivo"}" no es una foto.`;
  }
  if (foto.size > MAXIMO_DE_FOTO) {
    return `La foto pesa ${Math.round(foto.size / 1024 / 1024)} MB y el máximo son 10.`;
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
