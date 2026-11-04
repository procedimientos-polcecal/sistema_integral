import { describe, it, expect } from "vitest";
import { corteDelHistorial } from "./vista";
import { desdeParaLeer, diasDelRango, hrefDeLaAgenda, inicioDeLaSemana, leerDia, leerVista, tituloDelRango } from "./rango";

describe("leerVista", () => {
  it("por defecto es la semana", () => {
    expect(leerVista(undefined)).toBe("semana");
  });
  it("acepta las tres y rechaza cualquier otra cosa", () => {
    expect(leerVista("dia")).toBe("dia");
    expect(leerVista("lista")).toBe("lista");
    expect(leerVista("mes")).toBe("semana");
    expect(leerVista(["dia", "lista"])).toBe("semana");
  });
});

describe("leerDia", () => {
  it("sin parámetro es hoy", () => {
    expect(leerDia(undefined, "2026-11-04")).toBe("2026-11-04");
  });
  it("un día válido se respeta", () => {
    expect(leerDia("2026-03-09", "2026-11-04")).toBe("2026-03-09");
  });
  // La URL la escribe cualquiera.
  it("una fecha que no existe o no es una fecha cae en hoy", () => {
    expect(leerDia("banana", "2026-11-04")).toBe("2026-11-04");
    expect(leerDia("2026-13-45", "2026-11-04")).toBe("2026-11-04");
    expect(leerDia("2026-02-30", "2026-11-04")).toBe("2026-11-04");
    expect(leerDia("", "2026-11-04")).toBe("2026-11-04");
  });
});

describe("inicioDeLaSemana", () => {
  it("la semana arranca el lunes", () => {
    expect(inicioDeLaSemana("2026-11-04")).toBe("2026-11-02"); // miércoles
    expect(inicioDeLaSemana("2026-11-02")).toBe("2026-11-02"); // el lunes mismo
  });
  it("un domingo pertenece a la semana que termina, no a la que empieza", () => {
    expect(inicioDeLaSemana("2026-11-08")).toBe("2026-11-02");
  });
});

describe("diasDelRango", () => {
  it("la semana son siete días, de lunes a domingo", () => {
    expect(diasDelRango("semana", "2026-11-04")).toEqual([
      "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05",
      "2026-11-06", "2026-11-07", "2026-11-08",
    ]);
  });
  it("el día es uno solo", () => {
    expect(diasDelRango("dia", "2026-11-04")).toEqual(["2026-11-04"]);
  });
  it("la lista no dibuja grilla", () => {
    expect(diasDelRango("lista", "2026-11-04")).toEqual([]);
  });
});

describe("desdeParaLeer", () => {
  const ahora = new Date("2026-11-04T12:00:00Z"); // corte del historial: 2026-10-05

  it("mirando esta semana, manda el corte del historial", () => {
    expect(desdeParaLeer("semana", "2026-11-04", ahora)).toBe(corteDelHistorial(ahora));
  });
  it("mirando una semana vieja, se pide desde esa semana", () => {
    expect(desdeParaLeer("semana", "2026-03-09", ahora)).toBe("2026-03-09T00:00:00.000Z");
  });
  it("mirando el futuro, el corte del historial sigue mandando", () => {
    expect(desdeParaLeer("semana", "2027-05-10", ahora)).toBe(corteDelHistorial(ahora));
  });
  // Decisión 11 del spec: la vista Lista ignora el día que se está mirando.
  it("la vista Lista usa siempre el corte del historial, mire el día que mire", () => {
    expect(desdeParaLeer("lista", "2026-03-09", ahora)).toBe(corteDelHistorial(ahora));
  });
});

describe("tituloDelRango", () => {
  it("una semana dentro de un mes dice el mes y el año", () => {
    expect(tituloDelRango("semana", "2026-11-04")).toBe("Noviembre 2026");
  });
  it("una semana a caballo de dos meses los nombra a los dos", () => {
    expect(tituloDelRango("semana", "2026-12-02")).toBe("Noviembre – Diciembre 2026");
  });
  it("una semana que cruza el año pone el año de cada mes", () => {
    expect(tituloDelRango("semana", "2026-12-31")).toBe("Diciembre 2026 – Enero 2027");
  });
  it("un día se dice entero", () => {
    expect(tituloDelRango("dia", "2026-11-04")).toBe("mié 04/11/2026");
  });
  it("la lista no tiene rango y dice lo que es", () => {
    expect(tituloDelRango("lista", "2026-11-04")).toBe("Próximos y recientes");
  });
});

describe("hrefDeLaAgenda", () => {
  it("arma la vista y el día", () => {
    expect(hrefDeLaAgenda("semana", "2026-11-04", false)).toBe("/agenda?vista=semana&dia=2026-11-04");
  });
  it("conserva el historial para no perderlo al cambiar de vista", () => {
    expect(hrefDeLaAgenda("lista", "2026-11-04", true)).toBe("/agenda?vista=lista&dia=2026-11-04&historial=1");
  });
});
