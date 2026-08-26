import { describe, it, expect } from "vitest";
import { haceCuanto } from "./haceCuanto";

const AHORA = new Date("2026-08-26T12:00:00Z");
const hace = (ms: number) => new Date(AHORA.getTime() - ms);

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

describe("haceCuanto", () => {
  it("lo muy reciente es recien, no 'hace 0 minutos'", () => {
    expect(haceCuanto(hace(5_000), AHORA)).toBe("recién");
    expect(haceCuanto(hace(59_000), AHORA)).toBe("recién");
  });

  it("minutos, horas y dias", () => {
    expect(haceCuanto(hace(5 * MINUTO), AHORA)).toBe("hace 5 minutos");
    expect(haceCuanto(hace(3 * HORA), AHORA)).toBe("hace 3 horas");
    expect(haceCuanto(hace(2 * DIA), AHORA)).toBe("hace 2 días");
  });

  it("el singular no dice 'hace 1 horas'", () => {
    expect(haceCuanto(hace(MINUTO), AHORA)).toBe("hace 1 minuto");
    expect(haceCuanto(hace(HORA), AHORA)).toBe("hace 1 hora");
    expect(haceCuanto(hace(DIA), AHORA)).toBe("hace 1 día");
  });

  it("una fecha futura no dice 'hace -3 minutos'", () => {
    // Pasa cuando el reloj del servidor y el de la base difieren por segundos.
    expect(haceCuanto(new Date(AHORA.getTime() + 3 * MINUTO), AHORA)).toBe("recién");
  });

  it("sin fecha, nunca", () => {
    expect(haceCuanto(null, AHORA)).toBe("nunca");
    expect(haceCuanto(undefined, AHORA)).toBe("nunca");
    expect(haceCuanto("no es una fecha", AHORA)).toBe("nunca");
  });

  it("acepta el texto que devuelve PostgREST", () => {
    expect(haceCuanto("2026-08-26T09:00:00+00:00", AHORA)).toBe("hace 3 horas");
  });

  it("el cron diario se lee como lo que es", () => {
    // Con el cron una vez por dia, esto es lo que va a decir el cartel buena
    // parte del dia. Que se lea claro es el punto.
    expect(haceCuanto(hace(14 * HORA), AHORA)).toBe("hace 14 horas");
  });
});
