import { describe, it, expect } from "vitest";
import { systemPrompt } from "./prompt";

const base = { catalogo: "TABLAS\nempleados:\n  id uuid", pantalla: null, hoy: "2026-09-16" };

describe("el system prompt", () => {
  it("mete el catálogo del usuario", () => {
    expect(systemPrompt(base)).toContain("empleados");
  });

  it("dice en qué pantalla está parado, cuando lo sabe", () => {
    const p = systemPrompt({ ...base, pantalla: "/compras/requerimientos" });
    expect(p).toContain("/compras/requerimientos");
  });

  it("no inventa una pantalla cuando no la sabe", () => {
    expect(systemPrompt(base)).not.toContain("está mirando la pantalla");
  });

  /** "Este mes" depende de hoy, y un modelo no sabe qué día es. */
  it("le dice la fecha", () => {
    expect(systemPrompt(base)).toContain("2026-09-16");
  });

  /**
   * Es la instrucción que más importa de todo el prompt: con SQL generado, de
   * vez en cuando va a dar un número que parece bien y está mal, y un "no sé"
   * es infinitamente mejor que un número inventado — quien pregunta va a tomar
   * una decisión con eso.
   */
  it("le da permiso explícito para no saber", () => {
    expect(systemPrompt(base).toLowerCase()).toContain("no sé");
  });

  it("le dice que el artículo del movimiento es un id y no un texto", () => {
    expect(systemPrompt(base)).toContain("uuid");
  });

  it("le prohíbe cambiar estados", () => {
    expect(systemPrompt(base).toLowerCase()).toContain("no cambiás estados");
  });
});
