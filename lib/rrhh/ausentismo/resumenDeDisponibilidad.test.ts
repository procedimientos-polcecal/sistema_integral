import { describe, expect, it } from "vitest";
import {
  LIMITE_DE_LA_GRILLA,
  entraLaGrilla,
  filasDeLaGrilla,
  resumenDeDisponibilidad,
  totalesPorDia,
  type AusentePublico,
} from "./resumenDeDisponibilidad";

const SEMANA = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];

const a = (empleadoId: string, nombre: string, sector: string | null, dia: string): AusentePublico => ({
  empleadoId,
  nombre,
  sector,
  dia,
});

/**
 * La semana de ejemplo: 7 personas, 13 días-persona, el jueves es el peor con 4.
 *
 * Los números están contados, no estimados. La maqueta que se aprobó los tenía
 * dibujados a mano y su fila de totales no cerraba con sus propias filas —decía
 * jueves 4 cuando las celdas daban 3—, que es exactamente el motivo por el que
 * esta aritmética vive en una función con tests y no en el JSX.
 */
const AUSENTES: AusentePublico[] = [
  ...["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"].map((d) =>
    a("e1", "MENDIZABAL, LUCAS EZEQUIEL", "Mantenimiento", d)
  ),
  a("e2", "CHACON, MARTIN OSCAR", "Mantenimiento", "2026-11-05"),
  a("e2", "CHACON, MARTIN OSCAR", "Mantenimiento", "2026-11-06"),
  a("e3", "ANDRADA, JUAN JOSE", "Cantera y Planta de Trituración", "2026-11-02"),
  a("e3", "ANDRADA, JUAN JOSE", "Cantera y Planta de Trituración", "2026-11-03"),
  a("e4", "BELTRAMELLA, HECTOR FABIÁN", "Cantera y Planta de Trituración", "2026-11-05"),
  a("e5", "BRAVO, GUILLERMO RAUL", "Mantenimiento", "2026-11-02"),
  a("e6", "DOLEZOR, DIEGO MATIAS", "Producción - Despacho", "2026-11-03"),
  a("e7", "SANDOVAL, VICTOR", "Producción", "2026-11-05"),
];

const PERSONAL = { Mantenimiento: 11, "Cantera y Planta de Trituración": 13, "Producción - Despacho": 9 };

describe("resumenDeDisponibilidad", () => {
  it("cuenta personas y no días: quien falta cinco días es una sola persona", () => {
    const r = resumenDeDisponibilidad(AUSENTES, SEMANA, PERSONAL);
    expect(r.personas).toBe(7);
  });

  it("el día más flojo es el que tiene más gente, con su cantidad", () => {
    const r = resumenDeDisponibilidad(AUSENTES, SEMANA, PERSONAL);
    expect(r.diaMasFlojo).toEqual({ dia: "2026-11-05", cantidad: 4 });
  });

  it("empatados, gana el primero: sin una regla, el mismo dato daría dos respuestas", () => {
    const empate = [
      a("e1", "UNO", "Taller", "2026-11-02"),
      a("e2", "DOS", "Taller", "2026-11-03"),
    ];
    expect(resumenDeDisponibilidad(empate, SEMANA, {}).diaMasFlojo).toEqual({ dia: "2026-11-02", cantidad: 1 });
  });

  it("el sector más golpeado cuenta PERSONAS y no días, y trae su dotación", () => {
    // Mantenimiento tiene 3 personas (e1, e2, e5) y 8 días-persona; Cantera, 2 y 3.
    // Contando días ganaría igual, pero con otra historia: lo que importa es
    // cuánta gente del sector no está, no cuántas veces faltó la misma.
    const r = resumenDeDisponibilidad(AUSENTES, SEMANA, PERSONAL);
    expect(r.sectorMasGolpeado).toEqual({ sector: "Mantenimiento", cantidad: 3, personal: 11 });
  });

  it("un sector sin dotación conocida trae personal en null y no inventa un cero", () => {
    const r = resumenDeDisponibilidad(AUSENTES, SEMANA, {});
    expect(r.sectorMasGolpeado?.personal).toBeNull();
  });

  it("quien no tiene sector se agrupa en «Sin sector» y puede ser el más golpeado", () => {
    const sinSector = [a("e9", "NN", null, "2026-11-02"), a("e8", "MM", null, "2026-11-03")];
    expect(resumenDeDisponibilidad(sinSector, SEMANA, {}).sectorMasGolpeado).toEqual({
      sector: "Sin sector",
      cantidad: 2,
      personal: null,
    });
  });

  it("sin nadie ausente no hay día flojo ni sector golpeado: null y no un cero disfrazado", () => {
    const r = resumenDeDisponibilidad([], SEMANA, PERSONAL);
    expect(r.personas).toBe(0);
    expect(r.diaMasFlojo).toBeNull();
    expect(r.sectorMasGolpeado).toBeNull();
  });
});

describe("filasDeLaGrilla", () => {
  it("una fila por persona, ordenada por días de ausencia y después por nombre", () => {
    const filas = filasDeLaGrilla(AUSENTES, SEMANA);
    expect(filas.map((f) => f.nombre)).toEqual([
      "MENDIZABAL, LUCAS EZEQUIEL", // 5
      "ANDRADA, JUAN JOSE", // 2, y alfabéticamente antes que CHACON
      "CHACON, MARTIN OSCAR", // 2
      "BELTRAMELLA, HECTOR FABIÁN", // 1
      "BRAVO, GUILLERMO RAUL", // 1
      "DOLEZOR, DIEGO MATIAS", // 1
      "SANDOVAL, VICTOR", // 1
    ]);
    expect(filas.map((f) => f.total)).toEqual([5, 2, 2, 1, 1, 1, 1]);
  });

  it("cada fila dice en qué días falta, alineado con los días pedidos", () => {
    const fila = filasDeLaGrilla(AUSENTES, SEMANA).find((f) => f.empleadoId === "e3")!;
    expect(fila.falta).toEqual([true, true, false, false, false, false, false]);
  });

  it("la misma persona repetida el mismo día cuenta una sola vez", () => {
    const repetida = [
      a("e1", "UNO", "Taller", "2026-11-02"),
      a("e1", "UNO", "Taller", "2026-11-02"),
    ];
    const filas = filasDeLaGrilla(repetida, SEMANA);
    expect(filas).toHaveLength(1);
    expect(filas[0].total).toBe(1);
  });

  it("un día que no está en el rango no entra en la fila", () => {
    const fuera = [a("e1", "UNO", "Taller", "2026-12-25")];
    expect(filasDeLaGrilla(fuera, SEMANA)[0].total).toBe(0);
  });
});

describe("totalesPorDia", () => {
  it("devuelve un número por día, en el orden de los días", () => {
    expect(totalesPorDia(AUSENTES, SEMANA)).toEqual([3, 3, 1, 4, 2, 0, 0]);
  });

  it("la suma de los días es el total de días-persona, que no es la cantidad de personas", () => {
    const porDia = totalesPorDia(AUSENTES, SEMANA);
    expect(porDia.reduce((s, n) => s + n, 0)).toBe(13);
    expect(resumenDeDisponibilidad(AUSENTES, SEMANA, PERSONAL).personas).toBe(7);
  });
});

describe("entraLaGrilla", () => {
  it("una semana y un mes entran; el trimestre que la ruta permite, no", () => {
    expect(entraLaGrilla(7)).toBe(true);
    expect(entraLaGrilla(LIMITE_DE_LA_GRILLA)).toBe(true);
    expect(entraLaGrilla(LIMITE_DE_LA_GRILLA + 1)).toBe(false);
    // El tope de la ruta son 93 días: con una columna por día no entra en
    // ninguna pantalla, y por eso existe la lista por día.
    expect(entraLaGrilla(93)).toBe(false);
  });

  it("el límite es 31 y está fijado acá: un mes largo entero tiene que entrar", () => {
    expect(LIMITE_DE_LA_GRILLA).toBe(31);
  });
});
