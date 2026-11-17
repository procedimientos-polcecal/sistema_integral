import { describe, it, expect } from "vitest";
import nextConfig from "@/next.config";
import { TILES, TILES_HOST, CENTRO_POR_DEFECTO } from "./tiles";

/** Distancia en km entre dos puntos, para poder afirmar «está en Olavarría». */
function km([latA, lngA]: [number, number], [latB, lngB]: [number, number]) {
  const R = 6371;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(latB - latA);
  const dLng = rad(lngB - lngA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(latA)) * Math.cos(rad(latB)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const OLAVARRIA: [number, number] = [-36.893875, -60.323168];
const OBELISCO: [number, number] = [-34.6037, -58.3816];

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

/*
 * El centro por defecto es un dato geográfico, no una constante cualquiera: si
 * alguien lo cambia por descuido, nada se rompe —el mapa carga igual— y sólo
 * quien conoce el lugar nota que abre en otra provincia. Por eso se afirma la
 * distancia en kilómetros y no la igualdad de dos números, que no diría nada
 * sobre dónde cae.
 */
describe("el centro por defecto del mapa", () => {
  it("abre en Olavarría, que es donde está la planta", () => {
    expect(km(CENTRO_POR_DEFECTO, OLAVARRIA)).toBeLessThan(5);
  });

  it("ya no abre en Buenos Aires, que estaba a 309 km", () => {
    // Era el valor escrito a mano en los dos mapas hasta el 14/11/2026.
    expect(km(CENTRO_POR_DEFECTO, OBELISCO)).toBeGreaterThan(100);
  });

  it("está donde vive la gente: a menos de 20 km de los domicilios cargados", () => {
    // La mediana de los 25 domicilios geocodificados, medida contra la base el
    // 14/11/2026. Es la segunda fuente que confirma el punto de Nominatim, y
    // acá queda fijada para que el día que alguien mueva el centro se vea si
    // se alejó de los empleados.
    const medianaDeLosDomicilios: [number, number] = [-36.897805, -60.323101];
    expect(km(CENTRO_POR_DEFECTO, medianaDeLosDomicilios)).toBeLessThan(20);
  });

  it("tiene el signo del hemisferio sur y del oeste", () => {
    // Un signo invertido cae en China o en el Atlántico y el mapa igual carga.
    const [lat, lng] = CENTRO_POR_DEFECTO;
    expect(lat).toBeLessThan(0);
    expect(lng).toBeLessThan(0);
  });
});
