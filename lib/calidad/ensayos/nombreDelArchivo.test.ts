import { describe, expect, it } from "vitest";
import { nombreDelArchivoDeLaCurva } from "./nombreDelArchivo";

const UNA = [{ producto: "Filler 1", fecha: "2026-11-18" }];
const VARIAS = [
  { producto: "Filler 1", fecha: "2026-11-18" },
  { producto: "Cal", fecha: "2026-11-19" },
];

/** 25/11/2026 a las 23:30 de Argentina, que en UTC ya es el 26. */
const DE_NOCHE = new Date("2026-11-26T02:30:00Z");

describe("nombreDelArchivoDeLaCurva", () => {
  it("con una muestra, el producto y su fecha", () => {
    expect(nombreDelArchivoDeLaCurva(UNA, { extension: "xlsx" })).toBe(
      "Curva granulométrica - Filler 1 - 2026-11-18.xlsx"
    );
  });

  it("con varias, cuántas son y el día de hoy", () => {
    expect(nombreDelArchivoDeLaCurva(VARIAS, { extension: "xlsx", instante: DE_NOCHE })).toBe(
      "Curva granulométrica - 2 muestras - 2026-11-25.xlsx"
    );
  });

  it("el día es el de Argentina y no el de UTC", () => {
    // A las 23:30 del 25 en Argentina son las 02:30 del 26 en UTC: un
    // `toISOString()` pelado le pondría la fecha de mañana al archivo.
    expect(nombreDelArchivoDeLaCurva(VARIAS, { extension: "png", instante: DE_NOCHE })).toContain(
      "2026-11-25"
    );
  });

  it("la imagen dice qué gráfico es", () => {
    expect(nombreDelArchivoDeLaCurva(UNA, { extension: "png", grafico: "Acumulado" })).toBe(
      "Curva granulométrica - Acumulado - Filler 1 - 2026-11-18.png"
    );
  });

  it("saca los separadores de ruta del nombre del producto", () => {
    // Un producto que se llame «Cal 1/2» no puede quedar en el nombre: el
    // navegador lo leería como una carpeta.
    expect(
      nombreDelArchivoDeLaCurva([{ producto: 'Cal 1/2 "fina"', fecha: "2026-11-18" }], {
        extension: "xlsx",
      })
    ).toBe("Curva granulométrica - Cal 1-2 -fina- - 2026-11-18.xlsx");
  });

  it("una sola muestra en plural no existe, pero cero sí", () => {
    expect(nombreDelArchivoDeLaCurva([], { extension: "xlsx", instante: DE_NOCHE })).toBe(
      "Curva granulométrica - 0 muestras - 2026-11-25.xlsx"
    );
  });
});
