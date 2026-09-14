import { normalizarCuit } from "@/lib/core/cuit";
import type { CabeceraDelComprobante } from "./qrAfip";

/**
 * Leer la cabecera de la factura del **texto** del PDF, cuando no hay QR.
 *
 * ## Para qué
 *
 * Hay emisores que no imprimen el bloque de ARCA. El caso grande es **ZITO Y
 * PRIOLA: 280 facturas en 2026**, el que más factura del grupo, y sus PDF son
 * "copia del original" sin QR. Hoy esas se tipean enteras: emisor, número,
 * fecha e importe. Su capa de texto, en cambio, está completa.
 *
 * ## El QR manda siempre
 *
 * Esto corre **sólo si no se encontró QR**. El QR es un dato firmado por ARCA; el
 * texto es un diseño impreso que cada sistema de facturación arma como quiere. No
 * compiten: uno es la fuente, el otro el último recurso.
 *
 * ## Cómo se distinguen los dos CUIT, que es lo que podría salir mal
 *
 * Una factura trae el del emisor y el del receptor, y confundirlos pondría la
 * factura a nombre del grupo. No se resuelve por posición en la hoja —cada
 * diseño la pone donde quiere— sino por un dato que ya tenemos: **el CUIT que es
 * de una de las dos empresas del grupo es el receptor; el otro es el emisor.**
 * Determinístico, no heurístico.
 *
 * ## Lo que se puede medir, y cómo
 *
 * Cada factura que **sí** trae QR es un banco de pruebas: se lee el texto, se
 * compara contra lo que dijo el QR, y ahí se ve si el lector acierta. Contra la
 * factura de ALMENTA —la única real disponible en esta máquina— saca los seis
 * campos y los seis coinciden con el QR.
 *
 * Lo que **no** está medido es la variedad: un solo diseño probado. Por eso todo
 * lo que no se encuentra queda en `null` y lo completa una persona, en vez de
 * arriesgar un número que después nadie revisa.
 */

export interface CabeceraLeidaDelTexto {
  cabecera: CabeceraDelComprobante | null;
  /** Qué campos no se pudieron sacar. Vacío cuando salieron todos. */
  falta: string[];
  /** Lo que sí se encontró, aunque no alcance para armar la cabecera. */
  parcial: {
    cuitEmisor: string | null;
    cuitReceptor: string | null;
    tipoComprobante: number | null;
    puntoVenta: number | null;
    numero: number | null;
    fecha: string | null;
    importeTotal: number | null;
    cae: string | null;
  };
}

/** Un número con formato argentino: `1.774.706,10`. */
function aNumero(texto: string): number | null {
  const limpio = texto.replace(/\./g, "").replace(",", ".");
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/** Todos los CUIT que aparecen, con o sin guiones, en orden de aparición. */
function cuitsDelTexto(filas: string[]): string[] {
  const encontrados: string[] = [];
  for (const fila of filas) {
    for (const m of fila.matchAll(/\b(\d{2})-?(\d{8})-?(\d)\b/g)) {
      const cuit = normalizarCuit(`${m[1]}${m[2]}${m[3]}`);
      if (cuit && !encontrados.includes(cuit)) encontrados.push(cuit);
    }
  }
  return encontrados;
}

/**
 * El número del comprobante: punto de venta y número.
 *
 * Se buscan primero las filas que además nombran el documento —`FACTURA Nº:
 * 0006-00010192`—, porque una hoja puede traer otros pares de números. El patrón
 * exige **cuatro o cinco dígitos** del lado del punto de venta, que es lo que
 * distingue `0006-00010192` de un CUIT escrito `20-16581164-0`.
 */
function numeroDelTexto(filas: string[]): { puntoVenta: number; numero: number } | null {
  const patron = /\b(\d{4,5})\s*-\s*(\d{7,8})\b/;
  const nombraElDocumento = /factura|nota\s+de|comprobante|recibo|ticket/i;

  for (const filtro of [true, false]) {
    for (const fila of filas) {
      if (filtro && !nombraElDocumento.test(fila)) continue;
      const m = fila.match(patron);
      if (m) return { puntoVenta: Number(m[1]), numero: Number(m[2]) };
    }
  }
  return null;
}

/** Letra impresa en el recuadro: una sola, a veces repetida por el doble dibujo. */
function letraDelTexto(filas: string[]): string | null {
  for (const fila of filas) {
    const m = fila.trim().match(/^([ABCME])(\s+\1)*$/);
    if (m) return m[1];
  }
  return null;
}

/** `FACTURA`, `NOTA DE CREDITO`… lo que el papel dice que es. */
function documentoDelTexto(filas: string[]): "factura" | "credito" | "debito" | null {
  const junto = filas.join(" ").toUpperCase();
  if (/NOTA\s+DE\s+CR[EÉ]DITO/.test(junto)) return "credito";
  if (/NOTA\s+DE\s+D[EÉ]BITO/.test(junto)) return "debito";
  if (/\bFACTURA\b/.test(junto)) return "factura";
  return null;
}

/** El código de ARCA, por documento y letra. Es la tabla oficial. */
const CODIGOS: Record<string, Record<string, number>> = {
  factura: { A: 1, B: 6, C: 11, M: 51, E: 19 },
  debito: { A: 2, B: 7, C: 12, M: 52, E: 20 },
  credito: { A: 3, B: 8, C: 13, M: 53, E: 21 },
};

/**
 * El tipo de comprobante, en código de ARCA.
 *
 * Primero el **código impreso**: casi todo sistema de facturación imprime
 * `Cod. 01` junto a la letra, y ése es el número de ARCA sin intermediarios.
 * Si no está, se arma con el documento y la letra.
 */
function tipoDelTexto(filas: string[]): number | null {
  for (const fila of filas) {
    const m = fila.match(/\bc[oó]d(?:igo)?\.?\s*:?\s*0*(\d{1,3})\b/i);
    if (m) {
      const codigo = Number(m[1]);
      if (codigo > 0) return codigo;
    }
  }

  const documento = documentoDelTexto(filas);
  const letra = letraDelTexto(filas);
  if (!documento || !letra) return null;
  return CODIGOS[documento]?.[letra] ?? null;
}

/**
 * La fecha de emisión, en ISO.
 *
 * Se descartan las filas que hablan de vencimiento o de inicio de actividades:
 * una factura trae tres o cuatro fechas y sólo una es la de emisión. Y se lee
 * **d/m/a**, que es como se escribe acá — leerlo al revés ya dio vuelta 885
 * fechas en Compras.
 */
function fechaDelTexto(filas: string[]): string | null {
  const noEsLaDeEmision = /vto|venc|inicio|desde|hasta|per[ií]odo|pago/i;

  for (const fila of filas) {
    if (noEsLaDeEmision.test(fila)) continue;
    const m = fila.match(/fecha\s*:?\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})/i);
    if (!m) continue;

    const dia = Number(m[1]);
    const mes = Number(m[2]);
    const anio = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (dia < 1 || dia > 31 || mes < 1 || mes > 12) continue;

    return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  }
  return null;
}

/**
 * El importe total.
 *
 * De las filas que dicen `TOTAL` —y no `SUBTOTAL`— se toma el número más grande.
 * El mayor porque el total es, por definición, mayor que el neto y que cada
 * impuesto; y de esas filas porque una factura tiene varios números grandes.
 */
function totalDelTexto(filas: string[]): number | null {
  let mayor: number | null = null;

  for (const fila of filas) {
    if (!/\btotal\b/i.test(fila) || /sub\s*-?\s*total/i.test(fila)) continue;
    for (const m of fila.matchAll(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2}/g)) {
      const n = aNumero(m[0]);
      if (n !== null && n > 0 && (mayor === null || n > mayor)) mayor = n;
    }
  }
  return mayor;
}

function caeDelTexto(filas: string[]): string | null {
  for (const fila of filas) {
    const m = fila.match(/c\.?\s*a\.?\s*e\.?\s*a?\.?\s*:?\s*(\d{14})\b/i);
    if (m) return m[1];
  }
  return null;
}

/**
 * La cabecera que se puede sacar del texto, o lo que falte para armarla.
 *
 * `cuitsDelGrupo` son los de POLCECAL y POLYSAN: es lo que separa al emisor del
 * receptor sin depender de dónde los imprima cada diseño.
 */
export function leerCabeceraDelTexto(
  filas: string[],
  cuitsDelGrupo: string[]
): CabeceraLeidaDelTexto {
  const delGrupo = new Set(cuitsDelGrupo.map(normalizarCuit).filter((c): c is string => c !== null));
  const cuits = cuitsDelTexto(filas);

  const cuitReceptor = cuits.find((c) => delGrupo.has(c)) ?? null;
  const cuitEmisor = cuits.find((c) => !delGrupo.has(c)) ?? null;

  const numero = numeroDelTexto(filas);
  const parcial = {
    cuitEmisor,
    cuitReceptor,
    tipoComprobante: tipoDelTexto(filas),
    puntoVenta: numero?.puntoVenta ?? null,
    numero: numero?.numero ?? null,
    fecha: fechaDelTexto(filas),
    importeTotal: totalDelTexto(filas),
    cae: caeDelTexto(filas),
  };

  /*
   * Sin estos cinco la cabecera no sirve: los cuatro primeros son la identidad
   * fiscal del comprobante —y la clave que detecta duplicados— y el importe es
   * lo que se contabiliza. El CAE y el receptor son deseables, no necesarios.
   */
  const falta = [
    parcial.cuitEmisor ? null : "el CUIT del emisor",
    parcial.tipoComprobante ? null : "el tipo de comprobante",
    parcial.puntoVenta === null ? "el punto de venta" : null,
    parcial.numero === null ? "el número" : null,
    parcial.fecha ? null : "la fecha",
    parcial.importeTotal ? null : "el importe",
  ].filter((x): x is string => x !== null);

  if (falta.length) return { cabecera: null, falta, parcial };

  return {
    falta: [],
    parcial,
    cabecera: {
      /*
       * `version: 0` dice **"esto no vino de un QR"**. El formato del QR de ARCA
       * arranca en 1, así que el cero no choca con nada y deja rastro de que la
       * cabecera se leyó del texto impreso.
       */
      version: 0,
      fecha: parcial.fecha!,
      cuitEmisor: parcial.cuitEmisor!,
      puntoVenta: parcial.puntoVenta!,
      tipoComprobante: parcial.tipoComprobante!,
      numero: parcial.numero!,
      importeTotal: parcial.importeTotal!,
      // Del texto no se saca la moneda con confianza; el 99% del grupo es en
      // pesos y el importe se muestra para revisar.
      moneda: "PES",
      cotizacion: 1,
      cuitReceptor: parcial.cuitReceptor,
      tipoDocReceptor: parcial.cuitReceptor ? 80 : null,
      cae: parcial.cae,
      tipoCae: parcial.cae ? "E" : null,
      // No es un QR roto que hubo que reparar: es otra fuente.
      reparado: false,
    },
  };
}
