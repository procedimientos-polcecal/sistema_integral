import { describe, it, expect } from "vitest";
import { compararConteos, hayAlgoFatal } from "./comparar";

describe("compararConteos", () => {
  it("no dice nada cuando los dos lados coinciden", () => {
    const a = [{ tabla: "usuarios", filas: 11 }];
    expect(compararConteos(a, a)).toEqual([]);
  });

  it("marca la tabla que tiene menos filas en el destino", () => {
    const d = compararConteos(
      [{ tabla: "fichadas", filas: 3962 }],
      [{ tabla: "fichadas", filas: 3900 }],
    );
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ tabla: "fichadas", origen: 3962, destino: 3900 });
    expect(d[0].motivo).toBe("faltan filas");
    expect(d[0].fatal).toBe(true);
  });

  it("marca la tabla que existe en el origen y no en el destino", () => {
    const d = compararConteos([{ tabla: "avisos", filas: 152 }], []);
    expect(d).toHaveLength(1);
    expect(d[0].motivo).toBe("no existe en el destino");
    expect(d[0].fatal).toBe(true);
  });

  it("marca la tabla que no se pudo contar, y NO la trata como cero", () => {
    const d = compararConteos(
      [{ tabla: "jornadas", filas: null }],
      [{ tabla: "jornadas", filas: 6 }],
    );
    expect(d).toHaveLength(1);
    expect(d[0].motivo).toBe("no se pudo contar");
    expect(d[0].fatal).toBe(true);
  });

  it("tampoco la trata como cero cuando el ilegible es el destino", () => {
    const d = compararConteos(
      [{ tabla: "jornadas", filas: 6 }],
      [{ tabla: "jornadas", filas: null }],
    );
    expect(d[0].motivo).toBe("no se pudo contar");
    expect(d[0].fatal).toBe(true);
  });

  it("marca la tabla vacia en el destino como faltante, no como incontable", () => {
    const d = compararConteos(
      [{ tabla: "productos", filas: 40 }],
      [{ tabla: "productos", filas: 0 }],
    );
    expect(d[0].motivo).toBe("faltan filas");
  });

  it("una tabla vacia en los dos lados esta bien", () => {
    const d = compararConteos(
      [{ tabla: "produccion_partes", filas: 0 }],
      [{ tabla: "produccion_partes", filas: 0 }],
    );
    expect(d).toEqual([]);
  });

  it("avisa de una tabla que sobra en el destino, sin que sea fatal", () => {
    const d = compararConteos([], [{ tabla: "colada", filas: 3 }]);
    expect(d).toHaveLength(1);
    expect(d[0].motivo).toBe("sobra en el destino");
    expect(d[0].fatal).toBe(false);
  });

  it("una tabla con mas filas en el destino tampoco es fatal", () => {
    // Pasa si alguien cargo algo despues del dump: hay que verlo, pero no
    // significa que se haya perdido nada.
    const d = compararConteos(
      [{ tabla: "avisos", filas: 152 }],
      [{ tabla: "avisos", filas: 153 }],
    );
    expect(d[0].motivo).toBe("sobran filas");
    expect(d[0].fatal).toBe(false);
  });

  it("informa todas las tablas mal, no solo la primera", () => {
    const d = compararConteos(
      [
        { tabla: "a", filas: 10 },
        { tabla: "b", filas: 20 },
        { tabla: "c", filas: 30 },
      ],
      [
        { tabla: "a", filas: 1 },
        { tabla: "b", filas: 20 },
        { tabla: "c", filas: 3 },
      ],
    );
    expect(d.map((x) => x.tabla)).toEqual(["a", "c"]);
  });
});

describe("hayAlgoFatal", () => {
  it("es falso sin diferencias", () => {
    expect(hayAlgoFatal([])).toBe(false);
  });

  it("es falso cuando todas las diferencias son avisos", () => {
    const d = compararConteos([], [{ tabla: "colada", filas: 3 }]);
    expect(hayAlgoFatal(d)).toBe(false);
  });

  it("es verdadero con una sola diferencia fatal entre muchos avisos", () => {
    const d = compararConteos(
      [{ tabla: "avisos", filas: 152 }, { tabla: "fichadas", filas: 3962 }],
      [{ tabla: "avisos", filas: 153 }, { tabla: "fichadas", filas: 10 }],
    );
    expect(hayAlgoFatal(d)).toBe(true);
  });
});
