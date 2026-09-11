import { elegirLectura, type EleccionDeQr } from "./candidatos";
import { buscarQr, buscarQrConVentanas, type PixelesDe } from "./escaneoQr";
import { buscarLineas, type LecturaDeLineas } from "./lineasDelPdf";
import { discriminaIva } from "./comprobante";
import type { PDFPageProxy } from "pdfjs-dist";

/**
 * Leer el QR de una factura **en el navegador**, venga como PDF o como foto.
 *
 * Corre en el cliente y no en el servidor a propósito: el archivo se lee en la
 * máquina de quien lo está cargando, así que los datos aparecen en pantalla
 * antes de subir nada. Quien carga ve lo que el sistema entendió y lo corrige
 * ahí mismo. Del lado del servidor, cada corrección costaría una subida entera.
 *
 * ## Las dos pasadas, y por qué son dos
 *
 * Medido contra las **139 facturas de SEPTIEMBRE 2026** —la carpeta completa, no
 * una muestra—: **110 se leen solas**, sin que nadie tipee nada.
 *
 * 1. **La página dibujada, subiendo la definición.** 84 facturas se leen a 1600
 *    px de ancho y 17 más a 2600. Un QR de dos centímetros en una A4 dibujada a
 *    1600 px queda en unos 90 px, y el payload de ARCA —unos 290 caracteres, una
 *    matriz de 69×69 módulos— no llega a un píxel por módulo.
 * 2. **Ventanas deslizantes**, sólo si la primera falló y sólo en la página 1.
 *    Rescata 9. Cuesta segundos, y la comparación no es contra un segundo: es
 *    contra tipear la factura entera.
 *
 * La mediana quedó en 495 ms por factura, y el peor caso en 32 segundos.
 *
 * ## Dos cosas que se probaron y se cayeron
 *
 * **Leer las imágenes embebidas a resolución nativa.** Habría arreglado los QR
 * que el PDF estira (TODO RULEMAN). En Node funciona; **en el navegador no**,
 * porque pdf.js las decodifica con `OffscreenCanvas` dentro del worker y no
 * manda los píxeles al hilo principal. Medía bien y en producción no habría
 * hecho nada — se comprobó en un navegador de verdad y se sacó.
 *
 * **Que el QR estuviera dentro de la imagen de una página escaneada.** Era el
 * supuesto del spec para ZITO Y PRIOLA. No es así: sus facturas son "copia del
 * original" y **no traen el bloque de ARCA impreso**. Se rasterizó a 7000 px
 * para confirmarlo.
 *
 * ## Lo que ninguna pasada arregla
 *
 * 29 de las 139: las 12 sin QR de ZITO Y PRIOLA, las que el PDF estira, y unas
 * cuantas que jsQR no decodifica aunque se vean impecables (DON ALFREDO,
 * RUBIALES, ERGUY) —se probó a 7000 px, con umbral duro y con 274 ventanas: no
 * es resolución—. Para todas ésas el buzón acepta la carga y la persona completa
 * cuatro datos, que sigue siendo mejor que tipear la factura entera.
 */

/**
 * Los anchos a los que se dibuja la página, del más barato al más definido.
 *
 * El de 3600 se quedó **sin rescatar ninguna** una vez que los recortes llevaron
 * margen blanco: las 8 que lo necesitaban pasaron a leerse a 2600. Se deja
 * igual, porque cuesta sólo en las que ya iban a fallar y el próximo emisor
 * puede imprimir el QR más chico.
 */
const ANCHOS = [1600, 2600, 3600];

/** El ancho de la pasada de ventanas. Más que esto no mejoró nada y tarda el doble. */
const ANCHO_DE_VENTANAS = 3000;

/**
 * Cuántas páginas se rastrillan.
 *
 * El QR está en la primera en todas las facturas vistas, pero una factura con
 * remito adjunto llega como un PDF de dos o tres y el orden no siempre es el
 * esperado. Más allá de la tercera el costo no se paga.
 */
const PAGINAS_MAXIMAS = 3;

export interface LecturaDeFactura extends EleccionDeQr {
  /** Cuántas páginas tiene el archivo. 1 si es una foto. */
  paginas: number;
  /** La primera página dibujada chica, para que se vea qué archivo es. */
  vistaPrevia: string | null;
  /** Cuánto tardó, en milisegundos. */
  tardo: number;
  /** Con qué pasada se encontró. Sirve para saber si conviene ajustar los anchos. */
  comoSeEncontro: "página dibujada" | "ventanas" | null;
  /**
   * El detalle del comprobante, leído del texto del PDF.
   *
   * `null` en una imagen: una foto de WhatsApp no tiene capa de texto, y sacar
   * el detalle de ahí sería OCR, que es otro problema.
   */
  detalle: LecturaDeLineas | null;
}

export async function leerFactura(archivo: File): Promise<LecturaDeFactura> {
  const desde = Date.now();
  const esPdf =
    archivo.type === "application/pdf" || archivo.name.toLowerCase().endsWith(".pdf");

  const r = esPdf ? await deUnPdf(archivo) : await deUnaImagen(archivo);
  const eleccion = elegirLectura(r.textos);

  /*
   * El detalle se controla contra el **neto** del comprobante, que sale del
   * total del QR: si la factura discrimina IVA, el total viene con el 21%
   * adentro y las líneas están netas. Sin QR no hay neto y el detalle queda
   * marcado como que no se pudo confirmar — se muestra igual, pero nadie lo da
   * por bueno.
   */
  const detalle = r.filas.length
    ? buscarLineas(r.filas, { netoEsperado: netoDelComprobante(eleccion.cabecera) })
    : null;

  return {
    ...eleccion,
    paginas: r.paginas,
    vistaPrevia: r.vistaPrevia,
    comoSeEncontro: r.comoSeEncontro,
    detalle,
    tardo: Date.now() - desde,
  };
}

/** El neto sobre el que tienen que cerrar las líneas, o `null` si no se sabe. */
function netoDelComprobante(
  cabecera: { importeTotal: number; tipoComprobante: number } | null
): number | null {
  if (!cabecera) return null;
  if (!discriminaIva(cabecera.tipoComprobante)) return cabecera.importeTotal;
  return Math.round((cabecera.importeTotal / 1.21) * 100) / 100;
}

interface Hallazgo {
  textos: string[];
  /** Las filas de texto del PDF, para sacar el detalle. Vacío en una imagen. */
  filas: string[];
  paginas: number;
  vistaPrevia: string | null;
  comoSeEncontro: LecturaDeFactura["comoSeEncontro"];
}

async function deUnPdf(archivo: File): Promise<Hallazgo> {
  const pdfjs = await import("pdfjs-dist");

  /*
   * El worker se sirve como archivo estático desde `public/pdfjs/`, que copia
   * `scripts/copiar-worker-pdf.mjs` en cada dev y cada build. No se le pide al
   * bundler con `new URL(…, import.meta.url)` porque cuál bundler usa Next 16
   * cambia entre dev y build, y una falla ahí aparecería recién en el navegador
   * de quien está cargando una factura.
   */
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";

  const documento = await pdfjs.getDocument({
    data: new Uint8Array(await archivo.arrayBuffer()),
  }).promise;

  const paginas = documento.numPages;
  const hasta = Math.min(paginas, PAGINAS_MAXIMAS);
  let vistaPrevia: string | null = null;

  /*
   * El texto se lee **antes** que el QR y siempre, aunque el QR aparezca en el
   * primer intento: la búsqueda del QR corta apenas encuentra algo, así que si
   * el texto se leyera después nunca se leería en las facturas fáciles. Y es
   * barato: no dibuja nada.
   */
  const filas = await filasDeTexto(documento, hasta);

  // ── Pasada 1: la página dibujada, subiendo la definición ──
  for (let n = 1; n <= hasta; n++) {
    const pagina = await documento.getPage(n);

    for (const ancho of ANCHOS) {
      const { lienzo, ctx } = await dibujar(pagina, ancho);
      if (!ctx) break;
      if (n === 1 && vistaPrevia === null) vistaPrevia = miniatura(lienzo);

      const textos = buscarQr(pixelesDe(lienzo, ctx));
      if (textos.length > 0) {
        return { textos, filas, paginas, vistaPrevia, comoSeEncontro: "página dibujada" };
      }
    }
  }

  /*
   * ── Pasada 2: ventanas deslizantes, sólo si no quedó otra ──
   *
   * **Sólo la página 1.** En las 139 facturas el QR está siempre en la primera,
   * y correr las ventanas en tres páginas llevaba el peor caso a 53 segundos por
   * factura, contra los 32 de ahora. Con 19 por día, eso no es un detalle de
   * rendimiento: es la diferencia entre una cola que avanza y una que parece
   * colgada.
   */
  {
    const pagina = await documento.getPage(1);
    const { lienzo, ctx } = await dibujar(pagina, ANCHO_DE_VENTANAS);
    if (ctx) {
      const textos = buscarQrConVentanas(pixelesDe(lienzo, ctx));
      if (textos.length > 0) {
        return { textos, filas, paginas, vistaPrevia, comoSeEncontro: "ventanas" };
      }
    }
  }

  return { textos: [], filas, paginas, vistaPrevia, comoSeEncontro: null };
}

/**
 * Las filas de texto del PDF, en el orden en que están impresas.
 *
 * pdf.js devuelve fragmentos sueltos con su posición, no renglones: cada celda
 * de una tabla es un fragmento aparte. Se los agrupa por la coordenada Y —con
 * dos puntos de tolerancia, porque una misma fila no siempre queda al pixel— y
 * se los ordena por X, que es lo que reconstruye el renglón como se lee.
 *
 * No se limpia la repetición acá: hay emisores que dibujan cada texto dos veces
 * y eso se resuelve sobre la fila ya armada, en `sinRepetir`.
 */
async function filasDeTexto(
  documento: { numPages: number; getPage(n: number): Promise<PDFPageProxy> },
  hasta: number
): Promise<string[]> {
  const filas: string[] = [];

  for (let n = 1; n <= hasta; n++) {
    try {
      const contenido = await (await documento.getPage(n)).getTextContent();
      const porRenglon = new Map<number, { x: number; texto: string }[]>();

      for (const item of contenido.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const y = Math.round(item.transform[5]);
        const clave = [...porRenglon.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
        if (!porRenglon.has(clave)) porRenglon.set(clave, []);
        porRenglon.get(clave)!.push({ x: item.transform[4], texto: item.str });
      }

      // De arriba hacia abajo: en un PDF la Y crece hacia arriba.
      for (const [, partes] of [...porRenglon.entries()].sort((a, b) => b[0] - a[0])) {
        const renglon = partes
          .sort((a, b) => a.x - b.x)
          .map((p) => p.texto)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (renglon) filas.push(renglon);
      }
    } catch {
      // Un PDF sin capa de texto —un escaneo— no tiene nada que dar, y eso no
      // es un error: la factura entra igual con lo que dijo el QR.
    }
  }

  return filas;
}

/** Una foto de WhatsApp o un escaneo guardado como imagen. */
async function deUnaImagen(archivo: File): Promise<Hallazgo> {
  const bitmap = await createImageBitmap(archivo);
  let vistaPrevia: string | null = null;

  /*
   * Al natural primero: una foto de teléfono ya viene con definición de sobra.
   * Si no aparece se prueba **más chica**, que es lo contrario que con el PDF y
   * por otra razón: en una foto de 4000 px el QR ocupa cientos de píxeles por
   * módulo y el ruido del sensor y la compresión del JPEG le ensucian los
   * bordes. Reducirla promedia ese ruido.
   */
  const anchos = [bitmap.width, 2000, 1200].filter(
    (a, i, todos) => a > 0 && todos.indexOf(a) === i
  );

  const lienzos: Array<{ lienzo: HTMLCanvasElement; ctx: CanvasRenderingContext2D }> = [];

  for (const ancho of anchos) {
    const escala = Math.min(1, ancho / bitmap.width);
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.max(1, Math.round(bitmap.width * escala));
    lienzo.height = Math.max(1, Math.round(bitmap.height * escala));

    const ctx = lienzo.getContext("2d", { willReadFrequently: true });
    if (!ctx) break;

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
    if (vistaPrevia === null) vistaPrevia = miniatura(lienzo);

    const textos = buscarQr(pixelesDe(lienzo, ctx));
    if (textos.length > 0) {
      bitmap.close?.();
      return { textos, filas: [], paginas: 1, vistaPrevia, comoSeEncontro: "página dibujada" };
    }
    lienzos.push({ lienzo, ctx });
  }

  // El último recurso, sobre la de mayor definición.
  for (const { lienzo, ctx } of lienzos.slice(0, 1)) {
    const textos = buscarQrConVentanas(pixelesDe(lienzo, ctx));
    if (textos.length > 0) {
      bitmap.close?.();
      return { textos, filas: [], paginas: 1, vistaPrevia, comoSeEncontro: "ventanas" };
    }
  }

  bitmap.close?.();
  return { textos: [], filas: [], paginas: 1, vistaPrevia, comoSeEncontro: null };
}

/**
 * Un canvas visto como "dame los píxeles de este rectángulo", que es lo único
 * que `escaneoQr` necesita. El contexto por sí solo no sirve: no lleva el tamaño.
 */
function pixelesDe(lienzo: HTMLCanvasElement, ctx: CanvasRenderingContext2D): PixelesDe {
  return {
    width: lienzo.width,
    height: lienzo.height,
    getImageData: (x, y, w, h) => ctx.getImageData(x, y, w, h),
  };
}

/** Dibuja una página a un ancho dado, sobre fondo blanco. */
async function dibujar(pagina: PDFPageProxy, ancho: number) {
  const base = pagina.getViewport({ scale: 1 });
  const viewport = pagina.getViewport({ scale: ancho / base.width });

  const lienzo = document.createElement("canvas");
  lienzo.width = Math.ceil(viewport.width);
  lienzo.height = Math.ceil(viewport.height);

  const ctx = lienzo.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { lienzo, ctx: null };

  /*
   * Fondo blanco: un PDF sin fondo propio se dibuja sobre transparente, y un QR
   * negro sobre transparente no tiene el contraste que jsQR busca.
   */
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);

  /*
   * `intent: "print"` y no el "display" de por defecto, por una razón concreta:
   * en modo display pdf.js dibuja por tandas encadenadas con
   * `requestAnimationFrame`, que el navegador **congela en una pestaña que no
   * está a la vista**. Se comprobó: en una pestaña oculta el render nunca
   * termina. Con 19 facturas leyéndose de a una, alguien va a cambiar de
   * pestaña, y la cola quedaría clavada en "leyendo" hasta que volviera.
   *
   * Y para lo que hace falta acá es además el intent correcto: se busca un QR
   * impreso, o sea la página como saldría en papel.
   */
  await pagina.render({ canvas: lienzo, canvasContext: ctx, viewport, intent: "print" }).promise;
  return { lienzo, ctx };
}

/** La página dibujada a 420 px de ancho, para mostrar al lado del formulario. */
function miniatura(lienzo: HTMLCanvasElement): string | null {
  try {
    const chico = document.createElement("canvas");
    const escala = Math.min(1, 420 / lienzo.width);
    chico.width = Math.max(1, Math.round(lienzo.width * escala));
    chico.height = Math.max(1, Math.round(lienzo.height * escala));
    chico.getContext("2d")?.drawImage(lienzo, 0, 0, chico.width, chico.height);
    return chico.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  }
}
