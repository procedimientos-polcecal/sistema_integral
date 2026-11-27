import { describe, expect, it } from "vitest";
import { claveDelJuego, losQueComparten } from "./juegoDeTamices";

/**
 * Comparar productos distintos se pidió el 26/11/2026 acotado: «de los que
 * tengan el mismo juego de tamices». Esto decide cuáles son.
 */
describe("claveDelJuego", () => {
  it("no depende del orden en que estén escritas las mallas", () => {
    expect(claveDelJuego([200, 50, 100])).toBe(claveDelJuego([50, 100, 200]));
  });

  it("distingue juegos distintos, y un subconjunto no es el mismo juego", () => {
    expect(claveDelJuego([50, 100, 200])).not.toBe(claveDelJuego([50, 100, 200, 325]));
  });

  it("el juego vacío tiene su propia clave, que es la cadena vacía", () => {
    // De eso se agarra `losQueComparten` para no emparejar a nadie: ver su test.
    expect(claveDelJuego([])).toBe("");
  });
});

const CATALOGO = [
  { id: "fino-a", mallas: [20, 50, 100, 200] },
  { id: "grueso-a", mallas: [6, 7, 10, 12, 20, 50, 100, 200] },
  { id: "fino-b", mallas: [100, 200, 50, 20] },
  { id: "sin-juego-a", mallas: [] },
  { id: "grueso-b", mallas: [6, 7, 10, 12, 20, 50, 100, 200] },
  { id: "sin-juego-b", mallas: [] },
];

describe("losQueComparten", () => {
  it("trae los otros del mismo juego, en el orden del catálogo y sin incluirse", () => {
    expect(losQueComparten(CATALOGO, "grueso-a").map((p) => p.id)).toEqual(["grueso-b"]);
    expect(losQueComparten(CATALOGO, "fino-a").map((p) => p.id)).toEqual(["fino-b"]);
  });

  it("un producto que no declara juego no comparte con nadie, ni con otro sin juego", () => {
    // Medido el 26/11/2026: 11 de los 23 productos no declaran mallas.
    // Emparejarlos entre sí sería juntar «Caliza galpón» con «Acopio» por lo
    // único que tienen en común, que es no haber dicho nada.
    expect(losQueComparten(CATALOGO, "sin-juego-a")).toEqual([]);
  });

  it("un id que no está en el catálogo no trae nada", () => {
    expect(losQueComparten(CATALOGO, "no-existe")).toEqual([]);
  });

  it("no mezcla el juego fino con el grueso aunque uno contenga al otro", () => {
    expect(losQueComparten(CATALOGO, "fino-a").map((p) => p.id)).not.toContain("grueso-a");
  });
});
