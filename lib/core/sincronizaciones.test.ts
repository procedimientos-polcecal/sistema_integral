import { describe, expect, it } from "vitest";
import { entornoDeLaCorrida, esLaCorridaCanonica } from "./sincronizaciones";

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

/**
 * Si la corrida salió del despliegue canónico.
 *
 * Existe porque el desempate por `entorno` que puso la migración 20261023104622
 * no desempata: el que llamaba de más —identificado el 05/11/2026— es un segundo
 * despliegue de este repo en otra cuenta de Vercel, y como es la producción de
 * su propio proyecto **también dice `production`**. 53 corridas, 51 fallidas,
 * desde el 24/10/2026; el 05/11 el barrido de la Agenda anduvo a las 05:00:11 en
 * producción y falló a las 05:30:55 en el otro, y la pantalla mostró el fallo.
 *
 * Los valores de los dos proyectos son los medidos en `sincronizaciones`.
 */
describe("esLaCorridaCanonica", () => {
  const CANONICO = {
    VERCEL_ENV: "production",
    VERCEL_URL: "sistema-integral-7o20yo8q4-sistemapolcecalpolysan.vercel.app",
    VERCEL_PROJECT_PRODUCTION_URL: "www.polcecalpolysan.app",
    NEXT_PUBLIC_APP_URL: "https://www.polcecalpolysan.app",
  };

  it("el despliegue de verdad es canónico", () => {
    expect(esLaCorridaCanonica(CANONICO)).toBe(true);
  });

  it("la copia en la otra cuenta de Vercel no lo es, aunque diga production", () => {
    // Es el caso entero: hereda `NEXT_PUBLIC_APP_URL` con el resto de las
    // variables, pero su dominio de producción es el de SU proyecto.
    expect(
      esLaCorridaCanonica({
        VERCEL_ENV: "production",
        VERCEL_URL: "sistemaintegral-5x6by1fsr-soportemantenimiento-4821s-projects.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "sistemaintegral-soportemantenimiento-4821s-projects.vercel.app",
        NEXT_PUBLIC_APP_URL: "https://www.polcecalpolysan.app",
      })
    ).toBe(false);
  });

  it("da lo mismo que Vercel elija el apex o el www", () => {
    // El apex está enganchado al mismo proyecto —devuelve un 308 servido por
    // Vercel— y la documentación dice que elige el dominio más corto, así que
    // puede llegar cualquiera de los dos. No se pudo medir cuál, y por eso la
    // comparación está escrita para que no haga falta saberlo.
    expect(
      esLaCorridaCanonica({ ...CANONICO, VERCEL_PROJECT_PRODUCTION_URL: "polcecalpolysan.app" })
    ).toBe(true);
    expect(
      esLaCorridaCanonica({ ...CANONICO, NEXT_PUBLIC_APP_URL: "https://polcecalpolysan.app" })
    ).toBe(true);
  });

  it("da lo mismo el esquema, la barra final, las mayúsculas y el puerto", () => {
    // Vercel escribe la suya sin `https://`; la otra la tipea una persona. El
    // 04/11/2026 `NEXT_PUBLIC_APP_URL` valía `www.polcecalpolysan.app` pelada.
    for (const escrita of [
      "www.polcecalpolysan.app",
      "https://www.polcecalpolysan.app/",
      "HTTPS://WWW.PolcecalPolysan.app",
      "https://www.polcecalpolysan.app:443/login",
    ]) {
      expect(esLaCorridaCanonica({ ...CANONICO, NEXT_PUBLIC_APP_URL: escrita })).toBe(true);
    }
  });

  it("un dominio que se le parece no alcanza", () => {
    // Enlazar al que se le parece es peor que dejar en null, también acá.
    expect(
      esLaCorridaCanonica({ ...CANONICO, VERCEL_PROJECT_PRODUCTION_URL: "polcecalpolysan.app.vercel.app" })
    ).toBe(false);
    expect(
      esLaCorridaCanonica({ ...CANONICO, VERCEL_PROJECT_PRODUCTION_URL: "staging.polcecalpolysan.app" })
    ).toBe(false);
  });

  it("un preview del proyecto bueno tampoco es canónico", () => {
    // `VERCEL_PROJECT_PRODUCTION_URL` está puesta también en los previews, así
    // que sola diría que sí. Lo que lo frena es que la vista mira primero
    // `canonico` y después `entorno`, y un preview no es production.
    expect(
      esLaCorridaCanonica({ ...CANONICO, VERCEL_ENV: "preview" })
    ).toBe(true);
    expect(entornoDeLaCorrida({ ...CANONICO, VERCEL_ENV: "preview" }).entorno).toBe("preview");
  });

  it("fuera de Vercel es false, no null", () => {
    // Un script corrido a mano no es el despliegue canónico. `false` dice eso;
    // null queda reservado para la fila que escribió un despliegue que no
    // conoce la columna, que es la señal que se quiere poder leer.
    expect(esLaCorridaCanonica({})).toBe(false);
    expect(esLaCorridaCanonica({ NEXT_PUBLIC_APP_URL: "https://www.polcecalpolysan.app" })).toBe(false);
  });

  it("sin NEXT_PUBLIC_APP_URL no adivina: dice false", () => {
    // Si faltara en producción, el canónico se marca false y la vista desempata
    // como hoy. Prefiere, no filtra: equivocarse deja la pantalla como estaba.
    expect(esLaCorridaCanonica({ ...CANONICO, NEXT_PUBLIC_APP_URL: undefined })).toBe(false);
  });

  it("una cadena vacía es lo mismo que no estar", () => {
    expect(esLaCorridaCanonica({ VERCEL_PROJECT_PRODUCTION_URL: "", NEXT_PUBLIC_APP_URL: "" })).toBe(
      false
    );
    // Y dos vacías no se consideran iguales entre sí, que es el modo de fallar
    // que haría canónico a cualquiera.
    expect(esLaCorridaCanonica({ VERCEL_PROJECT_PRODUCTION_URL: "  ", NEXT_PUBLIC_APP_URL: "  " })).toBe(
      false
    );
  });
});
