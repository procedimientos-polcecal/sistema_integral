import { describe, it, expect } from "vitest";
import { movimientoDesdeElRenglon, type CatalogoDeLaPlanilla } from "./importar";

const CATALOGO: CatalogoDeLaPlanilla = new Map([
  ["00003", { id: "c-bruzzone", carbon: "vegetal" as const }],
  ["00010", { id: "c-membranex", carbon: "residual" as const }],
]);

// CODIGO, DESCRIPCION, ENTRADAS, SALIDAS, TOTAL, VEGETAL, RESIDUAL, FECHA, STOCK FISICO, ERROR
const renglon = (celdas: unknown[]) => celdas;

describe("movimientoDesdeElRenglon", () => {
  it("una entrada después del corte lleva el tipo de su carbonillero", () => {
    // 46276 = 2026-09-11
    const r = movimientoDesdeElRenglon(
      renglon(["00003", "BRUZZONE JUAN ALBERTO", 20.58, "", 288.9, 238.4, 50.02, 46276]),
      42,
      CATALOGO
    );
    expect(r).toMatchObject({
      clase: "movimiento",
      movimiento: {
        fecha: "2026-09-11",
        tipo: "entrada",
        carbon: "vegetal",
        toneladas: 20.58,
        carbonillero_id: "c-bruzzone",
        origen: "importacion",
        sheets_fila: 42,
      },
    });
  });

  it("una entrada ANTES del corte va sin_separar, aunque el carbonillero tenga tipo", () => {
    // 45895 = 2025-08-26. El libro no separaba todavía.
    const r = movimientoDesdeElRenglon(
      renglon(["00003", "BRUZZONE JUAN ALBERTO", 23.86, "", 23.86, "", "", 45895]),
      3,
      CATALOGO
    );
    expect(r).toMatchObject({ clase: "movimiento", movimiento: { carbon: "sin_separar" } });
  });

  it("un residual anterior al corte TAMBIÉN va sin_separar", () => {
    // Es el caso que hace que importarlos como vegetal sea inventar: Membranex
    // entró más de veinte veces en esa época.
    const r = movimientoDesdeElRenglon(
      renglon(["00010", "MEMBRANEX CARBON RESIDUAL", 24.46, "", 100, "", "", 45930]),
      90,
      CATALOGO
    );
    expect(r).toMatchObject({ clase: "movimiento", movimiento: { carbon: "sin_separar" } });
  });

  it("un CONSUMO VEGETAL es un consumo, con el signo dado vuelta", () => {
    const r = movimientoDesdeElRenglon(
      renglon(["00015", "CONSUMO VEGETAL", "", 37, 324.9, 248.8, 75.6, 46277]),
      50,
      CATALOGO
    );
    expect(r).toMatchObject({
      clase: "movimiento",
      movimiento: { tipo: "consumo", carbon: "vegetal", toneladas: -37, carbonillero_id: null },
    });
  });

  it("un CONSUMO RESIDUAL usa el 00016", () => {
    const r = movimientoDesdeElRenglon(
      renglon(["00016", "CONSUMO RESIDUAL", "", 12, 100, 80, 20, 46277]),
      51,
      CATALOGO
    );
    expect(r).toMatchObject({
      clase: "movimiento",
      movimiento: { tipo: "consumo", carbon: "residual", toneladas: -12 },
    });
  });

  it("un CONSUMO a secas va sin_separar: el libro no distinguía", () => {
    // 45930 = 2025-09-30, era 2. El código 00001 murió el 20/11/2025.
    const r = movimientoDesdeElRenglon(
      renglon(["00001", "CONSUMO", "", 46, 300, "", "", 45930]),
      120,
      CATALOGO
    );
    expect(r).toMatchObject({ clase: "movimiento", movimiento: { carbon: "sin_separar" } });
  });

  it("una fila con texto en STOCK FISICO es un ajuste con ese texto de motivo", () => {
    // 46132 = 2026-04-20: "AJUSTE DE STOCK (-46 Tn.)" cargado como consumo.
    const r = movimientoDesdeElRenglon(
      renglon([
        "00015", "CONSUMO VEGETAL", "", 46, 759.81, 331.67, 427.69, 46132, "AJUSTE DE STOCK (-46 Tn.)",
      ]),
      661,
      CATALOGO
    );
    expect(r).toMatchObject({
      clase: "movimiento",
      movimiento: { tipo: "ajuste", carbon: "vegetal", toneladas: -46, motivo: "AJUSTE DE STOCK (-46 Tn.)" },
    });
  });

  it("un ajuste en más entra por la columna de entradas y queda positivo", () => {
    // 46144 = 2026-05-02: el que rompió la fórmula del saldo a mano.
    const r = movimientoDesdeElRenglon(
      renglon([
        "00015", "CONSUMO VEGETAL", 232.5, "", 961.09, 445.45, 515.19, 46144,
        "Ajuste por desvío cero y span balanza de carbón (232,5 tn.)",
      ]),
      689,
      CATALOGO
    );
    expect(r).toMatchObject({
      clase: "movimiento",
      movimiento: { tipo: "ajuste", toneladas: 232.5 },
    });
  });

  it("una fila sin fecha se informa y no se importa", () => {
    const r = movimientoDesdeElRenglon(
      renglon(["00010", "MEMBRANEX CARBON RESIDUAL", 25.62, "", 355.85, 279.76, 75.64]),
      1034,
      CATALOGO
    );
    expect(r.clase).toBe("sin_importar");
    if (r.clase !== "sin_importar") throw new Error("no informó");
    expect(r.motivo).toMatch(/fecha/i);
  });

  it("un código que no está en el catálogo se informa y no se enlaza al que se le parece", () => {
    const r = movimientoDesdeElRenglon(
      renglon(["00018", "EL INVENCIBLE", 17.26, "", 273.5, 223.06, 50.02, 46275]),
      1033,
      CATALOGO
    );
    expect(r.clase).toBe("sin_importar");
    if (r.clase !== "sin_importar") throw new Error("no informó");
    expect(r.motivo).toContain("00018");
  });

  it("una fila vacía se saltea sin ruido", () => {
    expect(movimientoDesdeElRenglon(renglon(["", " "]), 1200, CATALOGO).clase).toBe("vacia");
  });

  it("una fila sin entrada ni salida no es un movimiento", () => {
    const r = movimientoDesdeElRenglon(
      renglon(["00003", "BRUZZONE JUAN ALBERTO", "", "", 100, 80, 20, 46276]),
      500,
      CATALOGO
    );
    expect(r.clase).toBe("sin_importar");
  });

  it("un conteo físico numérico sale aparte del movimiento", () => {
    const r = movimientoDesdeElRenglon(
      renglon(["00015", "CONSUMO VEGETAL", "", 29, 326.85, 250.75, 75.64, 46276, 298, -28.857]),
      1035,
      CATALOGO
    );
    expect(r.clase).toBe("movimiento");
    if (r.clase !== "movimiento") throw new Error("no es movimiento");
    expect(r.conteo).toEqual({
      fecha: "2026-09-11",
      carbon: "vegetal",
      toneladas_contadas: 298,
      teorico_al_contar: 326.85,
    });
  });

  it("un conteo anterior al corte no sale: no se sabe de qué tipo era", () => {
    const r = movimientoDesdeElRenglon(
      renglon(["00001", "CONSUMO", "", 46, 300, "", "", 45930, 240, -60]),
      121,
      CATALOGO
    );
    if (r.clase !== "movimiento") throw new Error("no es movimiento");
    expect(r.conteo).toBeUndefined();
  });
});
