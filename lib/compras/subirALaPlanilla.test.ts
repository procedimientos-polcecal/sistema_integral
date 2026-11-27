import { describe, it, expect } from "vitest";
import { loQueFaltaSubir, faltaLaConversion } from "./subirALaPlanilla";

const cot = (p: Partial<Parameters<typeof loQueFaltaSubir>[0][number]> & { id: string }) => ({
  origen: "app",
  drive_fila: null as number | null,
  created_at: null as string | null,
  ...p,
});

describe("loQueFaltaSubir", () => {
  it("toma las del sistema que nunca llegaron a la planilla", () => {
    const faltan = loQueFaltaSubir([
      cot({ id: "a" }),
      cot({ id: "b", drive_fila: 12 }),
    ]);
    expect(faltan.map((c) => c.id)).toEqual(["a"]);
  });

  it("deja afuera las que vinieron de la planilla, aunque no tengan fila", () => {
    // Una 'drive' nació de una fila: escribirla le devolvería a la planilla lo
    // que ella misma dictó. Sin fila lo que hay es un dato roto, no algo que
    // subir.
    const faltan = loQueFaltaSubir([
      cot({ id: "a", origen: "drive" }),
      cot({ id: "b", origen: "drive", drive_fila: 7 }),
    ]);
    expect(faltan).toEqual([]);
  });

  it("no devuelve nada cuando están todas escritas", () => {
    expect(loQueFaltaSubir([cot({ id: "a", drive_fila: 3 })])).toEqual([]);
  });

  it("las ordena por cuándo se cargaron", () => {
    const faltan = loQueFaltaSubir([
      cot({ id: "c", created_at: "2026-11-27T13:00:00Z" }),
      cot({ id: "a", created_at: "2026-11-25T09:00:00Z" }),
      cot({ id: "b", created_at: "2026-11-26T09:00:00Z" }),
    ]);
    expect(faltan.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("desempata por id, para que dos llamadas escriban el mismo orden", () => {
    const mismoInstante = "2026-11-27T13:00:00Z";
    const faltan = loQueFaltaSubir([
      cot({ id: "b", created_at: mismoInstante }),
      cot({ id: "a", created_at: mismoInstante }),
    ]);
    expect(faltan.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("manda al final las que no dicen cuándo se cargaron", () => {
    const faltan = loQueFaltaSubir([
      cot({ id: "sinFecha" }),
      cot({ id: "conFecha", created_at: "2026-11-27T13:00:00Z" }),
    ]);
    expect(faltan.map((c) => c.id)).toEqual(["conFecha", "sinFecha"]);
  });

  it("no toca el arreglo que recibe", () => {
    const original = [
      cot({ id: "b", created_at: "2026-11-27T13:00:00Z" }),
      cot({ id: "a", created_at: "2026-11-25T13:00:00Z" }),
    ];
    loQueFaltaSubir(original);
    expect(original.map((c) => c.id)).toEqual(["b", "a"]);
  });
});

describe("faltaLaConversion", () => {
  it("un presupuesto en pesos no necesita dólar", () => {
    expect(faltaLaConversion({ moneda: "ARS" }, null)).toBe(false);
  });

  it("un dólar sin cotización y sin dólar del día no se escribe", () => {
    expect(faltaLaConversion({ moneda: "USD", cotizacion: null }, null)).toBe(true);
  });

  it("alcanza con el dólar del día", () => {
    expect(faltaLaConversion({ moneda: "USD", cotizacion: null }, 1450)).toBe(false);
  });

  it("alcanza con la cotización congelada, aunque no haya dólar del día", () => {
    expect(faltaLaConversion({ moneda: "USD", cotizacion: 1400 }, null)).toBe(false);
  });

  it("una moneda sin decir se trata como pesos, igual que en la carga", () => {
    expect(faltaLaConversion({ moneda: null }, null)).toBe(false);
  });
});
