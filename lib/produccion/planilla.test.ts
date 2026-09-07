import { describe, it, expect } from "vitest";
import {
  filaDeLaFecha,
  comienzoDelBloqueDePorcentaje,
  celdasDeResumen,
  porcentajeDeRotura,
} from "./planilla";
import type { Producto } from "./types";

const producto = (id: string, nombre_planilla: string | null, orden: number): Producto => ({
  id, nombre: id, familia: "cal", envase: "bolsa",
  kg_por_unidad: 25, nombre_planilla, orden, activo: true,
});

const CAL = producto("p-cal", "Bolsones de Cal", 1);
const FILLER = producto("p-filler", "Bolsones de Filler", 2);
const INTERNO = producto("p-interno", null, 3);

const ENCABEZADOS = ["FECHA", "Bolsones de Cal", "Bolsones de Filler"];

describe("en que fila del resumen va una fecha", () => {
  // Como llega de Sheets con `sinFormato`: seriales, una fila por celda.
  const columnaA = [["46266"], ["46267"], ["46268"]]; // 01, 02 y 03/09/2026

  it("encuentra la fila por la fecha y no contando", () => {
    expect(filaDeLaFecha(columnaA, "2026-09-02", 5)).toBe(6);
  });

  /** Los resúmenes llegan hasta el día 30: un 31 no tiene fila y no se adivina. */
  it("una fecha que no esta devuelve null", () => {
    expect(filaDeLaFecha(columnaA, "2026-09-30", 5)).toBeNull();
  });

  it("una celda vacia no corre la cuenta", () => {
    expect(filaDeLaFecha([[""], ["46267"]], "2026-09-02", 5)).toBe(6);
  });

  /**
   * Mismo criterio que un nombre repetido en `lib/core/catalogo.ts`: un empate
   * no resuelve a ninguno. Elegir la primera fila sería enlazar a la que se
   * parece, y la otra fila duplicada a mano nunca se actualizaría sin que nadie
   * lo note.
   */
  it("una fecha repetida a mano es ambigua y no elige ninguna de las dos filas", () => {
    expect(filaDeLaFecha([["46267"], ["46267"]], "2026-09-02", 5)).toBeNull();
  });
});

describe("donde arranca el bloque de porcentajes", () => {
  it("lo dice la fila 3 de Resumen Rotura", () => {
    const fila3 = ["UNIDADES ROTAS", "", "", "", "", "", "", "", "", "", "",
                   "", "", "", "", "", "", "", "% ROTURA / PRODUCCIÓN"];
    expect(comienzoDelBloqueDePorcentaje(fila3)).toBe(18);
  });

  /** Sin el marcador no se adivina una columna: se informa y no se escribe. */
  it("sin el marcador devuelve null", () => {
    expect(comienzoDelBloqueDePorcentaje(["UNIDADES ROTAS", "", ""])).toBeNull();
  });

  /**
   * Un "%" suelto (una nota, un comentario) antes de la S no es el marcador:
   * buscar cualquier "%" apuntaría al bloque equivocado sin avisar, que es
   * peor que no encontrar nada.
   */
  it("un simbolo de porcentaje suelto en otra celda no se confunde con el marcador", () => {
    const fila3 = ["UNIDADES ROTAS", "50%", "", "", "", "", "", "", "", "", "",
                   "", "", "", "", "", "", "", "% ROTURA / PRODUCCIÓN"];
    expect(comienzoDelBloqueDePorcentaje(fila3)).toBe(18);
  });
});

describe("las celdas de una fila de resumen", () => {
  it("pone cada producto en la columna que dice su nombre en la planilla", () => {
    const r = celdasDeResumen(ENCABEZADOS, [CAL, FILLER], { "p-cal": 18, "p-filler": 2 });
    expect(r.celdas).toEqual([
      { columna: 1, valor: "18" },
      { columna: 2, valor: "2" },
    ]);
    expect(r.sinColumna).toEqual([]);
  });

  it("sin valor va en cero cuando cero es verdad", () => {
    // Despacho y rotura: un producto sin renglón despachó cero, y eso es un dato.
    const r = celdasDeResumen(ENCABEZADOS, [CAL, FILLER], { "p-cal": 18 }, { siFalta: "cero" });
    expect(r.celdas).toContainEqual({ columna: 2, valor: "0" });
  });

  /**
   * Producción: un producto que no está en el mapa es uno que `soloLoCalculado`
   * dejó afuera porque no se pudo calcular. Un 0 ahí devuelve por la ventana el
   * mismo dato falso que el módulo vino a sacar — quien mira la planilla no
   * distingue "no produjo" de "no se sabe".
   */
  it("sin valor queda vacio cuando el cero seria mentira", () => {
    const r = celdasDeResumen(ENCABEZADOS, [CAL, FILLER], { "p-cal": 18 }, { siFalta: "vacio" });
    expect(r.celdas).toContainEqual({ columna: 2, valor: "" });
  });

  it("un cero explicito se escribe cero aunque siFalta sea vacio", () => {
    const r = celdasDeResumen(ENCABEZADOS, [CAL, FILLER], { "p-cal": 18, "p-filler": 0 }, { siFalta: "vacio" });
    expect(r.celdas).toContainEqual({ columna: 2, valor: "0" });
  });

  /** Null en nombre_planilla es una decisión, no un dato faltante. */
  it("un producto que no se exporta no ocupa columna ni se reporta", () => {
    const r = celdasDeResumen(ENCABEZADOS, [CAL, INTERNO], { "p-cal": 1, "p-interno": 9 });
    expect(r.celdas).toEqual([{ columna: 1, valor: "1" }]);
    expect(r.sinColumna).toEqual([]);
  });

  /** Si la planilla no tiene esa columna no se escribe en la de al lado. */
  it("un producto cuya columna no existe se informa y no se escribe", () => {
    const nuevo = producto("p-nuevo", "Bolsones de Magnesio", 4);
    const r = celdasDeResumen(ENCABEZADOS, [CAL, nuevo], { "p-cal": 1, "p-nuevo": 5 });
    expect(r.celdas).toEqual([{ columna: 1, valor: "1" }]);
    expect(r.sinColumna).toEqual(["Bolsones de Magnesio"]);
  });

  it("solo mira dentro de la ventana que se le pasa", () => {
    // Los nombres se repiten en Resumen Rotura: el segundo bloque arranca en 3.
    const conDosBloques = ["FECHA", "Bolsones de Cal", "Bolsones de Filler",
                           "Bolsones de Cal", "Bolsones de Filler"];
    const r = celdasDeResumen(conDosBloques, [CAL], { "p-cal": 7 }, { desde: 3 });
    expect(r.celdas).toEqual([{ columna: 3, valor: "7" }]);
  });
});

describe("el porcentaje de rotura", () => {
  it("es rotura sobre produccion", () => {
    expect(porcentajeDeRotura(1, 50)).toBe("0.02");
  });

  it("sin produccion y sin rotura es cero", () => {
    expect(porcentajeDeRotura(0, 0)).toBe("0");
  });

  /**
   * Hoy el script devuelve 0 acá, y un 0 dice "no hubo roturas" cuando las hubo.
   * Vacío dice lo que pasa: no hay porcentaje posible. La rotura en unidades
   * está en el bloque de al lado, y la pantalla del SdG la muestra.
   */
  it("con roturas y sin produccion queda vacio, no cero", () => {
    expect(porcentajeDeRotura(3, 0)).toBe("");
  });
});
