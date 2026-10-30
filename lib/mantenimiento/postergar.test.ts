import { describe, it, expect } from "vitest";
import { laNuevaFecha, loQueFaltaParaPostergar, MAXIMO_DE_DIAS } from "./postergar";

describe("laNuevaFecha", () => {
  it("corre la fecha los días que se le pidan", () => {
    expect(laNuevaFecha("2026-11-02", 3)).toBe("2026-11-05");
  });

  it("cruza el fin de mes sin despeinarse", () => {
    expect(laNuevaFecha("2026-10-30", 3)).toBe("2026-11-02");
  });

  /**
   * Sin fecha de la que partir no hay a dónde correrla. Devuelve `null` y la
   * ruta lo rechaza: una OT sin fecha de ejecución no se posterga, se le pone
   * una.
   */
  it("sin fecha no hay fecha nueva", () => {
    expect(laNuevaFecha(null, 3)).toBeNull();
    expect(laNuevaFecha("", 3)).toBeNull();
  });
});

describe("loQueFaltaParaPostergar", () => {
  const completo = { razon: "falta_repuesto", dias: 3, justificacion: "No llegó el retén." };

  it("con todo cargado no falta nada", () => {
    expect(loQueFaltaParaPostergar(completo)).toEqual([]);
  });

  /**
   * Los problemas se informan **juntos**, no de a uno. Es la vara de
   * `lib/core/validar.ts`: quien lo lee quiere saber qué hay que arreglar, no
   * descubrirlo de a una corrida por vez.
   */
  it("informa todo lo que falta de una vez", () => {
    expect(loQueFaltaParaPostergar({ razon: "", dias: 0, justificacion: "  " }))
      .toEqual(["la razón", "cuántos días", "la justificación"]);
  });

  it("la justificación es obligatoria, y en blanco no cuenta", () => {
    expect(loQueFaltaParaPostergar({ ...completo, justificacion: "   " }))
      .toEqual(["la justificación"]);
  });

  it("los días tienen que ser un entero positivo", () => {
    for (const dias of [0, -3, 1.5, NaN]) {
      expect(loQueFaltaParaPostergar({ ...completo, dias })).toEqual(["cuántos días"]);
    }
  });

  /**
   * Un tope, y no por capricho: postergar es escribir en la planilla que mira
   * la planta. Un dedo de más en el campo de días —300 en vez de 3— manda la
   * orden a 2027 y eso no se deshace desde el sistema, porque la fecha que
   * quedó en «Altas del sistema» hay que volver a escribirla.
   */
  it("no acepta una cantidad de días absurda", () => {
    expect(loQueFaltaParaPostergar({ ...completo, dias: MAXIMO_DE_DIAS + 1 }))
      .toEqual(["cuántos días"]);
    expect(loQueFaltaParaPostergar({ ...completo, dias: MAXIMO_DE_DIAS })).toEqual([]);
  });
});
