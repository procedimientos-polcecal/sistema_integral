/**
 * Achicar la foto de una hoja antes de subirla.
 *
 * **Vercel rechaza los cuerpos de más de 4,5 MB antes de que lleguen a la
 * ruta**, y la foto de un teléfono los pasa fácil (una de 12 megapíxeles pesa
 * 3 a 8 MB). Sin esto la subida falla con un error de plataforma que no dice
 * nada útil. Por eso la foto se re-codifica **siempre**, también cuando ya es
 * chica: de paso normaliza la orientación (el EXIF de rotación se aplica al
 * dibujar y no viaja) y convierte el HEIC a JPEG, que es lo único que el
 * modelo lee.
 *
 * El tope se baja de a pasos —primero la calidad, después el lado largo— y se
 * corta apenas entra. Letra manuscrita pide resolución: se arranca grande y se
 * cede lo mínimo.
 *
 * HEIC: Safari lo decodifica; Chrome y Firefox en Windows no. Cuando el
 * navegador no puede, **no se sube** y se dice qué hacer: mandar el HEIC tal
 * cual dejaría la foto en `fallo` en la ruta, que es lo mismo pero más tarde y
 * con un mensaje del modelo en vez de uno claro.
 */

/** El cuerpo entero tiene que entrar en 4,5 MB con el resto del formulario. */
const TOPE_DE_BYTES = 3.5 * 1024 * 1024;

const LADOS_LARGOS = [2600, 2200, 1800, 1500];
const CALIDADES = [0.88, 0.78, 0.68];

export class FotoIlegible extends Error {}

export function esHeic(archivo: File): boolean {
  return /image\/hei[cf]/i.test(archivo.type) || /\.hei[cf]$/i.test(archivo.name);
}

async function decodificar(archivo: File): Promise<{ ancho: number; alto: number; dibujar: (c: CanvasRenderingContext2D, w: number, h: number) => void; cerrar: () => void }> {
  // `createImageBitmap` aplica la orientación del EXIF por defecto en los
  // navegadores actuales; el `<img>` también. Se prefiere el primero por ser
  // más barato con fotos grandes.
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(archivo, { imageOrientation: "from-image" });
      return {
        ancho: bmp.width, alto: bmp.height,
        dibujar: (c, w, h) => c.drawImage(bmp, 0, 0, w, h),
        cerrar: () => bmp.close(),
      };
    } catch {
      // Cae al <img>: algunos navegadores no aceptan el segundo argumento.
    }
  }
  // El link se suelta recién al cerrar: con el `<img>` aún hay que dibujar.
  const url = URL.createObjectURL(archivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return {
      ancho: img.naturalWidth, alto: img.naturalHeight,
      dibujar: (c, w, h) => c.drawImage(img, 0, 0, w, h),
      cerrar: () => URL.revokeObjectURL(url),
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function aBlob(canvas: HTMLCanvasElement, calidad: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", calidad));
}

/** Devuelve la foto como JPEG que entra en el cuerpo de una ruta de Vercel. */
export async function reducirFoto(archivo: File, nombre: string): Promise<File> {
  let origen;
  try {
    origen = await decodificar(archivo);
  } catch (e) {
    if (esHeic(archivo)) {
      throw new FotoIlegible(
        "Este navegador no puede abrir fotos HEIC (las del iPhone). Sacala en formato JPEG " +
        "(Ajustes > Cámara > Formatos > Más compatible), o subila desde Safari."
      );
    }
    throw new FotoIlegible(
      `No se pudo abrir la foto: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  try {
    const lado = Math.max(origen.ancho, origen.alto);
    let ultimo: Blob | null = null;
    for (const maximo of LADOS_LARGOS) {
      const escala = Math.min(1, maximo / lado);
      const w = Math.max(1, Math.round(origen.ancho * escala));
      const h = Math.max(1, Math.round(origen.alto * escala));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new FotoIlegible("El navegador no pudo preparar la foto para subirla.");
      // Fondo blanco: un PNG con transparencia saldría negro como JPEG.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      origen.dibujar(ctx, w, h);

      for (const calidad of CALIDADES) {
        const blob = await aBlob(canvas, calidad);
        if (!blob) throw new FotoIlegible("El navegador no pudo convertir la foto a JPEG.");
        ultimo = blob;
        if (blob.size <= TOPE_DE_BYTES) {
          return new File([blob], nombre, { type: "image/jpeg" });
        }
      }
    }
    throw new FotoIlegible(
      `La foto sigue pesando ${(ultimo!.size / 1024 / 1024).toFixed(1)} MB aun achicada y no entra en la subida (máximo 3,5 MB).`
    );
  } finally {
    origen.cerrar();
  }
}
