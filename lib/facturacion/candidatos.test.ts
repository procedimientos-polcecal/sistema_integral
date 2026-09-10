import { describe, it, expect } from "vitest";
import { elegirLectura } from "./candidatos";

const TORRACO =
  "https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoiMjAyNi0wOS0wMSIsImN1aXQiOjIzMjE0ODExODM5LCJwdG9W\r\ndGEiOjUsInRpcG9DbXAiOjEsIm5yb0NtcCI6MzczMywiaW1wb3J0ZSI6MzEyMTgwMCwibW9u\r\nZWRhIjoiUEVTIiwiY3R6IjoxLCJ0aXBvRG9jUmVjIjo4MCwibnJvRG9jUmVjIjoiMzA2NDEw\r\nNjgwMTkiLCJ0aXBvQ29kQXV0IjoiRSIsImNvZEF1dCI6Ijg2MzUwODc5MzQzOTYwIn0=";

const CAMINO =
  "https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoiMjAyNi0wOS0wOSIsImN1aXQiOjMwNzEwOTc2MzU2LCJwdG9WdGEiOjUsInRpcG9DbXAiOjEsIm5yb0NtcCI6MzMxNwkJCSwiaW1wb3J0ZSI6MzgxNjYsODgsIm1vbmVkYSI6IlBFUyIsImN0eiI6MSwidGlwb0RvY1JlYyI6ODAsIm5yb0RvY1JlYyI6ODAsInRpcG";

/** Los QR que aparecen al costado en una factura de verdad. */
const QR_DE_PAGO = "https://www.mercadopago.com.ar/qr/00000000";
const QR_DE_UN_BANCO = "0040012300456789";

describe("elegir cuál de los QR de la hoja es el del comprobante", () => {
  it("el de ARCA gana aunque no sea el primero que se encontró", () => {
    const r = elegirLectura([QR_DE_PAGO, TORRACO, QR_DE_UN_BANCO]);
    expect(r.cabecera?.numero).toBe(3733);
    expect(r.texto).toBe(TORRACO);
    expect(r.motivo).toBeNull();
  });

  /*
   * Entre dos válidos, el que no hubo que reparar. Puede pasar en un PDF que
   * junta la factura con su nota de crédito, y el reparado es el que merece una
   * mirada humana: si hay uno sano, mejor ése.
   */
  it("entre dos válidos gana el que se leyó sin reparar", () => {
    expect(elegirLectura([CAMINO, TORRACO]).cabecera?.numero).toBe(3733);
    expect(elegirLectura([TORRACO, CAMINO]).cabecera?.numero).toBe(3733);
  });

  it("si el único válido es el reparado, se usa ése", () => {
    const r = elegirLectura([QR_DE_PAGO, CAMINO]);
    expect(r.cabecera?.numero).toBe(3317);
    expect(r.cabecera?.reparado).toBe(true);
  });

  /*
   * El caso que decide el diseño: hay QR, pero no es de ARCA. Guardar sus datos
   * pondría en la factura el número de otra cosa —el de un cupón de pago—, y eso
   * no se nota nunca después. Se prefiere que la persona tipee.
   */
  it("un QR que no es de ARCA no se usa ni siendo el único", () => {
    const r = elegirLectura([QR_DE_PAGO]);
    expect(r.cabecera).toBeNull();
    expect(r.motivo).toContain("ninguno es el de una factura de ARCA");
    // Y deja ver qué se leyó, que es lo que permite entender el caso.
    expect(r.texto).toBe(QR_DE_PAGO);
  });

  it("dice cuántos encontró, para distinguir el escaneo malo del QR ajeno", () => {
    expect(elegirLectura([QR_DE_PAGO]).motivo).toContain("un código QR");
    expect(elegirLectura([QR_DE_PAGO, QR_DE_UN_BANCO]).motivo).toContain("2 códigos QR");
  });

  it("sin ningún QR, el motivo no culpa al archivo: ofrece cargarla igual", () => {
    const r = elegirLectura([]);
    expect(r.cabecera).toBeNull();
    expect(r.texto).toBeNull();
    expect(r.motivo).toContain("No se encontró ningún código QR");
    expect(r.motivo).toContain("se puede cargar igual");
  });

  it("los vacíos y los espacios no cuentan como QR encontrados", () => {
    const r = elegirLectura(["", "   ", "\n"]);
    expect(r.motivo).toContain("No se encontró ningún código QR");
  });
});
