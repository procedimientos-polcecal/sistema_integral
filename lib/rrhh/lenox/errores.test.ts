import { describe, it, expect, vi, afterEach } from "vitest";
import { esExcesoDeLlamadas } from "./errores";
import { traerEmpleados } from "./cliente";

describe("esExcesoDeLlamadas", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // Este es el test que ata los dos archivos: el error se provoca con el
  // cliente de verdad y un fetch falso, no con un texto copiado. Si alguien
  // cambia el mensaje del 429 en cliente.ts, se rompe acá.
  it("reconoce el error que lanza el cliente ante un 429 de Lenox", async () => {
    vi.stubEnv("LENOX_API_KEY", "clave-de-prueba");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 429, text: async () => "" }))
    );

    const error = await traerEmpleados().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(esExcesoDeLlamadas(error)).toBe(true);
  });

  it("no confunde con un 429 los otros errores del cliente", async () => {
    vi.stubEnv("LENOX_API_KEY", "clave-de-prueba");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, text: async () => "Internal Server Error" }))
    );

    const error = await traerEmpleados().catch((e: unknown) => e);
    expect(esExcesoDeLlamadas(error)).toBe(false);
  });

  it("un 400 cuyo cuerpo menciona el 429 en el medio no cuenta", () => {
    expect(esExcesoDeLlamadas(new Error("Lenox respondió 400: el id 429 no existe"))).toBe(false);
  });

  it("toma un error con status 429, que es el día que el cliente tenga uno propio", () => {
    const e = Object.assign(new Error("cualquier texto"), { status: 429 });
    expect(esExcesoDeLlamadas(e)).toBe(true);
  });

  it("lo que no es un Error no es un exceso de llamadas", () => {
    expect(esExcesoDeLlamadas("(429)")).toBe(false);
    expect(esExcesoDeLlamadas(null)).toBe(false);
  });
});
