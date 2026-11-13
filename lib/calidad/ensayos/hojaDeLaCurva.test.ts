import { describe, expect, it } from "vitest";
import { filasDeLaHoja, leerApagadas } from "./hojaDeLaCurva";

/** La misma muestra de `Calcio 0-2` del 27/10/2026 que usa `curva.test.ts`. */
const MUESTRA = {
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

const ENCABEZADO = { producto: "Calcio 0-2", fecha: "2026-10-27", observaciones: null };

/** Una fila de datos es la que empieza con el número de la malla. */
const esDeMalla = (fila: unknown[]) => typeof fila[0] === "number";

const aTexto = (filas: unknown[][]) => filas.map((f) => f.join(" | ")).join("\n");

describe("filasDeLaHoja", () => {
  it("lleva todas las mallas que midio la muestra, tambien las apagadas", () => {
    const filas = filasDeLaHoja(MUESTRA, [20], ENCABEZADO);
    const deMalla = filas.filter(esDeMalla);

    expect(deMalla).toHaveLength(8);
    expect(deMalla.map((f) => f[0])).toContain(20);
  });

  it("la fila apagada se marca en su propia columna", () => {
    const deMalla = filasDeLaHoja(MUESTRA, [20], ENCABEZADO).filter(esDeMalla);

    expect(deMalla.find((f) => f[0] === 20)?.[4]).toBe("Fuera");
    const otras = deMalla.filter((f) => f[0] !== 20);
    expect(otras).toHaveLength(7);
    for (const f of otras) expect(f[4]).toBe("Dentro");
  });

  it("los numeros de la fila apagada son los que se midieron", () => {
    const fila = filasDeLaHoja(MUESTRA, [20], ENCABEZADO)
      .filter(esDeMalla)
      .find((f) => f[0] === 20);

    expect(fila?.[1]).toBe(6);
    // El acumulado de la #20 es 0 + 0 + 0,2 + 0,7 + 6 = 6,9 (el 41,6 es el de la #50).
    expect(fila?.[2]).toBe(6.9);
    expect(fila?.[3]).toBe(93.1);
  });

  it("la nota del acumulado viaja en la hoja, y solo cuando hay alguna apagada", () => {
    const con = aTexto(filasDeLaHoja(MUESTRA, [20], ENCABEZADO));
    const sin = aTexto(filasDeLaHoja(MUESTRA, [], ENCABEZADO));

    expect(con).toContain("ya incluyen lo que ésa retuvo");
    expect(sin).not.toContain("ya incluyen");
    // Apagar una malla que la muestra no midió no apaga nada: tampoco va.
    expect(aTexto(filasDeLaHoja(MUESTRA, [325], ENCABEZADO))).not.toContain("ya incluyen");
  });

  it("la nota concuerda con una apagada y con varias", () => {
    const una = aTexto(filasDeLaHoja(MUESTRA, [20], ENCABEZADO));
    expect(una).toContain("Nota: #20 está fuera del gráfico, pero las mallas que le siguen ya incluyen lo que ésa retuvo.");

    const dos = aTexto(filasDeLaHoja(MUESTRA, [20, 50], ENCABEZADO));
    expect(dos).toContain(
      "Nota: #20 y #50 están fuera del gráfico, pero las mallas que les siguen ya incluyen lo que ésas retuvieron."
    );

    const tres = aTexto(filasDeLaHoja(MUESTRA, [10, 20, 50], ENCABEZADO));
    expect(tres).toContain("Nota: #10, #20 y #50 están fuera del gráfico");
    expect(tres).not.toContain("está fuera");
  });

  it("el problema de la muestra viaja en la hoja, tal cual", () => {
    const filas = filasDeLaHoja({ ...MUESTRA, pesoMuestraG: 50 }, [], ENCABEZADO);

    expect(filas.some((f) => f.includes("Lo retenido supera el peso de la muestra."))).toBe(true);
  });

  it("una muestra sin peso no tiene filas de datos", () => {
    const filas = filasDeLaHoja({ ...MUESTRA, pesoMuestraG: null }, [], ENCABEZADO);

    expect(filas.filter(esDeMalla)).toHaveLength(0);
    expect(filas.some((f) => f.includes("Falta el peso de la muestra tamizada."))).toBe(true);
  });

  it("el encabezado lleva el producto, la fecha y el peso", () => {
    const filas = filasDeLaHoja(MUESTRA, [], ENCABEZADO);

    expect(filas).toContainEqual(["Producto", "Calcio 0-2"]);
    // Legible, no ISO: la lee una persona en Excel.
    expect(filas).toContainEqual(["Fecha", "27/10/2026"]);
    expect(filas).toContainEqual(["Peso de la muestra (g)", 100]);
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
