import { describe, it, expect } from "vitest";
import {
  interpretarCantidadDeDeposito,
  interpretarCantidadOpcional,
  interpretarRotura,
} from "./cantidades";

describe("la cantidad del deposito: obligatoria y no negativa", () => {
  it("un numero entero pasa", () => {
    expect(interpretarCantidadDeDeposito("120")).toEqual({ ok: true, valor: 120 });
  });

  /**
   * El caso que motivó el archivo: "1.234,5" || 0 daba 0, y la producción de
   * ese producto salía como el negativo del stock anterior sin que nada
   * avisara.
   */
  it("un numero a la argentina, con miles y coma decimal, no se pierde", () => {
    expect(interpretarCantidadDeDeposito("1.234,5")).toEqual({ ok: true, valor: 1234.5 });
  });

  it("cero es un deposito valido: hay productos que se cuentan en cero", () => {
    expect(interpretarCantidadDeDeposito("0")).toEqual({ ok: true, valor: 0 });
  });

  it("vacio o solo espacios falta, no es cero", () => {
    expect(interpretarCantidadDeDeposito("")).toEqual({ ok: false, error: "Falta la cantidad." });
    expect(interpretarCantidadDeDeposito("   ")).toEqual({ ok: false, error: "Falta la cantidad." });
    expect(interpretarCantidadDeDeposito(null)).toEqual({ ok: false, error: "Falta la cantidad." });
    expect(interpretarCantidadDeDeposito(undefined)).toEqual({ ok: false, error: "Falta la cantidad." });
  });

  it("un texto que no es numero es un error, nunca un cero", () => {
    const r = interpretarCantidadDeDeposito("abc");
    expect(r.ok).toBe(false);
    expect(r as { ok: false; error: string }).toMatchObject({ error: '"abc" no es un número.' });
  });

  it("un deposito negativo no existe", () => {
    expect(interpretarCantidadDeDeposito("-5")).toEqual({
      ok: false,
      error: "La cantidad no puede ser negativa.",
    });
  });

  it("un numero que ya viene como number, no como texto, tambien se acepta", () => {
    expect(interpretarCantidadDeDeposito(45)).toEqual({ ok: true, valor: 45 });
  });
});

describe("una cantidad opcional: kilos, bultos, pallets", () => {
  it("un numero pasa", () => {
    expect(interpretarCantidadOpcional("29,5")).toEqual({ ok: true, valor: 29.5 });
  });

  /** Vacio es un null legitimo: el papel no siempre trae ese dato. */
  it("vacio o solo espacios es null, no un error ni un cero", () => {
    expect(interpretarCantidadOpcional("")).toEqual({ ok: true, valor: null });
    expect(interpretarCantidadOpcional("   ")).toEqual({ ok: true, valor: null });
    expect(interpretarCantidadOpcional(null)).toEqual({ ok: true, valor: null });
    expect(interpretarCantidadOpcional(undefined)).toEqual({ ok: true, valor: null });
  });

  /**
   * El otro caso del bug original: numero("abc") daba NaN, que
   * JSON.stringify vuelve null, y ese renglón desaparecía del total del día
   * sin dejar rastro. Acá tiene que ser un error, no un null silencioso.
   */
  it("un texto que no es numero es un error, no un null", () => {
    const r = interpretarCantidadOpcional("abc");
    expect(r.ok).toBe(false);
    expect(r as { ok: false; error: string }).toMatchObject({ error: '"abc" no es un número.' });
  });

  it("acepta miles con punto y decimal con coma", () => {
    expect(interpretarCantidadOpcional("1.500")).toEqual({ ok: true, valor: 1500 });
  });

  /**
   * Kilos, bultos o pallets despachados son una cantidad, no un movimiento
   * con signo. Un negativo sin rechazar entraba derecho a
   * `totalesDeDespacho` y de ahí a `desajustesDeKilos`, restando en vez de
   * sumar sin que nada lo avisara.
   */
  it("un negativo no existe", () => {
    expect(interpretarCantidadOpcional("-3")).toEqual({
      ok: false,
      error: "No puede ser negativo.",
    });
  });
});

describe("una rotura: not null default 0 en la base", () => {
  it("ausente es cero", () => {
    expect(interpretarRotura("")).toEqual({ ok: true, valor: 0 });
    expect(interpretarRotura("   ")).toEqual({ ok: true, valor: 0 });
    expect(interpretarRotura(null)).toEqual({ ok: true, valor: 0 });
    expect(interpretarRotura(undefined)).toEqual({ ok: true, valor: 0 });
  });

  it("un numero pasa", () => {
    expect(interpretarRotura("3")).toEqual({ ok: true, valor: 3 });
  });

  it("un texto invalido es un error, no un cero silencioso", () => {
    const r = interpretarRotura("dos");
    expect(r.ok).toBe(false);
    expect(r as { ok: false; error: string }).toMatchObject({ error: '"dos" no es un número.' });
  });

  it("una rotura negativa no existe", () => {
    expect(interpretarRotura("-1")).toEqual({
      ok: false,
      error: "La rotura no puede ser negativa.",
    });
  });
});
