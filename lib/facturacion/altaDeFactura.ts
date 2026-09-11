import { normalizarCuit } from "@/lib/core/cuit";
import { claveNatural, nombreDelComprobante, type ClaveNatural } from "./comprobante";
import type { CabeceraDelComprobante } from "./qrAfip";
import type { IdentificadoPor, OrigenDeFactura } from "./types";

/**
 * De lo que se leyó del comprobante a la fila que va al buzón.
 *
 * Todo lo que decide vive acá y no en la ruta, por la razón de siempre: es la
 * parte que se puede probar. La ruta sube el archivo y escribe; **qué** escribe
 * lo dice esta función.
 *
 * Las dos reglas que la gobiernan son las del sistema:
 *
 * - **Enlazar al que se le parece es peor que dejar en null.** El proveedor y la
 *   empresa se resuelven por CUIT, que es un identificador exacto, y nunca por
 *   nombre. Si el CUIT no está en el padrón, el enlace queda vacío y se informa.
 * - **El buzón no se bloquea.** Una factura entra aunque no se haya podido leer
 *   nada: los avisos dicen qué falta, no impiden guardar. Cargar una factura ya
 *   es lento; hacerla rebotar por un dato faltante sería empeorar justamente lo
 *   que este módulo vino a arreglar.
 */

export interface EmpresaDelGrupo {
  id: string;
  nombre: string;
  cuit: string | null;
}

export interface ProveedorDelPadron {
  id: string;
  nombre: string;
  cuit: string | null;
}

/** Lo que una persona puede completar o corregir a mano en la pantalla. */
export interface DatosAMano {
  cuitEmisor?: string | null;
  tipoComprobante?: number | null;
  puntoVenta?: number | null;
  numero?: number | null;
  fecha?: string | null;
  importeTotal?: number | null;
  moneda?: string | null;
  empresaId?: string | null;
  proveedorId?: string | null;
}

export interface PedidoDeAlta {
  /** Lo que dio el QR, si se pudo leer. */
  cabecera?: CabeceraDelComprobante | null;
  /** Lo que puso la persona. Manda sobre el QR sólo donde el QR no dijo nada. */
  aMano?: DatosAMano;
  origen: OrigenDeFactura;
  requerimientoId?: string | null;
  notas?: string | null;
  /**
   * El detalle que el navegador leyó del texto del PDF.
   *
   * Viene del cliente y no se calcula acá porque leer el PDF es cosa del
   * navegador —el servidor no lo tiene—, igual que el QR. Y como todo lo que
   * viene del cliente, la ruta lo revisa antes de guardarlo.
   */
  detalle?: {
    lineas: { descripcion: string; cantidad: number; precioUnitario: number; total: number }[];
    cuadra: boolean;
  } | null;
}

/** Los campos de `facturas_proveedor` que esta función decide. */
export interface FilaDeFactura {
  cuit_emisor: string | null;
  tipo_comprobante: number | null;
  punto_venta: number | null;
  numero: number | null;
  fecha: string | null;
  importe_total: number | null;
  moneda: string;
  cae: string | null;
  empresa_id: string | null;
  proveedor_id: string | null;
  requerimiento_id: string | null;
  origen: OrigenDeFactura;
  identificado_por: IdentificadoPor;
  estado: "recibida" | "vinculada";
  notas: string | null;
}

export interface AltaDeFactura {
  fila: FilaDeFactura;
  /** Los cuatro datos fiscales, cuando están los cuatro. Si no, `null`. */
  clave: ClaveNatural | null;
  /** "Factura A 0005-00003733", para el aviso de duplicado y el título. */
  nombre: string;
  /**
   * Qué no se pudo resolver, en castellano y en orden de importancia. No son
   * errores: la factura se guarda igual.
   */
  avisos: string[];
}

/**
 * `PES` y `DOL` es como lo escribe ARCA; en el resto del sistema las monedas son
 * `ARS` y `USD`. Traducirlo acá evita que el buzón sea el único lugar del SdG
 * donde un peso se llama distinto.
 */
export function monedaDelSdg(moneda: string | null | undefined): string {
  const m = (moneda ?? "").trim().toUpperCase();
  if (m === "PES" || m === "ARS" || m === "") return "ARS";
  if (m === "DOL" || m === "USD") return "USD";
  return m;
}

export function prepararAlta(
  pedido: PedidoDeAlta,
  catalogos: { empresas: EmpresaDelGrupo[]; proveedores: ProveedorDelPadron[] }
): AltaDeFactura {
  const qr = pedido.cabecera ?? null;
  const aMano = pedido.aMano ?? {};
  const avisos: string[] = [];

  // El QR manda donde habló: es el dato del emisor, no una transcripción. Lo de
  // la persona completa lo que el QR no trajo —y en una factura sin QR, todo.
  const cuitEmisor = normalizarCuit(qr?.cuitEmisor ?? null) ?? normalizarCuit(aMano.cuitEmisor);
  const tipoComprobante = primero(qr?.tipoComprobante, aMano.tipoComprobante);
  const puntoVenta = primero(qr?.puntoVenta, aMano.puntoVenta);
  const numero = primero(qr?.numero, aMano.numero);
  const fecha = qr?.fecha ?? aMano.fecha ?? null;
  const importeTotal = primero(qr?.importeTotal, aMano.importeTotal);

  const identificadoPor: IdentificadoPor = qr ? "qr" : "a mano";

  if (qr?.reparado) {
    avisos.push(
      "El QR venía roto y hubo que repararlo campo por campo. Mirá el importe y " +
        "la fecha contra el papel antes de darla por buena."
    );
  }

  // ── La empresa: a cuál de las dos se le facturó ──
  //
  // El QR lo dice, y es el ahorro más grande de todos: son ~19 facturas por día
  // y ninguna necesita que alguien elija la empresa.
  let empresaId = aMano.empresaId ?? null;
  const receptor = qr?.cuitReceptor ?? null;

  if (receptor) {
    const empresa = catalogos.empresas.find((e) => normalizarCuit(e.cuit) === receptor);
    if (empresa) {
      empresaId = empresa.id;
    } else if (!empresaId) {
      /*
       * Esto no es un detalle de datos: puede querer decir que la factura **no
       * es del grupo**. Que lo diga con el CUIT a la vista, porque quien la está
       * cargando puede reconocerlo.
       */
      avisos.push(
        `El comprobante está emitido al CUIT ${receptor}, que no es ni de POLCECAL ` +
          "ni de POLYSAN. Revisá que la factura sea del grupo."
      );
    }
  } else if (!empresaId) {
    avisos.push(
      qr
        ? "El QR no trae el CUIT del receptor, así que hay que elegir la empresa a mano."
        : "Sin QR no se sabe a qué empresa se le facturó: elegila a mano."
    );
  }

  // ── El proveedor: por CUIT, nunca por nombre ──
  let proveedorId = aMano.proveedorId ?? null;

  if (cuitEmisor) {
    const proveedor = catalogos.proveedores.find((p) => normalizarCuit(p.cuit) === cuitEmisor);
    if (proveedor) {
      proveedorId = proveedor.id;
    } else if (!proveedorId) {
      avisos.push(
        `El CUIT ${cuitEmisor} no figura en ningún proveedor del padrón. La factura se ` +
          "guarda igual; para que se enganche sola la próxima, cargale el CUIT al proveedor."
      );
    }
  } else if (!proveedorId) {
    avisos.push("No se pudo leer el CUIT del emisor: elegí el proveedor a mano.");
  }

  const clave = claveNatural({ cuitEmisor, tipoComprobante, puntoVenta, numero });
  if (!clave) {
    avisos.push(
      "Faltan datos fiscales del comprobante (CUIT, tipo, punto de venta y número), " +
        "así que no se va a poder detectar si esta factura entra dos veces."
    );
  }

  const requerimientoId = pedido.requerimientoId ?? null;

  return {
    fila: {
      cuit_emisor: cuitEmisor,
      tipo_comprobante: tipoComprobante,
      punto_venta: puntoVenta,
      numero,
      fecha,
      importe_total: importeTotal,
      moneda: monedaDelSdg(qr?.moneda ?? aMano.moneda),
      cae: qr?.cae ?? null,
      empresa_id: empresaId,
      proveedor_id: proveedorId,
      requerimiento_id: requerimientoId,
      origen: pedido.origen,
      identificado_por: identificadoPor,
      // Vincularla al requerimiento en el momento de cargarla la deja lista; si
      // no, queda en el buzón esperando que alguien diga de qué compra es.
      estado: requerimientoId ? "vinculada" : "recibida",
      notas: pedido.notas?.trim() || null,
    },
    clave,
    nombre: nombreDelComprobante({ tipoComprobante, puntoVenta, numero }),
    avisos,
  };
}

/** El primero de los dos que sea un número de verdad. */
function primero(
  delQr: number | null | undefined,
  aMano: number | null | undefined
): number | null {
  if (typeof delQr === "number" && Number.isFinite(delQr)) return delQr;
  if (typeof aMano === "number" && Number.isFinite(aMano)) return aMano;
  return null;
}
