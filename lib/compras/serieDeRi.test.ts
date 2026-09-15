import { describe, it, expect } from "vitest";
import { maximoDeLaColumna, proximoNroRi } from "./serieDeRi";

/** Las filas como las devuelve la API: `[N° de RI, marca temporal]`. */
const hoja = (...filas: (string | number)[][]): string[][] =>
  filas.map((f) => f.map((c) => String(c)));

describe("el maximo de una columna de N° de RI", () => {
  it("ignora las filas de cebado de la hoja de respuestas", () => {
    // La 2 tiene un -1 y la 3 un 0: cebaban la vieja numeracion por formula y
    // no son pedidos. Contarlas no cambia el maximo, pero el dia que alguien
    // escriba algo ahi si, y seria un numero repartido desde una fila que nadie
    // considera un pedido.
    const filas = hoja(
      ["Nº RI", "Marca temporal"],
      [-1, ""],
      [0, "-"],
      [1, "19/8/2025"],
      [1969, "12/9/2026"]
    );
    expect(maximoDeLaColumna(filas, 4)).toBe(1969);
  });

  it("una pestania con solo el encabezado da cero, no NaN", () => {
    // Es el estado de `Altas del sistema` hasta la primera alta, asi que este
    // caso corre en produccion desde el dia uno.
    expect(maximoDeLaColumna(hoja(["Nº RI", "Marca temporal"]), 2)).toBe(0);
    expect(maximoDeLaColumna([], 2)).toBe(0);
  });

  it("no se queda con el ultimo sino con el mayor", () => {
    // La fila del alta vieja quedo DEBAJO de respuestas mas nuevas: Forms
    // inserta las suyas justo despues de su propia ultima respuesta y empuja
    // hacia abajo cualquier fila ajena. Leer "el ultimo" daria 1959.
    const filas = hoja(
      ["Nº RI", "Marca"],
      [1968, "11/9/2026"],
      [1970, "14/9/2026"],
      [1959, "9/9/2026"]
    );
    expect(maximoDeLaColumna(filas, 2)).toBe(1970);
  });

  it("una celda vacia o con texto no arrastra la cuenta", () => {
    const filas = hoja(["Nº RI"], [1968], [""], ["(pendiente)"], [1969]);
    expect(maximoDeLaColumna(filas, 2)).toBe(1969);
  });
});

describe("el proximo N° de la serie", () => {
  it("el caso que motivo el arreglo: la planilla va adelante de la base", () => {
    // 14/09/2026, 10:45: entra "Pinza amperometrica" por el formulario y el
    // Apps Script la numera 1970. 10:47: se carga un pedido desde el sistema y
    // la base todavia tiene 1969 como maximo, porque la sincronizacion no
    // corrio. Mirando solo la base elegia 1970 y chocaba.
    expect(proximoNroRi([1969, 1970, 0])).toBe(1971);
  });

  it("con la planilla ilegible sigue con lo que sabe la base", () => {
    // Google caido no puede frenar un alta: el pedido entra igual y la
    // comprobacion previa a escribir queda de red. Un cero es "esta fuente no
    // dice nada", no "la serie arranca de cero".
    expect(proximoNroRi([1969, 0, 0])).toBe(1970);
  });

  it("la pestania de altas tambien cuenta", () => {
    // Dos altas seguidas desde el sistema, sin sincronizacion en el medio: la
    // segunda tiene que ver a la primera, que esta en la planilla y todavia no
    // en la base.
    expect(proximoNroRi([1969, 1969, 1970])).toBe(1971);
  });

  it("sin ninguna fuente arranca en 1", () => {
    expect(proximoNroRi([])).toBe(1);
    expect(proximoNroRi([0, 0, 0])).toBe(1);
  });
});
