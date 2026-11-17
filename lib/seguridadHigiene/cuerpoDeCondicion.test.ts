import { describe, it, expect } from "vitest";
import { validar } from "@/lib/core/validar";
import { esquemaDeCondicion, problemaDelLugar } from "./cuerpoDeCondicion";

/** Lo mínimo que manda el teléfono: sin evaluar, sin asignar. */
const MINIMO = {
  sector_id: "3f2b1c4e-5a6d-4e7f-8a9b-0c1d2e3f4a5b",
  descripcion: "Falta la protección del cardán",
  accion_propuesta: "Colocar la protección",
  prioridad: 2,
};

describe("problemaDelLugar", () => {
  it("sector y equipo juntos se rechazan en castellano", () => {
    expect(problemaDelLugar("s1", "e1")).toBe(
      "Una condición se carga en un sector o en un equipo, no en los dos."
    );
  });

  it("uno solo, o ninguno, está bien", () => {
    expect(problemaDelLugar("s1", null)).toBeNull();
    expect(problemaDelLugar(null, "e1")).toBeNull();
    expect(problemaDelLugar(null, null)).toBeNull();
  });

  it("un texto vacío o undefined cuenta como que no vino", () => {
    expect(problemaDelLugar("s1", "")).toBeNull();
    expect(problemaDelLugar(undefined, "e1")).toBeNull();
  });
});

describe("esquemaDeCondicion", () => {
  it("acepta una condición sin evaluar", () => {
    expect(validar(esquemaDeCondicion, MINIMO).ok).toBe(true);
  });

  it("rechaza un puntaje fuera de la escala", () => {
    const r = validar(esquemaDeCondicion, { ...MINIMO, controles: 4 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas).toEqual(["controles tiene que ser uno de: 5, 3, 1."]);
  });

  it("acepta cada valor válido de cada criterio y rechaza los del criterio vecino", () => {
    const validos = {
      frecuencia: [3, 2, 1],
      antecedentes: [3, 2, 1],
      controles: [5, 3, 1],
      magnitud_dano: [9, 7, 3],
      legislacion: [5, 3, 1],
    };
    for (const [campo, valores] of Object.entries(validos)) {
      for (const v of valores) {
        expect(validar(esquemaDeCondicion, { ...MINIMO, [campo]: v }).ok).toBe(true);
      }
    }
    // El 9 es de la magnitud del daño, no de la frecuencia: un puntaje válido
    // en otro criterio no se cuela.
    expect(validar(esquemaDeCondicion, { ...MINIMO, frecuencia: 9 }).ok).toBe(false);
    expect(validar(esquemaDeCondicion, { ...MINIMO, magnitud_dano: 5 }).ok).toBe(false);
    expect(validar(esquemaDeCondicion, { ...MINIMO, legislacion: 2 }).ok).toBe(false);
  });

  it("un puntaje en null o ausente es una condición sin evaluar", () => {
    expect(validar(esquemaDeCondicion, { ...MINIMO, frecuencia: null }).ok).toBe(true);
    expect(validar(esquemaDeCondicion, { ...MINIMO, controles: undefined }).ok).toBe(true);
  });

  it("un puntaje como texto no entra", () => {
    expect(validar(esquemaDeCondicion, { ...MINIMO, controles: "5" }).ok).toBe(false);
  });

  it("la prioridad es 1, 2 o 3", () => {
    expect(validar(esquemaDeCondicion, { ...MINIMO, prioridad: 4 }).ok).toBe(false);
    expect(validar(esquemaDeCondicion, { ...MINIMO, prioridad: 0 }).ok).toBe(false);
    expect(validar(esquemaDeCondicion, { ...MINIMO, prioridad: 1 }).ok).toBe(true);
  });

  it("la descripción y la acción no pueden estar vacías ni ser sólo espacios", () => {
    const sinDescripcion = validar(esquemaDeCondicion, { ...MINIMO, descripcion: "   " });
    const sinAccion = validar(esquemaDeCondicion, { ...MINIMO, accion_propuesta: "" });
    expect(sinDescripcion.ok).toBe(false);
    expect(sinAccion.ok).toBe(false);
  });

  it("informa todos los problemas juntos", () => {
    const r = validar(esquemaDeCondicion, { descripcion: "", prioridad: 7, controles: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas.length).toBeGreaterThanOrEqual(4);
  });

  it("recorta los espacios de los textos", () => {
    const r = validar(esquemaDeCondicion, { ...MINIMO, descripcion: "  algo  " });
    expect(r.ok && r.datos.descripcion).toBe("algo");
  });

  it("una fecha que no es AAAA-MM-DD se rechaza", () => {
    expect(validar(esquemaDeCondicion, { ...MINIMO, detectada_el: "29/10/2026" }).ok).toBe(false);
    expect(validar(esquemaDeCondicion, { ...MINIMO, detectada_el: "2026-10-29" }).ok).toBe(true);
  });

  it("la clave, si viene, es un texto no vacío", () => {
    expect(validar(esquemaDeCondicion, { ...MINIMO, clave: "abc-123" }).ok).toBe(true);
    expect(validar(esquemaDeCondicion, { ...MINIMO, clave: "  " }).ok).toBe(false);
    expect(validar(esquemaDeCondicion, { ...MINIMO, clave: 7 }).ok).toBe(false);
  });
});
