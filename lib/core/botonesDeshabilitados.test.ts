import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Prueba `app/globals.css` de verdad, como `sw.test.ts` prueba `public/sw.js`.
 *
 * El 04/11/2026 el archivo declaraba un solo `:disabled`, el de `.btn-primary`,
 * y ninguno de los cuatro `:hover` llevaba guarda `:not(:disabled)`. O sea que
 * un `.btn-secondary` deshabilitado conservaba su aspecto entero y **además
 * cambiaba de fondo al pasarle el mouse por encima**: señalaba «funciono»
 * mientras no hacía nada. Eran 26 botones en 14 archivos y 9 módulos.
 *
 * Lo que vuelve necesario el test es que eso **no rompe nada**: no hay error,
 * ni `tsc`, ni build, ni pantalla rota. Es la misma familia que
 * `revisar-responsive` y `revisar-exportaciones` — un defecto que sólo se nota
 * cuando alguien abre esa pantalla y no entiende por qué el botón no anda.
 *
 * Se lee del archivo y no de una lista escrita acá a propósito: así un
 * `.btn-*` nuevo entra solo al control. Una lista a mano acá sería justo lo
 * que ya pasó con la tabla de CLAUDE.md, que nació incompleta.
 */

const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

// Los comentarios nombran `.btn-primary`, `:disabled` y
// `disabled:cursor-not-allowed` al explicar la trampa; si entraran al análisis,
// el test se aprobaría a sí mismo leyendo su propia explicación.
const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");

const selectores = [...sinComentarios.matchAll(/^([^{}]+)\{/gm)].map(([, s]) => s.trim());

/** Las clases de botón que el archivo declara, sacadas del archivo mismo. */
const clases = [
  ...new Set(
    selectores.flatMap((s) => [...s.matchAll(/\.(btn-[a-z-]+)(?![\w-])/g)].map(([, c]) => c)),
  ),
].sort();

describe("los botones deshabilitados de globals.css", () => {
  it("encuentra las clases de botón en el archivo", () => {
    // Si esto queda vacío, los dos tests de abajo pasarían sin mirar nada.
    expect(clases.length).toBeGreaterThanOrEqual(4);
    expect(clases).toContain("btn-primary");
    expect(clases).toContain("btn-secondary");
  });

  it.each(clases)("`.%s` se ve deshabilitado cuando lo está", (clase) => {
    const tiene = selectores.some((s) => new RegExp(`\\.${clase}:disabled(?![\\w-])`).test(s));
    expect(tiene, `falta la regla \`.${clase}:disabled\` en app/globals.css`).toBe(true);
  });

  it("ningún `:hover` ni `:active` de un botón alcanza a uno deshabilitado", () => {
    // La guarda importa más que el `:disabled`: sin ella el botón no sólo se
    // ve habilitado, sino que *reacciona*, que es una promesa y no un descuido.
    const sinGuarda = selectores.filter(
      (s) => /\.btn-[a-z-]+:(hover|active)/.test(s) && !s.includes(":not(:disabled)"),
    );
    expect(sinGuarda, `les falta \`:not(:disabled)\`: ${sinGuarda.join(" · ")}`).toEqual([]);
  });
});
