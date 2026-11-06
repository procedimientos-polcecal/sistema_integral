import { describe, it, expect } from "vitest";
import nextConfig from "@/next.config";
import { TILES, TILES_HOST } from "./tiles";

/*
 * Lo que se prueba acá no es lógica: es que tres decisiones medidas el
 * 31/10/2026 no se deshagan solas. Las tres fallan **en silencio** —el build
 * pasa, `tsc` pasa, la consola no dice nada y el mapa queda en blanco—, que es
 * la misma familia de problemas que `revisar-responsive` y
 * `revisar-exportaciones`. El porqué de cada una está en `tiles.ts`.
 */
describe("el fondo de mapa de Remises", () => {
  it("no pide tiles @2x, que OSM no tiene", () => {
    // Leaflet resuelve `{r}` con `Browser.retina ? '@2x' : ''` y NO mira
    // `detectRetina`; `Browser.retina` es `devicePixelRatio > 1`. Así que un
    // `{r}` en la plantilla rompe el mapa en todo teléfono y deja andando el
    // de la computadora donde uno lo prueba.
    expect(TILES.url).not.toContain("{r}");
  });

  it("no usa subdominios, que OSM desaconseja", () => {
    expect(TILES.url).not.toContain("{s}");
  });

  it("no pasa de z19, donde OSM deja de tener tiles", () => {
    // z20 devuelve 400, no 404. CARTO declaraba 20 y eso viajó en la copia.
    expect(TILES.opts.maxZoom).toBeLessThanOrEqual(19);
  });

  it("lleva la atribución que OSM exige", () => {
    expect(TILES.opts.attribution).toContain("OpenStreetMap");
    expect(TILES.opts.attribution).toContain("openstreetmap.org/copyright");
  });

  it("`TILES_HOST` es de verdad el host de la URL", () => {
    expect(new URL(TILES.url.replace(/\{[^}]*\}/g, "0")).hostname).toBe(TILES_HOST);
  });

  /*
   * El que ata los dos archivos. La CSP está en Report-Only, así que hoy un
   * host que falte no bloquea nada — pero el comentario de `next.config.ts`
   * dice que la idea es activarla, y el día que eso pase un allowlist viejo
   * deja el mapa en blanco sin que nadie toque el mapa. Se lee la cabecera que
   * la app sirve de verdad, no la constante, para que valga aunque la CSP se
   * arme de otra forma.
   */
  it("la CSP deja pasar el host de los tiles", async () => {
    const grupos = await nextConfig.headers!();
    const cabeceras = grupos.flatMap((g) => g.headers);
    const csp = cabeceras.find((h) => h.key.startsWith("Content-Security-Policy"));
    expect(csp, "next.config.ts dejó de mandar una CSP").toBeDefined();

    const imgSrc = csp!.value.split(";").map((d) => d.trim()).find((d) => d.startsWith("img-src"));
    expect(imgSrc, "la CSP dejó de tener img-src").toBeDefined();
    expect(imgSrc).toContain(TILES_HOST);
  });

  it("la CSP ya no nombra a CARTO, que dejó de servir tiles", async () => {
    const grupos = await nextConfig.headers!();
    const csp = grupos.flatMap((g) => g.headers).find((h) => h.key.startsWith("Content-Security-Policy"));
    expect(csp!.value).not.toContain("cartocdn");
  });
});
