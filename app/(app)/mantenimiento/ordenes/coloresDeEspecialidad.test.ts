import { describe, expect, it } from "vitest";
import {
  COLORES_DE_ESPECIALIDAD,
  COLOR_ATRASADA,
  TEXTO_SOBRE_ATRASADA,
  COLOR_SIN_ESPECIALIDAD,
  LEYENDA_DE_ESPECIALIDADES,
  TEXTO_SOBRE_EL_COLOR,
  textoSobreLaEspecialidad,
  estiloDeLaFicha,
} from "./coloresDeEspecialidad";

/**
 * `TEXTO_SOBRE_EL_COLOR` se indexa por el hex del relleno, no por la
 * especialidad: agregar o cambiar un relleno sin tocar la otra tabla no rompe
 * nada, y el texto cae en blanco sin avisar —blanco sobre ámbar son ~3,2:1, y el
 * ámbar es el color de veinte de las 21 órdenes abiertas—. Es la misma
 * situación que el 27 del GUT, que vive en dos lugares atados por un test.
 */
describe("los dos mapas de colores van atados", () => {
  it("cada relleno de especialidad tiene su color de texto", () => {
    for (const [especialidad, relleno] of Object.entries(COLORES_DE_ESPECIALIDAD)) {
      expect(TEXTO_SOBRE_EL_COLOR[relleno], `${especialidad} (${relleno}) no tiene texto asignado`).toBeDefined();
    }
  });

  it("no sobra ningún texto: cada entrada es de un relleno que existe", () => {
    const rellenos = new Set<string>(Object.values(COLORES_DE_ESPECIALIDAD));
    for (const relleno of Object.keys(TEXTO_SOBRE_EL_COLOR)) {
      expect(rellenos.has(relleno), `${relleno} ya no es el relleno de ninguna especialidad`).toBe(true);
    }
  });

  it("la leyenda pinta con los mismos rellenos que el calendario", () => {
    const rellenos = new Set<string>([...Object.values(COLORES_DE_ESPECIALIDAD), COLOR_SIN_ESPECIALIDAD]);
    for (const { nombre, color } of LEYENDA_DE_ESPECIALIDADES) {
      expect(rellenos.has(color), `${nombre}: ${color}`).toBe(true);
    }
  });

  it("el ámbar de MECÁNICO lleva texto oscuro y no el blanco de reserva", () => {
    expect(textoSobreLaEspecialidad("MECÁNICO")).toBe("#0f172a");
    expect(textoSobreLaEspecialidad("Mecanico")).toBe("#0f172a");
  });
});

/** Luminancia relativa WCAG y razon de contraste entre dos hex de seis digitos. */
function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe("el rojo de la orden atrasada", () => {
  it("contrasta con el blanco de su texto", () => {
    expect(contraste(COLOR_ATRASADA, TEXTO_SOBRE_ATRASADA)).toBeGreaterThan(4.5);
  });

  // 3:1 es el minimo WCAG para algo que no es texto. Medido: de 1,20 a 2,03
  // (el amarillo ambar es el mas cercano), asi que ninguno lo alcanza.
  it("no contrasta contra ningun relleno de especialidad, que es por que va de relleno y no de franja", () => {
    for (const color of Object.values(COLORES_DE_ESPECIALIDAD)) {
      expect(contraste(COLOR_ATRASADA, color)).toBeLessThan(3);
    }
    expect(contraste(COLOR_ATRASADA, COLOR_SIN_ESPECIALIDAD)).toBeLessThan(3);
  });
});

/**
 * Cómo se pinta una ficha, en las cuatro combinaciones.
 *
 * **Esto no tenía cómo comprobarse hasta hoy.** Era un ternario anidado dentro
 * de `CalendarioDeOT.tsx`, y ese componente trae sus datos en un `useEffect`:
 * renderizarlo en un test da el estado vacío y ni una ficha, así que el rojo
 * —que es toda la razón de la función— sólo se podía ver en un navegador, y la
 * pantalla está detrás del login. Sacada la decisión a este archivo, se prueba
 * como todo lo demás.
 *
 * Lo que fija cada caso es **cuál de las dos cosas gana**, que es la única
 * decisión de verdad que hay acá.
 */
describe("estiloDeLaFicha", () => {
  const MECANICO = COLORES_DE_ESPECIALIDAD.MECANICO;

  it("una orden normal va rellena de su especialidad", () => {
    expect(estiloDeLaFicha({ especialidad: "MECANICO", atrasada: false, arrastre: false })).toEqual({
      background: MECANICO,
      color: textoSobreLaEspecialidad("MECANICO"),
      border: `1.5px solid ${MECANICO}`,
    });
  });

  // La que importa: atrasada gana sobre la especialidad, y gana **en el
  // relleno**. Si alguna vez el rojo volviera al borde, este test cae.
  it("atrasada manda sobre la especialidad y va de relleno, con la especialidad en el borde", () => {
    expect(estiloDeLaFicha({ especialidad: "MECANICO", atrasada: true, arrastre: false })).toEqual({
      background: COLOR_ATRASADA,
      color: TEXTO_SOBRE_ATRASADA,
      border: `1.5px solid ${MECANICO}`,
    });
  });

  it("un día de arrastre va hueco, con la especialidad en el borde y el número oscuro", () => {
    const e = estiloDeLaFicha({ especialidad: "MECANICO", atrasada: false, arrastre: true });
    expect(e.background).toBe("#ffffff");
    expect(e.border).toBe(`1.5px dashed ${MECANICO}`);
    // Oscuro y no del color: el ámbar sobre blanco no se lee a 10 px.
    expect(e.color).toBe("#0f172a");
  });

  /*
   * La única de las cuatro donde la especialidad se pierde, y es a propósito:
   * en un día que la orden sólo ocupa, decir que está atrasada vale más que
   * decir de qué especialidad es. Queda escrito como test para que el día que
   * alguien lo lea como un olvido, encuentre que fue una decisión.
   */
  it("atrasada y de arrastre: hueca, con el rojo en el borde y en el número", () => {
    expect(estiloDeLaFicha({ especialidad: "MECANICO", atrasada: true, arrastre: true })).toEqual({
      background: "#ffffff",
      color: COLOR_ATRASADA,
      border: `1.5px dashed ${COLOR_ATRASADA}`,
    });
  });

  it("una especialidad sin color propio cae en el gris, y atrasada le sigue ganando", () => {
    expect(estiloDeLaFicha({ especialidad: null, atrasada: false, arrastre: false }).background)
      .toBe(COLOR_SIN_ESPECIALIDAD);
    expect(estiloDeLaFicha({ especialidad: null, atrasada: true, arrastre: false }).background)
      .toBe(COLOR_ATRASADA);
  });

  // El relleno rojo sólo sirve si el número se lee encima: es el contenido de
  // la ficha, no un adorno. El 4,5:1 es el mínimo de WCAG para texto chico.
  it("el número se lee sobre el rojo", () => {
    const e = estiloDeLaFicha({ especialidad: "MECANICO", atrasada: true, arrastre: false });
    expect(contraste(e.color, e.background)).toBeGreaterThan(4.5);
  });
});
