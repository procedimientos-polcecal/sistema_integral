import { describe, expect, it } from "vitest";
import { entornoDeLaCorrida } from "./sincronizaciones";

/**
 * De qué entorno salió una corrida.
 *
 * Existe porque `sincronizaciones` es un registro global y le escriben varios
 * entornos sin que la fila diga cuál: desde el 14/10/2026 algo corre todos los
 * días a las 08:21:52 con credenciales de Supabase y sin las de Google, y su
 * fallo tapaba en la pantalla el éxito de la corrida real de las 08:00.
 */
describe("entornoDeLaCorrida", () => {
  it("en Vercel toma el entorno y el host", () => {
    expect(
      entornoDeLaCorrida({ VERCEL_ENV: "production", VERCEL_URL: "sistema-integral.vercel.app" })
    ).toEqual({ entorno: "production", host: "sistema-integral.vercel.app" });
  });

  it("distingue preview de producción, que es para lo que existe", () => {
    expect(entornoDeLaCorrida({ VERCEL_ENV: "preview", VERCEL_URL: "x-abc123.vercel.app" })).toEqual(
      { entorno: "preview", host: "x-abc123.vercel.app" }
    );
  });

  it("fuera de Vercel dice 'local', y no null", () => {
    // Null se confunde con "lo escribió un despliegue que no conoce la columna",
    // que es justamente la señal que se quiere poder leer. Un script corrido a
    // mano desde una máquina no es eso.
    expect(entornoDeLaCorrida({})).toEqual({ entorno: "local", host: null });
  });

  it("sin VERCEL_URL el host queda en null, no en vacío", () => {
    expect(entornoDeLaCorrida({ VERCEL_ENV: "production" })).toEqual({
      entorno: "production",
      host: null,
    });
  });

  it("una cadena vacía es lo mismo que no estar", () => {
    // Vercel no manda vacíos, pero un `.env` sí: `VERCEL_ENV=` deja "".
    expect(entornoDeLaCorrida({ VERCEL_ENV: "", VERCEL_URL: "" })).toEqual({
      entorno: "local",
      host: null,
    });
  });
});
