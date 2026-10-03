/**
 * Qué se queda el sistema de un mail con facturas, y qué descarta.
 *
 * ## Por qué hace falta filtrar
 *
 * Un mail no trae sólo la factura. Trae el logo de la firma del remitente, el
 * ícono de LinkedIn, a veces un remito o un presupuesto. Si todo eso entrara a
 * la bandeja, la lista de "facturas esperando que las cargues" sería mitad
 * basura y nadie la miraría — que es exactamente el problema que esta bandeja
 * viene a resolver.
 *
 * ## Las dos reglas, y por qué son distintas para PDF y para imagen
 *
 * **Un PDF entra siempre.** Nadie adjunta un PDF decorativo: si está, alguien
 * lo puso a propósito. Y la factura electrónica argentina es un PDF en la
 * enorme mayoría de los casos.
 *
 * **Una imagen entra sólo si pesa.** El camino de la foto existe para lo que
 * llega por WhatsApp, y una foto de una factura no baja de un par de cientos de
 * KB; el logo de una firma son tres o cuatro. El umbral es un supuesto, no una
 * medición: **todavía no hay una casilla conectada para medirlo**. Está acá en
 * una constante y con nombre para que, cuando haya datos, se ajuste en un solo
 * lugar en vez de descubrirse en una pantalla llena de logos.
 *
 * Lo que se descarta **no se tira**: la bandeja lo guarda como `descartada` con
 * su motivo. Sin eso el script lo volvería a traer cada quince minutos, y no se
 * podría saber qué quedó afuera.
 */

/** Lo que el bucket acepta. Es la misma lista que la migración del buzón. */
const TIPOS = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

/** 20 MB, el límite del bucket. Más grande no se puede guardar. */
export const MAXIMO_BYTES = 20 * 1024 * 1024;

/**
 * Debajo de esto, una imagen es decoración y no un comprobante.
 *
 * Supuesto, no medición: una foto de una factura ronda los cientos de KB y el
 * logo de una firma, unos pocos. Se revisa cuando haya una casilla conectada.
 */
export const MINIMO_DE_UNA_IMAGEN = 25 * 1024;

export interface AdjuntoDelCorreo {
  nombre: string;
  tipo: string | null;
  tamano: number;
}

export type Veredicto = { sirve: true } | { sirve: false; motivo: string };

export function sirveComoFactura(a: AdjuntoDelCorreo): Veredicto {
  const tipo = (a.tipo ?? "").toLowerCase().split(";")[0].trim();

  if (!TIPOS.includes(tipo as (typeof TIPOS)[number])) {
    return { sirve: false, motivo: `No es un PDF ni una imagen (${tipo || "sin tipo"}).` };
  }

  if (a.tamano > MAXIMO_BYTES) {
    return { sirve: false, motivo: `Pesa ${enMegas(a.tamano)}, y el máximo son 20 MB.` };
  }

  // Un PDF entra siempre: nadie adjunta uno de adorno.
  if (tipo === "application/pdf") {
    // Un PDF de cero bytes no es un PDF.
    return a.tamano > 0 ? { sirve: true } : { sirve: false, motivo: "El archivo vino vacío." };
  }

  if (a.tamano < MINIMO_DE_UNA_IMAGEN) {
    return {
      sirve: false,
      motivo: `Imagen de ${enKilos(a.tamano)}: parece el logo de una firma y no una factura.`,
    };
  }

  return { sirve: true };
}

/**
 * Dónde se guarda el adjunto dentro del bucket.
 *
 * El nombre del archivo lo escribió el remitente, así que no se usa tal cual:
 * puede traer barras, acentos, espacios o `..`, y eso arma rutas que no son la
 * que se cree. Se deja sólo lo seguro y se conserva la extensión, que es lo
 * único del nombre original que el navegador necesita después.
 *
 * El id del mensaje va de carpeta: así los adjuntos de un mismo mail quedan
 * juntos y dos remitentes que mandan `factura.pdf` no se pisan.
 */
export function rutaDelAdjunto(mensajeId: string, nombre: string): string {
  const carpeta = soloSeguro(mensajeId) || "sin-id";
  const limpio = soloSeguro(nombre) || "adjunto";
  return `correo/${carpeta}/${limpio}`;
}

function soloSeguro(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "")
    .slice(0, 120);
}

const enMegas = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
const enKilos = (b: number) => `${Math.round(b / 1024)} KB`;

/**
 * Si un adjunto es una factura **nuestra**, leído de su texto.
 *
 * ## Por qué hace falta además del filtro de arriba
 *
 * El Apps Script mira todos los mails con adjuntos, no una etiqueta. Con ese
 * alcance, "un PDF entra siempre" trae presupuestos, remitos, contratos y
 * extractos bancarios. La bandeja se llenaría de cosas que no son facturas y
 * nadie la miraría.
 *
 * ## La regla, y por qué ésta
 *
 * Es la misma que ya usa el lector del buzón para separar al emisor del
 * receptor: **una factura nuestra lleva el CUIT de Polcecal o el de Polysan**.
 * No es una heurística sobre el nombre del archivo ni sobre el remitente: es un
 * dato que está impreso en el comprobante porque la ley lo exige.
 *
 * Y además tiene que parecer un comprobante —decirlo, o traer el número con
 * forma de `0001-00000001`—, porque nuestro CUIT también aparece en un contrato
 * o en un remito.
 *
 * Medido sobre los **336 PDF** de `FACTURAS/SEPTIEMBRE 2026`: **316 (94%)** la
 * cumplen.
 *
 * ## Los que no se pueden confirmar no se tiran
 *
 * Los otros 20 son **PDF sin capa de texto** —escaneos— y son facturas de
 * verdad. Del texto no se puede saber nada de ellos; habría que renderizar y
 * leer el QR, que es lo que hace el navegador y no el servidor.
 *
 * Descartarlos sería perder veinte facturas por mes sin que nadie se entere,
 * que es peor que mostrar de más. Entran como `dudoso` y la pantalla los marca.
 */

export type Reconocimiento =
  | { es: "factura" }
  | { es: "dudoso"; porque: string }
  | { es: "no"; porque: string };

/** Lo que distingue un comprobante de un contrato que también lleva el CUIT. */
const DICE_COMPROBANTE = /factura|nota\s*de\s*cr[eé]|nota\s*de\s*d[eé]|comprobante/i;
/** `0006-00010192`: punto de venta y número, como lo imprime ARCA. */
const TIENE_NUMERO = /\b\d{4,5}\s*-\s*\d{7,8}\b/;

/**
 * Lo que se le pasa: el texto del PDF, o el motivo por el que no se pudo abrir.
 *
 * Son dos cosas distintas y la pantalla tiene que poder distinguirlas. Un PDF
 * sin texto es un escaneo, que es normal; un PDF que no abre es un defecto, y
 * si los dos dicen "es un escaneo" el defecto no se ve nunca. Ya pasó.
 */
export type TextoOFallo = string | { fallo: string };

export function reconocerLaFactura(
  lectura: TextoOFallo,
  cuitsDelGrupo: string[]
): Reconocimiento {
  if (typeof lectura !== "string") {
    return {
      es: "dudoso",
      porque:
        `No se pudo abrir el PDF para revisarlo: ${lectura.fallo}. Se muestra igual para ` +
        "no perderla.",
    };
  }

  const texto = lectura;

  if (!texto.trim()) {
    return {
      es: "dudoso",
      porque:
        "El PDF no tiene texto, así que es un escaneo: no se pudo confirmar que sea una " +
        "factura. Se muestra igual para no perderla.",
    };
  }

  /*
   * Se comparan sin separadores porque cada emisor escribe el CUIT como quiere:
   * `30-64106801-9`, `30641068019`, y alguno le mete espacios.
   */
  const plano = texto.replace(/[-.\s]/g, "");
  const esNuestra = cuitsDelGrupo.some((c) => c && plano.includes(c.replace(/[-.\s]/g, "")));

  if (!esNuestra) {
    return {
      es: "no",
      porque: "No figura el CUIT de Polcecal ni el de Polysan: no es una factura nuestra.",
    };
  }

  if (!DICE_COMPROBANTE.test(texto) && !TIENE_NUMERO.test(texto)) {
    return {
      es: "no",
      porque:
        "Tiene el CUIT del grupo pero no dice ser una factura ni trae número de comprobante.",
    };
  }

  return { es: "factura" };
}
