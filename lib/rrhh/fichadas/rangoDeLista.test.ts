import { describe, it, expect } from "vitest";
import { DIAS_DE_LA_LISTA, rangoDeLista, rangoQueIncluye } from "./rangoDeLista";

describe("rangoDeLista", () => {
  it("son siete días contando hoy, no siete para atrás", () => {
    expect(rangoDeLista(new Date("2026-10-14T12:00:00Z"))).toEqual({
      desde: "2026-10-08",
      hasta: "2026-10-14",
    });
  });

  /**
   * EL CASO QUE JUSTIFICA LA FUNCIÓN.
   *
   * El 14/10/2026 la lista mostraba 50 filas y el 14 más el 13 ya sumaban 85:
   * el 10, el 11 y el 12 estaban en la base y no se podían ver. Con este rango
   * los tres entran.
   */
  it("el rango de hoy incluye los tres días que no se veían", () => {
    const { desde, hasta } = rangoDeLista(new Date("2026-10-14T12:00:00Z"));
    for (const dia of ["2026-10-10", "2026-10-11", "2026-10-12"]) {
      expect(dia >= desde && dia <= hasta).toBe(true);
    }
  });

  /**
   * A las 21:30 de Argentina ya es el día siguiente en UTC. Tomar el día en
   * UTC correría la ventana entera un día: mostraría un mañana que no existe
   * y se comería el más viejo, justo cuando alguien revisa la semana de noche.
   */
  it("el día se toma en Argentina y no en UTC", () => {
    // 02:00 UTC del 15 son las 23:00 del 14 acá: el instante en que los dos
    // husos no dicen lo mismo, que es el único donde el test prueba algo.
    expect(rangoDeLista(new Date("2026-10-15T02:00:00Z"))).toEqual({
      desde: "2026-10-08",
      hasta: "2026-10-14",
    });
  });

  it("cruza el fin de mes sin inventar días", () => {
    expect(rangoDeLista(new Date("2026-11-02T12:00:00Z"))).toEqual({
      desde: "2026-10-27",
      hasta: "2026-11-02",
    });
  });

  it("son siete días de verdad", () => {
    const { desde, hasta } = rangoDeLista(new Date("2026-10-14T12:00:00Z"));
    const dias = (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000 + 1;
    expect(dias).toBe(DIAS_DE_LA_LISTA);
  });
});

describe("rangoQueIncluye", () => {
  const rango = { desde: "2026-10-08", hasta: "2026-10-14" };

  it("una fecha de adentro no mueve nada", () => {
    expect(rangoQueIncluye(rango, "2026-10-10")).toEqual(rango);
  });

  it("una fecha anterior corre el desde y deja el hasta", () => {
    expect(rangoQueIncluye(rango, "2026-09-30")).toEqual({ desde: "2026-09-30", hasta: "2026-10-14" });
  });

  it("una fecha posterior corre el hasta y deja el desde", () => {
    expect(rangoQueIncluye(rango, "2026-10-20")).toEqual({ desde: "2026-10-08", hasta: "2026-10-20" });
  });

  /** Los bordes son inclusivos: la consulta usa `gte` y `lte`. */
  it("los extremos ya están adentro", () => {
    expect(rangoQueIncluye(rango, "2026-10-08")).toEqual(rango);
    expect(rangoQueIncluye(rango, "2026-10-14")).toEqual(rango);
  });

  /** Un campo de fecha vacío no tiene que ensanchar el rango hasta la nada. */
  it("una fecha que no es una fecha deja el rango como estaba", () => {
    expect(rangoQueIncluye(rango, "")).toEqual(rango);
    expect(rangoQueIncluye(rango, "no es una fecha")).toEqual(rango);
  });
});
