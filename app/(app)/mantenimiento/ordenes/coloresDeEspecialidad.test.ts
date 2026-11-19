import { describe, expect, it } from "vitest";
import {
  COLORES_DE_ESPECIALIDAD,
  COLOR_ATRASADA,
  TEXTO_SOBRE_ATRASADA,
  COLOR_SIN_ESPECIALIDAD,
  LEYENDA_DE_ESPECIALIDADES,
  TEXTO_SOBRE_EL_COLOR,
  textoSobreLaEspecialidad,
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
