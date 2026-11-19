import { describe, expect, it } from "vitest";
import { filasDeLaHoja, leerApagadas } from "./hojaDeLaCurva";

/** La misma muestra de `Calcio 0-2` del 27/10/2026 que usa `curva.test.ts`. */
const MUESTRA = {
  id: "a",
  producto: "Calcio 0-2",
  fecha: "2026-10-27",
  observaciones: null,
  pesoMuestraG: 100,
  retenidos: [
    { malla: 6, retenido_g: 0 },
    { malla: 7, retenido_g: 0 },
    { malla: 10, retenido_g: 0.2 },
    { malla: 12, retenido_g: 0.7 },
    { malla: 20, retenido_g: 6.0 },
    { malla: 50, retenido_g: 34.7 },
    { malla: 100, retenido_g: 14.4 },
    { malla: 200, retenido_g: 10.4 },
  ],
};

/** Otro juego de mallas: sin #20 y con #325. Es el cruce que de verdad pasa. */
const FINO = {
  id: "b",
  producto: "Filler 1",
  fecha: "2026-11-03",
  observaciones: null,
  pesoMuestraG: 100,
  retenidos: [
    { malla: 50, retenido_g: 30 },
    { malla: 100, retenido_g: 20 },
    { malla: 200, retenido_g: 10 },
    { malla: 325, retenido_g: 5 },
  ],
};

/** Una fila de datos es la que tiene el número de la malla en su segunda columna. */
const esDeMalla = (fila: unknown[]) => typeof fila[1] === "number";

const aTexto = (filas: unknown[][]) => filas.map((f) => f.join(" | ")).join("\n");

describe("filasDeLaHoja", () => {
  it("con una muestra lleva una fila por malla medida, tambien las apagadas", () => {
    const deMalla = filasDeLaHoja([MUESTRA], [20]).filter(esDeMalla);

    expect(deMalla).toHaveLength(8);
    expect(deMalla.map((f) => f[1])).toContain(20);
    expect(deMalla[7]).toEqual(["27/10/2026", 200, 10.4, 66.4, 33.6, "Dentro"]);
  });

  it("con dos muestras no hay fila para la malla que una no midio", () => {
    const deMalla = filasDeLaHoja([MUESTRA, FINO], []).filter(esDeMalla);

    // 8 + 4, nunca 9 + 9: la malla que esa muestra no midió no deja una celda
    // vacía, que en una planilla se lee como cero.
    expect(deMalla).toHaveLength(12);
    expect(deMalla.filter((f) => f[1] === 325)).toHaveLength(1);
    expect(deMalla.filter((f) => f[1] === 20)).toHaveLength(1);
  });

  it("las filas van agrupadas por muestra y dentro por malla", () => {
    const deMalla = filasDeLaHoja([MUESTRA, FINO], []).filter(esDeMalla);

    expect(deMalla.slice(0, 8).every((f) => f[0] === "Calcio 0-2 · 27/10/2026")).toBe(true);
    expect(deMalla.slice(8).every((f) => f[0] === "Filler 1 · 03/11/2026")).toBe(true);
  });

  it("la fila apagada se marca en su propia columna", () => {
    const deMalla = filasDeLaHoja([MUESTRA], [20]).filter(esDeMalla);

    expect(deMalla.find((f) => f[1] === 20)?.[5]).toBe("Fuera");
    const otras = deMalla.filter((f) => f[1] !== 20);
    expect(otras).toHaveLength(7);
    for (const f of otras) expect(f[5]).toBe("Dentro");
  });

  it("los numeros de la fila apagada son los que se midieron", () => {
    const fila = filasDeLaHoja([MUESTRA], [20])
      .filter(esDeMalla)
      .find((f) => f[1] === 20);

    expect(fila?.[2]).toBe(6);
    // El acumulado de la #20 es 0 + 0 + 0,2 + 0,7 + 6 = 6,9 (el 41,6 es el de la #50).
    expect(fila?.[3]).toBe(6.9);
    expect(fila?.[4]).toBe(93.1);
  });

  it("la nota del acumulado viaja en la hoja, y solo cuando hay alguna apagada", () => {
    const con = aTexto(filasDeLaHoja([MUESTRA], [20]));
    const sin = aTexto(filasDeLaHoja([MUESTRA], []));

    expect(con).toContain("ya incluyen lo que ésa retuvo");
    expect(sin).not.toContain("ya incluyen");
    // Apagar una malla que ninguna muestra midió no apaga nada: tampoco va.
    expect(aTexto(filasDeLaHoja([MUESTRA], [325]))).not.toContain("ya incluyen");
    // Pero si la midió otra de las elegidas, sí.
    expect(aTexto(filasDeLaHoja([MUESTRA, FINO], [325]))).toContain("ya incluyen");
  });

  it("la nota concuerda con una apagada y con varias", () => {
    const una = aTexto(filasDeLaHoja([MUESTRA], [20]));
    expect(una).toContain(
      "Nota: #20 está fuera del gráfico, pero las mallas que le siguen ya incluyen lo que ésa retuvo."
    );

    const dos = aTexto(filasDeLaHoja([MUESTRA], [20, 50]));
    expect(dos).toContain(
      "Nota: #20 y #50 están fuera del gráfico, pero las mallas que les siguen ya incluyen lo que ésas retuvieron."
    );

    const tres = aTexto(filasDeLaHoja([MUESTRA], [10, 20, 50]));
    expect(tres).toContain("Nota: #10, #20 y #50 están fuera del gráfico");
    expect(tres).not.toContain("está fuera");
  });

  it("el problema de la muestra viaja en la hoja, tal cual", () => {
    const filas = filasDeLaHoja([{ ...MUESTRA, pesoMuestraG: 50 }], []);

    expect(filas.some((f) => f.includes("Lo retenido supera el peso de la muestra."))).toBe(true);
  });

  it("con varias muestras el problema dice de cual habla", () => {
    const pesada = { ...MUESTRA, id: "e", pesoMuestraG: 50 };
    const texto = aTexto(filasDeLaHoja([pesada, FINO], []));

    expect(texto).toContain(
      "Calcio 0-2 · 27/10/2026: Lo retenido supera el peso de la muestra."
    );
  });

  it("una muestra sin peso no tiene filas de datos", () => {
    const filas = filasDeLaHoja([{ ...MUESTRA, pesoMuestraG: null }], []);

    expect(filas.filter(esDeMalla)).toHaveLength(0);
    expect(filas.some((f) => f.includes("Falta el peso de la muestra tamizada."))).toBe(true);
  });

  it("una muestra sin granulometria no tira abajo la hoja de las demas", () => {
    const deMalla = filasDeLaHoja([MUESTRA, { ...FINO, retenidos: [] }], []).filter(esDeMalla);

    expect(deMalla).toHaveLength(8);
  });

  it("una muestra sin granulometria lo dice, en vez de desaparecer de la tabla", () => {
    const texto = aTexto(filasDeLaHoja([MUESTRA, { ...FINO, retenidos: [] }], []));

    // Sin esto el encabezado promete dos muestras y la tabla entrega una, sin
    // que nada diga por que: es la misma celda muda que el formato largo vino
    // a evitar, por la otra puerta.
    expect(texto).toContain("Filler 1 · 03/11/2026: sin granulometría cargada.");
  });

  it("un peso que falta no viaja como celda vacia", () => {
    const filas = filasDeLaHoja([{ ...MUESTRA, pesoMuestraG: null }], []);
    const delEncabezado = filas.find((f) => f[1] === "Calcio 0-2")!;

    // Una celda numerica vacia se lee como cero, que es justo lo que el formato
    // largo existe para no decir.
    expect(delEncabezado[3]).toBe("—");
  });

  it("el peso que esta sigue siendo un numero, para poder sumarlo", () => {
    const filas = filasDeLaHoja([MUESTRA], []);
    const delEncabezado = filas.find((f) => f[1] === "Calcio 0-2")!;

    expect(delEncabezado[3]).toBe(100);
  });

  it("el encabezado lleva una fila por muestra, con su producto y su peso", () => {
    const filas = filasDeLaHoja([MUESTRA, FINO], []);

    expect(filas).toContainEqual([
      "Calcio 0-2 · 27/10/2026",
      "Calcio 0-2",
      // Legible, no ISO: la lee una persona en Excel.
      "27/10/2026",
      100,
      "",
    ]);
    expect(filas).toContainEqual(["Filler 1 · 03/11/2026", "Filler 1", "03/11/2026", 100, ""]);
    expect(filas).toContainEqual(["Filler 1 · 03/11/2026", "Filler 1", "03/11/2026", 100, ""]);
  });

  it("con una sola muestra la etiqueta no repite el producto", () => {
    const filas = filasDeLaHoja([MUESTRA], []);

    expect(filas).toContainEqual(["27/10/2026", "Calcio 0-2", "27/10/2026", 100, ""]);
  });
});

describe("leerApagadas", () => {
  it("sin campo o vacío, ninguna apagada", () => {
    expect(leerApagadas(null)).toEqual([]);
    expect(leerApagadas("")).toEqual([]);
  });

  it("lee un array de números", () => {
    expect(leerApagadas("[20,50]")).toEqual([20, 50]);
    expect(leerApagadas("[]")).toEqual([]);
  });

  it("un JSON malo dice que no es válido", () => {
    expect(leerApagadas("[20,")).toEqual({ problema: "Las mallas apagadas no son un JSON válido." });
  });

  it("un JSON que no es un array es un problema", () => {
    expect(leerApagadas('{"a":1}')).toHaveProperty("problema");
    expect(leerApagadas("20")).toHaveProperty("problema");
    expect(leerApagadas('"20"')).toHaveProperty("problema");
  });

  it("un array con cosas que no son números es un problema", () => {
    expect(leerApagadas('[20,"50"]')).toHaveProperty("problema");
    expect(leerApagadas("[20,null]")).toHaveProperty("problema");
    expect(leerApagadas("[[20]]")).toHaveProperty("problema");
  });

  it("un array de más de cien es un problema", () => {
    expect(leerApagadas(JSON.stringify(new Array(101).fill(1)))).toHaveProperty("problema");
    expect(leerApagadas(JSON.stringify(new Array(100).fill(1)))).toHaveLength(100);
  });

  it("un archivo en lugar de texto es un problema", () => {
    expect(leerApagadas(new File(["[]"], "x.json"))).toHaveProperty("problema");
  });
});
