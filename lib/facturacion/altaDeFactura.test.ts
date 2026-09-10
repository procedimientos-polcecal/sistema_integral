import { describe, it, expect } from "vitest";
import { leerQrAfip } from "./qrAfip";
import { monedaDelSdg, prepararAlta } from "./altaDeFactura";
import type { CabeceraDelComprobante } from "./qrAfip";

/*
 * Los catálogos son los de verdad, recortados: los CUITs de las dos empresas
 * salieron de `res.company.vat` de Odoo el 10/09/2026, y los dos proveedores
 * son los emisores de las dos facturas reales que se usaron para fijar el
 * lector del QR. Los CUITs del padrón del SdG **están con guiones** —los cargó
 * alguien a mano—, así que si el cruce no normalizara devolvería cero
 * coincidencias sin ningún error, que es exactamente el caso que estos tests
 * cuidan.
 */
const EMPRESAS = [
  { id: "emp-polcecal", nombre: "POLCECAL", cuit: "30641068019" },
  { id: "emp-polysan", nombre: "POLYSAN", cuit: "30707285008" },
];

const PROVEEDORES = [
  { id: "prov-torraco", nombre: "Torraco Pablo Javier", cuit: "23-21481183-9" },
  { id: "prov-camino", nombre: "Casa Camino", cuit: "30-71097635-6" },
  { id: "prov-sin-cuit", nombre: "ACERO RINCON", cuit: null },
];

const CATALOGOS = { empresas: EMPRESAS, proveedores: PROVEEDORES };

const TORRACO =
  "https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoiMjAyNi0wOS0wMSIsImN1aXQiOjIzMjE0ODExODM5LCJwdG9W\r\ndGEiOjUsInRpcG9DbXAiOjEsIm5yb0NtcCI6MzczMywiaW1wb3J0ZSI6MzEyMTgwMCwibW9u\r\nZWRhIjoiUEVTIiwiY3R6IjoxLCJ0aXBvRG9jUmVjIjo4MCwibnJvRG9jUmVjIjoiMzA2NDEw\r\nNjgwMTkiLCJ0aXBvQ29kQXV0IjoiRSIsImNvZEF1dCI6Ijg2MzUwODc5MzQzOTYwIn0=";

const CAMINO =
  "https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoiMjAyNi0wOS0wOSIsImN1aXQiOjMwNzEwOTc2MzU2LCJwdG9WdGEiOjUsInRpcG9DbXAiOjEsIm5yb0NtcCI6MzMxNwkJCSwiaW1wb3J0ZSI6MzgxNjYsODgsIm1vbmVkYSI6IlBFUyIsImN0eiI6MSwidGlwb0RvY1JlYyI6ODAsIm5yb0RvY1JlYyI6ODAsInRpcG";

function cabeceraDe(qr: string): CabeceraDelComprobante {
  const r = leerQrAfip(qr);
  if (!r.ok) throw new Error(r.motivo);
  return r.cabecera;
}

describe("una factura con QR limpio", () => {
  const alta = prepararAlta(
    { cabecera: cabeceraDe(TORRACO), origen: "mail" },
    CATALOGOS
  );

  /*
   * Es el resultado que justifica todo el módulo: de un archivo que llegó por
   * mail salen el emisor, el número, la fecha, el importe **y a cuál de las dos
   * empresas se le facturó**, sin que nadie tipee nada.
   */
  it("no queda nada por tipear", () => {
    expect(alta.fila).toEqual({
      cuit_emisor: "23214811839",
      tipo_comprobante: 1,
      punto_venta: 5,
      numero: 3733,
      fecha: "2026-09-01",
      importe_total: 3121800,
      moneda: "ARS",
      cae: "86350879343960",
      empresa_id: "emp-polcecal",
      proveedor_id: "prov-torraco",
      requerimiento_id: null,
      origen: "mail",
      identificado_por: "qr",
      estado: "recibida",
      notas: null,
    });
    expect(alta.avisos).toEqual([]);
  });

  it("tiene clave natural, así que se puede detectar el duplicado", () => {
    expect(alta.clave).toEqual({
      cuit_emisor: "23214811839",
      tipo_comprobante: 1,
      punto_venta: 5,
      numero: 3733,
    });
  });

  it("se nombra como el papel", () => {
    expect(alta.nombre).toBe("Factura A 0005-00003733");
  });

  it("vincularla al cargarla la deja lista, no en el buzón", () => {
    const conRi = prepararAlta(
      { cabecera: cabeceraDe(TORRACO), origen: "mail", requerimientoId: "ri-1933" },
      CATALOGOS
    );
    expect(conRi.fila.requerimiento_id).toBe("ri-1933");
    expect(conRi.fila.estado).toBe("vinculada");
  });
});

describe("una factura con el QR roto", () => {
  const alta = prepararAlta({ cabecera: cabeceraDe(CAMINO), origen: "papel" }, CATALOGOS);

  it("se identifica igual: emisor, número, fecha e importe", () => {
    expect(alta.fila).toMatchObject({
      cuit_emisor: "30710976356",
      tipo_comprobante: 1,
      punto_venta: 5,
      numero: 3317,
      fecha: "2026-09-09",
      importe_total: 38166.88,
      proveedor_id: "prov-camino",
      identificado_por: "qr",
    });
  });

  /*
   * A esta factura el emisor le cortó el payload justo en el CUIT del receptor,
   * así que no se sabe a qué empresa se le facturó. **No se inventa**: queda
   * vacío y el aviso le pide a una persona que la elija.
   */
  it("la empresa queda sin resolver, y se avisa", () => {
    expect(alta.fila.empresa_id).toBeNull();
    expect(alta.avisos.join(" ")).toContain("elegir la empresa a mano");
  });

  it("avisa que hubo que reparar el QR antes de dar el importe por bueno", () => {
    expect(alta.avisos[0]).toContain("reparar");
    expect(alta.avisos[0]).toContain("importe");
  });

  it("se puede completar la empresa a mano sin perder lo que dio el QR", () => {
    const corregida = prepararAlta(
      { cabecera: cabeceraDe(CAMINO), origen: "papel", aMano: { empresaId: "emp-polysan" } },
      CATALOGOS
    );
    expect(corregida.fila.empresa_id).toBe("emp-polysan");
    expect(corregida.fila.numero).toBe(3317);
    // Y ya no pide elegirla.
    expect(corregida.avisos.join(" ")).not.toContain("elegir la empresa");
  });
});

describe("una factura sin QR: la escaneada y la de papel", () => {
  it("entra igual, y los avisos dicen qué falta", () => {
    const alta = prepararAlta({ origen: "whatsapp" }, CATALOGOS);

    expect(alta.fila.identificado_por).toBe("a mano");
    expect(alta.fila.moneda).toBe("ARS");
    expect(alta.fila.estado).toBe("recibida");
    expect(alta.clave).toBeNull();

    const texto = alta.avisos.join(" ");
    expect(texto).toContain("Sin QR");
    expect(texto).toContain("CUIT del emisor");
    expect(texto).toContain("dos veces");
  });

  it("lo tipeado a mano llena la fila igual que el QR", () => {
    const alta = prepararAlta(
      {
        origen: "papel",
        aMano: {
          cuitEmisor: "23-21481183-9",
          tipoComprobante: 1,
          puntoVenta: 5,
          numero: 3734,
          fecha: "2026-09-02",
          importeTotal: 12345.67,
          empresaId: "emp-polcecal",
        },
      },
      CATALOGOS
    );

    expect(alta.fila).toMatchObject({
      cuit_emisor: "23214811839",
      numero: 3734,
      importe_total: 12345.67,
      empresa_id: "emp-polcecal",
      // El CUIT tipeado alcanza para engancharlo al padrón.
      proveedor_id: "prov-torraco",
      identificado_por: "a mano",
    });
    expect(alta.avisos).toEqual([]);
  });
});

describe("cuando el padrón no alcanza", () => {
  it("un emisor que no está en el padrón no se engancha al que se le parece", () => {
    const cabecera = { ...cabeceraDe(TORRACO), cuitEmisor: "30500000001" };
    const alta = prepararAlta({ cabecera, origen: "mail" }, CATALOGOS);

    expect(alta.fila.proveedor_id).toBeNull();
    expect(alta.avisos.join(" ")).toContain("30500000001");
    expect(alta.avisos.join(" ")).toContain("cargale el CUIT al proveedor");
  });

  /*
   * El aviso más útil de todos: si el receptor no es ninguna de las dos
   * empresas, puede que la factura no sea del grupo. Que lo diga con el CUIT a
   * la vista.
   */
  it("un receptor ajeno al grupo lo dice con el CUIT a la vista", () => {
    const cabecera = { ...cabeceraDe(TORRACO), cuitReceptor: "30999999999" };
    const alta = prepararAlta({ cabecera, origen: "mail" }, CATALOGOS);

    expect(alta.fila.empresa_id).toBeNull();
    expect(alta.avisos.join(" ")).toContain("30999999999");
    expect(alta.avisos.join(" ")).toContain("sea del grupo");
  });

  it("un proveedor sin CUIT en el padrón no se cruza con nada", () => {
    // ACERO RINCON tiene `cuit: null`: 146 de los 291 proveedores están así.
    const cabecera = { ...cabeceraDe(TORRACO), cuitEmisor: "30500000002" };
    const alta = prepararAlta({ cabecera, origen: "mail" }, CATALOGOS);
    expect(alta.fila.proveedor_id).toBeNull();
  });

  it("elegido a mano, el proveedor se respeta aunque el CUIT no esté", () => {
    const cabecera = { ...cabeceraDe(TORRACO), cuitEmisor: "30500000001" };
    const alta = prepararAlta(
      { cabecera, origen: "mail", aMano: { proveedorId: "prov-sin-cuit" } },
      CATALOGOS
    );
    expect(alta.fila.proveedor_id).toBe("prov-sin-cuit");
    expect(alta.avisos.join(" ")).not.toContain("no figura");
  });
});

describe("la moneda", () => {
  it("traduce como la escribe ARCA a como la escribe el SdG", () => {
    expect(monedaDelSdg("PES")).toBe("ARS");
    expect(monedaDelSdg("DOL")).toBe("USD");
  });

  it("sin moneda son pesos, que es el 99% de lo que entra", () => {
    expect(monedaDelSdg(null)).toBe("ARS");
    expect(monedaDelSdg("")).toBe("ARS");
  });

  it("una moneda que no se conoce se guarda como vino, no se fuerza a pesos", () => {
    expect(monedaDelSdg("EUR")).toBe("EUR");
  });
});

describe("las notas", () => {
  it("una nota en blanco no se guarda como cadena vacía", () => {
    const alta = prepararAlta({ origen: "papel", notas: "   " }, CATALOGOS);
    expect(alta.fila.notas).toBeNull();
  });

  it("una nota escrita se guarda sin los espacios de los costados", () => {
    const alta = prepararAlta({ origen: "papel", notas: "  llegó sin remito " }, CATALOGOS);
    expect(alta.fila.notas).toBe("llegó sin remito");
  });
});
