import { describe, it, expect } from "vitest";
import { cabeceraDeDescarga, nombreAscii } from "./descarga";

describe("el nombre reducido a ASCII", () => {
  it("translitera los acentos en vez de borrarlos", () => {
    // Es el nombre real que devuelve Odoo para una orden sin confirmar.
    expect(nombreAscii("Solicitud de cotización - P02429.pdf")).toBe(
      "Solicitud de cotizacion - P02429.pdf"
    );
  });

  it("deja intacto lo que ya es ASCII", () => {
    expect(nombreAscii("Orden de compra - P02420.pdf")).toBe("Orden de compra - P02420.pdf");
  });

  it("neutraliza las comillas, que cerrarían la cabecera antes de tiempo", () => {
    expect(nombreAscii('raro".pdf')).not.toContain('"');
  });

  it("neutraliza las barras y los saltos de línea", () => {
    const r = nombreAscii("a/b\\c\nd.pdf");
    expect(r).not.toMatch(/[/\\\r\n]/);
  });

  it("nunca devuelve vacío, porque un archivo sin nombre no se guarda", () => {
    expect(nombreAscii("")).toBe("archivo");
    expect(nombreAscii("   ")).toBe("archivo");
    expect(nombreAscii("的")).toBe("_");
  });
});

describe("la cabecera de descarga", () => {
  it("lleva las dos formas: la ASCII y la UTF-8 de la RFC 6266", () => {
    const c = cabeceraDeDescarga("Solicitud de cotización - P02429.pdf");
    expect(c).toContain('filename="Solicitud de cotizacion - P02429.pdf"');
    expect(c).toContain("filename*=UTF-8''Solicitud%20de%20cotizaci%C3%B3n%20-%20P02429.pdf");
  });

  it("hace bajar el archivo y no mostrarlo", () => {
    expect(cabeceraDeDescarga("x.pdf").startsWith("attachment;")).toBe(true);
  });

  it("el valor entero queda representable en una cabecera HTTP", () => {
    // Una cabecera es latin-1: si quedara un carácter fuera, el runtime
    // rechaza la respuesta entera y la descarga falla con un 500 opaco.
    const c = cabeceraDeDescarga("Órdenes ñandú «raras» - P1.pdf");
    expect([...c].every((ch) => ch.charCodeAt(0) < 256)).toBe(true);
  });
});
