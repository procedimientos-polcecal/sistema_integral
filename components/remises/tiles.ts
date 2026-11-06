/**
 * El fondo de mapa de Remises, en un solo lugar.
 *
 * Vive acá y no adentro de cada mapa porque son **dos** —`PinMap` y
 * `RoutesMap`— y hasta el 31/10/2026 cada uno tenía su copia del bloque. Y hay
 * un **tercer** lugar que no es un mapa: el `img-src` de la CSP en
 * `next.config.ts`, que tiene que dejar pasar este host. Son dos archivos que
 * no se parecen en nada y que hay que acordarse de tocar juntos, así que
 * `tiles.test.ts` los ata.
 *
 * ## Por qué OSM y no CARTO
 *
 * CARTO cerró su capa gratuita, y **no lo hace con un error**: devuelve HTTP
 * **200** con un PNG de 2049 bytes que dice «API KEY REQUIRED» para toda
 * coordenada y todo zoom. Leaflet recibe una imagen válida y la dibuja
 * contento, así que el mapa quedaba con sus pines y sus rutas encima de un
 * fondo liso **sin una sola línea en la consola** — que es por lo que esto
 * estuvo roto sin que nada avisara. Medido el 31/10/2026: los cuatro
 * subdominios (`a`–`d`) y cuatro coordenadas de zoom distinto devolvían el
 * mismo md5.
 *
 * El resto del módulo ya era OpenStreetMap —Nominatim geocodifica y OSRM
 * calcula las rutas, los dos respondiendo bien ese mismo día—, así que el
 * basemap era la única pieza que no lo era.
 *
 * ## Tres cosas que no se deducen del código
 *
 * Las tres hacen lo mismo: no rompen el build, no rompen un test y no dicen
 * nada en consola. Sólo dejan el mapa en blanco.
 *
 * - **No va `{r}`.** Es el marcador de retina y parece inofensivo porque hay
 *   una opción `detectRetina` que está en `false` por defecto. Pero Leaflet
 *   **no la mira** para esto: `getTileUrl` resuelve `r: Browser.retina ?
 *   '@2x' : ''` a secas (`leaflet-src.js:12201`, v1.9.4). Y `Browser.retina`
 *   no es más que `devicePixelRatio > 1` (`:2035`), evaluado **una vez al
 *   cargar el script**. O sea que pide `…/{y}@2x.png` en todo celular
 *   (devicePixelRatio 2 o 3) y también en Windows al 125 % de escala; OSM no
 *   tiene esos tiles y devuelve **HTTP 400**. Como el SdG se instala en el
 *   celular desde el 16/10/2026, dejarlo habría dado el peor resultado
 *   posible: un mapa que anda en la computadora donde uno lo prueba y está en
 *   blanco en el teléfono de todo el mundo.
 * - **No va `{s}`.** OSM sirve de un host único sobre HTTP/2 y desaconseja los
 *   subdominios; CARTO usaba `abcd`. Un `{s}` sin `subdomains` lo resuelve
 *   Leaflet con `abc`, así que el host quedaría mal escrito.
 * - **`maxZoom` es 19, no 20.** El estilo estándar de OSM no tiene tiles más
 *   allá de 19 y devuelve **400** en z20 — que es justo el que declaraba
 *   CARTO. Nadie abre el mapa en z20 a propósito, pero la rueda del mouse
 *   llega sola.
 *
 * ## Lo que queda asumido
 *
 * `tile.openstreetmap.org` es el servidor comunitario de la OSMF y su política
 * de uso prohíbe el tráfico pesado. Para el SdG —trece personas mirando hojas
 * de ruta— está holgadamente dentro de lo aceptable. Si algún día el uso
 * crece, el cambio es de **una línea acá**, que es exactamente el motivo por
 * el que este archivo existe.
 */
export const TILES = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  opts: {
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
};

/**
 * El host de `TILES.url`. Lo necesita el `img-src` de la CSP de
 * `next.config.ts`; está acá para que el test pueda comprobar que los dos
 * archivos hablan del mismo servidor.
 */
export const TILES_HOST = "tile.openstreetmap.org";
