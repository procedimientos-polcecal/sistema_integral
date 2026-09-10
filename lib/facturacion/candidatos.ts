import { leerQrAfip, type CabeceraDelComprobante } from "./qrAfip";

/**
 * Cuál de los QR de la hoja es el del comprobante.
 *
 * Una factura escaneada puede tener más de un QR y ya pasó: además del de ARCA
 * aparecen los de los emisores de comprobantes, los de "pagá con tu celular" y
 * los códigos de barras de los bancos. Y en un PDF de varias páginas se
 * rastrilla cada una, así que llegan varios candidatos.
 *
 * La regla es simple y no adivina: **gana el primero que se lee como un
 * comprobante de ARCA**, y entre esos, el que no hubo que reparar. Un QR que no
 * es de ARCA no se usa nunca, ni siquiera si es el único: preferimos que la
 * persona tipee cuatro datos antes que guardar una factura con el número de otra
 * cosa.
 *
 * Está separado del lector de archivos porque el lector no se puede probar acá
 * —necesita un navegador con canvas— y esta decisión sí.
 */

export interface EleccionDeQr {
  cabecera: CabeceraDelComprobante | null;
  /** El texto crudo del QR elegido. Se guarda para poder rastrear después. */
  texto: string | null;
  /**
   * Por qué no hay cabecera, en castellano. `null` cuando se leyó bien.
   *
   * Cuando había QR pero ninguno era de ARCA, el motivo lo dice y muestra qué
   * se leyó: es la diferencia entre "esta factura no tiene QR" y "el QR que
   * tiene es de otra cosa", que se arreglan de maneras distintas.
   */
  motivo: string | null;
}

export function elegirLectura(textos: string[]): EleccionDeQr {
  const limpios = textos.map((t) => t.trim()).filter((t) => t !== "");

  if (limpios.length === 0) {
    return {
      cabecera: null,
      texto: null,
      motivo:
        "No se encontró ningún código QR en el archivo. Si es un escaneo, puede " +
        "haber salido con poca definición; se puede cargar igual y completar los datos.",
    };
  }

  const leidos = limpios.map((texto) => ({ texto, lectura: leerQrAfip(texto) }));

  // Primero uno que se leyó sin reparar nada; después, uno reparado. Entre dos
  // válidos siempre es mejor el que vino bien.
  const sano = leidos.find((c) => c.lectura.ok && !c.lectura.cabecera.reparado);
  const cualquiera = leidos.find((c) => c.lectura.ok);
  const elegido = sano ?? cualquiera;

  if (elegido && elegido.lectura.ok) {
    return { cabecera: elegido.lectura.cabecera, texto: elegido.texto, motivo: null };
  }

  // Había QR y ninguno era de ARCA. El motivo del primero es el más informativo
  // que tenemos, y el recorte del contenido deja ver qué era.
  const primero = leidos[0];
  const motivo = primero.lectura.ok ? null : primero.lectura.motivo;

  return {
    cabecera: null,
    texto: primero.texto,
    motivo:
      `Se encontró ${leidos.length === 1 ? "un código QR" : `${leidos.length} códigos QR`}, ` +
      `pero ninguno es el de una factura de ARCA. ${motivo ?? ""}`.trim(),
  };
}
