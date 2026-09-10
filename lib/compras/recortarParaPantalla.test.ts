import { describe, it, expect } from "vitest";
import { recortarParaPantalla } from "./texto";

/**
 * El motivo que se muestra en el cartel del alta.
 *
 * Lo que se prueba es que el recorte sea **sólo de presentación**: nunca cambia
 * un mensaje que ya entra, y nunca deja algo tan largo que rompa el bloque.
 */
describe("recortarParaPantalla", () => {
  it("un motivo corto vuelve tal cual", () => {
    const corto = "el pedido no tiene área, y la planilla la necesita";
    expect(recortarParaPantalla(corto)).toBe(corto);
  });

  it("colapsa los saltos de línea que trae el mensaje de Google", () => {
    expect(recortarParaPantalla("al escribir\n  la hoja:\tfalló")).toBe(
      "al escribir la hoja: falló"
    );
  });

  it("nada no revienta", () => {
    expect(recortarParaPantalla(null)).toBe("");
    expect(recortarParaPantalla(undefined)).toBe("");
  });

  it("recorta al máximo y avisa que recortó", () => {
    const largo = "palabra ".repeat(60).trim();
    const salida = recortarParaPantalla(largo, 100);
    expect(salida.length).toBeLessThanOrEqual(101); // los 100 más el "…"
    expect(salida.endsWith("…")).toBe(true);
    // Cortó en un espacio: no quedó una palabra partida al medio.
    expect(salida).not.toMatch(/pal…$|palab…$/);
  });

  // El caso que motivó la función: el mensaje de Google con la URL de
  // activación de la API adentro, que no tiene espacios y no corta.
  it("una URL larga sin espacios se corta seco en vez de perder todo", () => {
    const url =
      "Google Sheets API has not been used in project 1234567890 before or it is " +
      "disabled. Enable it by visiting " +
      "https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=1234567890" +
      "-then-retry-and-propagation-may-take-a-few-minutes";
    const salida = recortarParaPantalla(url, 240);
    expect(salida.length).toBeLessThanOrEqual(241);
    expect(salida.endsWith("…")).toBe(true);
    // Lo primero que dijo Google —que es lo que sirve— sobrevive al recorte.
    expect(salida.startsWith("Google Sheets API has not been used")).toBe(true);
  });

  it("un mensaje que es UNA sola palabra larguísima no queda en puros puntos", () => {
    const salida = recortarParaPantalla("x".repeat(500), 50);
    expect(salida).toBe("x".repeat(50) + "…");
  });
});
