import { describe, expect, it } from "vitest";
import { NAV, estaDentroDe } from "./nav";

describe("estaDentroDe", () => {
  it("la raíz del módulo está dentro de sí misma", () => {
    expect(estaDentroDe("/compras", "/compras")).toBe(true);
  });

  it("una sub-página del menú está dentro", () => {
    expect(estaDentroDe("/compras", "/compras/tablero")).toBe(true);
  });

  /*
   * El caso que motivó todo esto: una página de detalle que no figura en el
   * menú. Con comparación exacta, el menú quedaba cerrado parado ahí.
   */
  it("una página de detalle que no está en el menú también está dentro", () => {
    expect(estaDentroDe("/cantera", "/cantera/voladuras/ABC-123")).toBe(true);
  });

  it("otro módulo no está dentro", () => {
    expect(estaDentroDe("/compras", "/rrhh/empleados")).toBe(false);
  });

  /*
   * La barra del final. Sin ella esto daría verdadero, y el menú desplegaría
   * Remises parado en otra pantalla. Hoy ningún módulo del SdG es prefijo de
   * otro, pero eso es una propiedad de la lista de hoy y no una garantía.
   */
  it("un módulo cuyo nombre empieza igual NO está dentro", () => {
    expect(estaDentroDe("/remises", "/remisesX")).toBe(false);
    expect(estaDentroDe("/taller-vial", "/taller-vial-viejo")).toBe(false);
  });

  /*
   * La otra mitad del trabajo de la barra: con un `startsWith` pelado, la raíz
   * del Inicio contendría el sistema entero.
   */
  it("la raíz del sistema no contiene a los módulos", () => {
    expect(estaDentroDe("/", "/compras")).toBe(false);
    expect(estaDentroDe("/", "/")).toBe(true);
  });

  it("el query del href no cuenta: las dos pestañas caen en el mismo sector", () => {
    expect(estaDentroDe("/rrhh/ausencias?tab=licencias", "/rrhh/ausencias")).toBe(true);
  });
});

describe("las raíces del menú", () => {
  /*
   * `estaDentroDe` se usa contra la raíz de cada grupo, así que si algún día
   * una fuera prefijo de otra, entrar a la segunda desplegaría la primera.
   * Hoy no pasa; este test avisa el día que alguien agregue un módulo que sí.
   */
  it("ninguna raíz de grupo es prefijo de otra", () => {
    const raices = NAV.filter((i) => i.children).map((i) => i.href);
    const choques = raices.flatMap((a) =>
      raices.filter((b) => b !== a && estaDentroDe(a, b)).map((b) => `${b} cae dentro de ${a}`)
    );
    expect(choques).toEqual([]);
  });

  /*
   * El supuesto que hace falta el cambio: si algún grupo repitiera su raíz
   * como hijo, ese ya se desplegaba solo y no necesitaba nada. Ninguno lo
   * hace — son los trece.
   */
  it("ningún grupo repite su raíz como hijo", () => {
    const repiten = NAV.filter((i) => i.children?.some((c) => c.href === i.href)).map((i) => i.label);
    expect(repiten).toEqual([]);
  });
});
