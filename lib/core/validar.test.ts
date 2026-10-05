import { describe, it, expect } from "vitest";
import { z } from "zod";
import { validar, problemaEnCastellano } from "./validar";

const problemas = (esquema: z.ZodType, cuerpo: unknown): string[] => {
  const r = validar(esquema, cuerpo);
  return r.ok ? [] : r.problemas;
};

describe("lo que pasa la validacion", () => {
  it("un cuerpo correcto devuelve los datos tipados", () => {
    const r = validar(z.object({ nombre: z.string(), edad: z.number() }), { nombre: "Ana", edad: 30 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.datos).toEqual({ nombre: "Ana", edad: 30 });
  });
});

describe("falta contra esta mal, que son dos mensajes distintos", () => {
  /**
   * `invalid_type` de zod **no trae que llego**, asi que los dos casos se ven
   * iguales mirando el problema. Hay que mirar el cuerpo, y vale la vuelta
   * porque el que importa es el primero: casi siempre lo que pasa es que el
   * campo no vino.
   */
  it("un campo que no vino dice que falta", () => {
    expect(problemas(z.object({ nombre: z.string() }), {})).toEqual(["Falta nombre."]);
  });

  it("un campo con el tipo equivocado dice que tiene que ser", () => {
    expect(problemas(z.object({ nombre: z.string() }), { nombre: 42 }))
      .toEqual(["nombre tiene que ser un texto."]);
  });

  it("un null no es lo mismo que no mandarlo", () => {
    expect(problemas(z.object({ nombre: z.string() }), { nombre: null }))
      .toEqual(["nombre tiene que ser un texto."]);
  });
});

describe("todos los problemas juntos, no de a uno", () => {
  /**
   * Es la regla REG-T-15 de la Documentacion Funcional: "el sistema indica
   * todos los campos faltantes simultaneamente". Es la diferencia entre
   * corregir un formulario de una pasada o de a cuatro intentos.
   */
  it("tres campos mal dan tres mensajes", () => {
    const esquema = z.object({ nombre: z.string(), edad: z.number(), activo: z.boolean() });
    expect(problemas(esquema, { edad: "treinta" })).toEqual([
      "Falta nombre.",
      "edad tiene que ser un número.",
      "Falta activo.",
    ]);
  });
});

describe("los tipos se dicen en castellano", () => {
  it("texto, numero, verdadero o falso, lista", () => {
    expect(problemas(z.object({ a: z.string() }), { a: 1 })).toEqual(["a tiene que ser un texto."]);
    expect(problemas(z.object({ a: z.number() }), { a: "x" })).toEqual(["a tiene que ser un número."]);
    expect(problemas(z.object({ a: z.boolean() }), { a: "x" })).toEqual(["a tiene que ser verdadero o falso."]);
    expect(problemas(z.object({ a: z.array(z.string()) }), { a: "x" })).toEqual(["a tiene que ser una lista."]);
  });
});

describe("limites", () => {
  it("un texto corto y uno largo se dicen en caracteres", () => {
    expect(problemas(z.object({ a: z.string().min(3) }), { a: "xy" }))
      .toEqual(["a tiene que tener al menos 3 caracteres."]);
    expect(problemas(z.object({ a: z.string().max(2) }), { a: "xyz" }))
      .toEqual(["a no puede pasar de 2 caracteres."]);
  });

  it("un numero fuera de rango no habla de caracteres", () => {
    expect(problemas(z.object({ a: z.number().min(5) }), { a: 1 }))
      .toEqual(["a tiene que ser 5 o más."]);
    expect(problemas(z.object({ a: z.number().max(5) }), { a: 9 }))
      .toEqual(["a no puede ser mayor que 5."]);
  });

  it("una lista corta se dice en elementos", () => {
    expect(problemas(z.object({ a: z.array(z.string()).min(2) }), { a: ["x"] }))
      .toEqual(["a tiene que tener al menos 2 elementos."]);
  });
});

describe("valores y formatos", () => {
  it("un enum dice cuales son los que valen", () => {
    expect(problemas(z.object({ tipo: z.enum(["entrada", "salida"]) }), { tipo: "ajuste" }))
      .toEqual(["tipo tiene que ser uno de: entrada, salida."]);
  });

  it("una fecha mal formada dice que forma se espera", () => {
    expect(problemas(z.object({ f: z.iso.date() }), { f: "ayer" }))
      .toEqual(["f tiene que ser una fecha con forma AAAA-MM-DD."]);
  });

  it("un uuid invalido se dice sin hablar de uuid", () => {
    expect(problemas(z.object({ id: z.uuid() }), { id: "no" }))
      .toEqual(["id tiene que ser un identificador válido."]);
  });
});

describe("campos anidados y listas", () => {
  it("un campo adentro de un objeto se nombra con el camino", () => {
    expect(problemas(z.object({ a: z.object({ b: z.string() }) }), { a: {} }))
      .toEqual(["Falta a.b."]);
  });

  it("un elemento de una lista se nombra con su posicion", () => {
    expect(problemas(z.object({ a: z.array(z.string()) }), { a: [1] }))
      .toEqual(["a.0 tiene que ser un texto."]);
  });
});

describe("lo que ya trae su mensaje no se pisa", () => {
  /** Un `refine` lo escribió alguien que sabía qué quería decir. */
  it("un refine propio conserva su texto", () => {
    const esquema = z.object({
      desde: z.string(),
      hasta: z.string(),
    }).refine((v) => v.desde <= v.hasta, { message: "El desde no puede ser posterior al hasta." });
    expect(problemas(esquema, { desde: "2026-05-02", hasta: "2026-05-01" }))
      .toEqual(["El desde no puede ser posterior al hasta."]);
  });
});

describe("problemaEnCastellano con el cuerpo entero", () => {
  it("el cuerpo que no es un objeto no rompe la busqueda del valor", () => {
    const r = z.object({ a: z.string() }).safeParse(null);
    expect(r.success).toBe(false);
    if (!r.success) {
      // Un cuerpo nulo: ningún campo vino, así que el mensaje es "falta".
      expect(problemaEnCastellano(r.error.issues[0], null)).toContain("el cuerpo");
    }
  });
});
