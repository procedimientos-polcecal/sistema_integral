import { describe, it, expect } from "vitest";
import {
  COLUMNAS_ORDENABLES,
  ORDEN_POR_DEFECTO,
  SIN_COLUMNA,
  ordenarPorColumna,
  siguienteOrden,
  valorDe,
  type ColumnaOrdenable,
} from "./ordenDeColumna";
import type { FilaDeCondicion } from "./gestion";

const HOY = "2026-11-02";

const NOMBRES = new Map([
  ["u-maxi", "Maximiliano Lenzetti"],
  ["u-fran", "Francisco Varela"],
]);

/** Una condición con todo cargado. Cada caso le cambia sólo lo que mira. */
function condicion(cambios: Partial<FilaDeCondicion> & { numero: number }): FilaDeCondicion {
  return {
    id: `c-${cambios.numero}`,
    sector_id: null, equipo_id: null,
    detectada_el: "2026-10-10", detectada_por: null,
    descripcion: "Algo", peligro_id: null, accion_propuesta: "Arreglarlo",
    prioridad: 1, responsable_id: "u-maxi",
    fecha_maxima: "2026-12-01", fecha_ejecucion: null,
    requiere_inversion: null, observaciones: null,
    frecuencia: 3, antecedentes: 1, controles: 3, magnitud_dano: 9, legislacion: 3,
    probabilidad: 7, gravedad: 12, nivel_riesgo: 84,
    sectores: { nombre: "Taller" }, equipos: null, syh_peligros: { nombre: "Atrapado por" },
    ...cambios,
  };
}

const numeros = (filas: FilaDeCondicion[]) => filas.map((c) => c.numero);

describe("ordenarPorColumna", () => {
  it("sin columna elegida no toca el orden, que es el que sube lo que falta", () => {
    const filas = [condicion({ numero: 3 }), condicion({ numero: 1 }), condicion({ numero: 2 })];
    expect(numeros(ordenarPorColumna(filas, ORDEN_POR_DEFECTO, HOY, NOMBRES))).toEqual([3, 1, 2]);
  });

  it("no modifica la lista que recibe", () => {
    const filas = [condicion({ numero: 1 }), condicion({ numero: 2 })];
    ordenarPorColumna(filas, { columna: "numero", ascendente: false }, HOY, NOMBRES);
    expect(numeros(filas)).toEqual([1, 2]);
  });

  it("ordena por número en los dos sentidos", () => {
    const filas = [condicion({ numero: 2 }), condicion({ numero: 10 }), condicion({ numero: 1 })];
    expect(numeros(ordenarPorColumna(filas, { columna: "numero", ascendente: true }, HOY, NOMBRES)))
      .toEqual([1, 2, 10]);
    expect(numeros(ordenarPorColumna(filas, { columna: "numero", ascendente: false }, HOY, NOMBRES)))
      .toEqual([10, 2, 1]);
  });

  // Alfabético pondría «Cerrada» primero, que es lo contrario de para qué se
  // mira esta tabla.
  it("el estado va por urgencia y no por abecedario", () => {
    const filas = [
      condicion({ numero: 1, fecha_ejecucion: "2026-10-20" }),              // Cerrada
      condicion({ numero: 2, fecha_maxima: "2026-12-01" }),                 // Pendiente
      condicion({ numero: 3, fecha_maxima: "2026-10-01" }),                 // Vencida
    ];
    expect(numeros(ordenarPorColumna(filas, { columna: "estado", ascendente: true }, HOY, NOMBRES)))
      .toEqual([3, 2, 1]);
  });

  it("ordena por el nombre del responsable y no por su id", () => {
    const filas = [
      condicion({ numero: 1, responsable_id: "u-maxi" }),   // Maximiliano
      condicion({ numero: 2, responsable_id: "u-fran" }),   // Francisco
    ];
    expect(numeros(ordenarPorColumna(filas, { columna: "responsable", ascendente: true }, HOY, NOMBRES)))
      .toEqual([2, 1]);
  });

  it("ordena por el lugar, sea un sector o un equipo", () => {
    const filas = [
      condicion({ numero: 1, sectores: { nombre: "Taller" }, equipos: null }),
      condicion({ numero: 2, sectores: null, equipos: { name: "Filler 1", code: "PY-F1" } }),
    ];
    expect(numeros(ordenarPorColumna(filas, { columna: "lugar", ascendente: true }, HOY, NOMBRES)))
      .toEqual([2, 1]);
  });

  it("ordena por el nivel de riesgo y no por la letra de la clasificación", () => {
    // Por letra, "I" (intolerable, 150) iría después de "M" (moderado, 60).
    const filas = [condicion({ numero: 1, nivel_riesgo: 60 }), condicion({ numero: 2, nivel_riesgo: 150 })];
    expect(numeros(ordenarPorColumna(filas, { columna: "riesgo", ascendente: false }, HOY, NOMBRES)))
      .toEqual([2, 1]);
  });
});

describe("los nulos van al final en los dos sentidos", () => {
  // Es la regla que más pesa acá: hoy 37 de 44 no tienen lugar, 44 no tienen
  // peligro y 35 no tienen nivel. Si viajaran con los valores, dar vuelta la
  // flecha llenaría la primera pantalla de celdas vacías.
  const conYSin = (columna: ColumnaOrdenable, vacia: Partial<FilaDeCondicion>) => [
    condicion({ numero: 1, ...vacia }),
    condicion({ numero: 2 }),
  ];

  it.each([
    ["lugar", { sectores: null, equipos: null }],
    ["peligro", { syh_peligros: null }],
    ["riesgo", { nivel_riesgo: null }],
    ["responsable", { responsable_id: null }],
    ["fecha_maxima", { fecha_maxima: null }],
  ] as [ColumnaOrdenable, Partial<FilaDeCondicion>][])("%s", (columna, vacia) => {
    const filas = conYSin(columna, vacia);
    for (const ascendente of [true, false]) {
      expect(numeros(ordenarPorColumna(filas, { columna, ascendente }, HOY, NOMBRES))).toEqual([2, 1]);
    }
  });

  it("dos nulas entre sí se desempatan por número, de la más nueva a la más vieja", () => {
    const filas = [
      condicion({ numero: 1, nivel_riesgo: null }),
      condicion({ numero: 5, nivel_riesgo: null }),
    ];
    expect(numeros(ordenarPorColumna(filas, { columna: "riesgo", ascendente: true }, HOY, NOMBRES)))
      .toEqual([5, 1]);
  });
});

describe("el desempate no se invierte con la flecha", () => {
  it("dos filas con el mismo valor salen siempre con la más nueva arriba", () => {
    const filas = [condicion({ numero: 1 }), condicion({ numero: 7 }), condicion({ numero: 4 })];
    for (const ascendente of [true, false]) {
      expect(numeros(ordenarPorColumna(filas, { columna: "lugar", ascendente }, HOY, NOMBRES)))
        .toEqual([7, 4, 1]);
    }
  });
});

describe("siguienteOrden", () => {
  it("la misma columna da vuelta la flecha", () => {
    expect(siguienteOrden({ columna: "lugar", ascendente: true }, "lugar"))
      .toEqual({ columna: "lugar", ascendente: false });
    expect(siguienteOrden({ columna: "lugar", ascendente: false }, "lugar"))
      .toEqual({ columna: "lugar", ascendente: true });
  });

  it("una columna nueva arranca mostrando lo que se quiere ver primero de ella", () => {
    // El número y el riesgo, de mayor a menor: la condición más nueva y el
    // riesgo más alto. Las demás, ascendentes.
    expect(siguienteOrden(ORDEN_POR_DEFECTO, "numero").ascendente).toBe(false);
    expect(siguienteOrden(ORDEN_POR_DEFECTO, "riesgo").ascendente).toBe(false);
    expect(siguienteOrden(ORDEN_POR_DEFECTO, "fecha_maxima").ascendente).toBe(true);
    expect(siguienteOrden(ORDEN_POR_DEFECTO, "estado").ascendente).toBe(true);
    expect(siguienteOrden(ORDEN_POR_DEFECTO, "lugar").ascendente).toBe(true);
  });
});

describe("el contrato de las columnas", () => {
  // Si alguien agrega una columna ordenable y se olvida de COLUMNAS_ORDENABLES,
  // el encabezado de la pantalla no la ofrece y nada falla. Este test lo nota.
  it("todas las columnas de la lista tienen un valor que comparar", () => {
    const c = condicion({ numero: 1 });
    for (const columna of COLUMNAS_ORDENABLES) {
      expect(valorDe(c, columna, HOY, NOMBRES)).not.toBeUndefined();
    }
  });

  it("el orden por defecto no elige ninguna columna", () => {
    expect(ORDEN_POR_DEFECTO.columna).toBe(SIN_COLUMNA);
  });
});
