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
   * Lo que mantiene alcanzable la portada de cada módulo.
   *
   * Desde el 04/11/2026 el encabezado de un grupo **sólo despliega**: no
   * navega. Así que su primer hijo —"Tablero", o "Gráficos" en Compras— es el
   * único camino a la raíz del módulo desde el menú. Un grupo nuevo sin él
   * deja su página huérfana, y eso no rompe nada: la pantalla existe, anda, y
   * simplemente no se llega. Es el mismo tipo de falla silenciosa que el
   * `<select>` nativo y la grilla sin breakpoint.
   *
   * Exige que sea el **primero** y no uno cualquiera: la portada arriba es lo
   * que hace que el desplegable se lea como el módulo y no como una lista de
   * secciones sueltas.
   */
  it("cada grupo tiene su raíz como primer hijo", () => {
    const sinPortada = NAV.filter((i) => i.children && i.children[0]?.href !== i.href).map((i) => i.label);
    expect(sinPortada).toEqual([]);
  });

  /*
   * Y que se vea cuando se ve el grupo. Si la portada pidiera un permiso más
   * estricto que su grupo, habría gente que ve el desplegable abierto y no
   * encuentra la página — que es la misma orfandad por otro camino.
   */
  it("la portada pide los mismos permisos que su grupo", () => {
    const desparejas = NAV.filter((i) => i.children).flatMap((i) => {
      const portada = i.children![0];
      const igual =
        portada.modulo === i.modulo &&
        Boolean(portada.soloAdminGlobal) === Boolean(i.soloAdminGlobal) &&
        Boolean(portada.soloAdmin) === Boolean(i.soloAdmin);
      return igual ? [] : [i.label];
    });
    expect(desparejas).toEqual([]);
  });
});
