import { describe, expect, it } from "vitest";
import {
  COLORES_DE_ESPECIALIDAD,
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
