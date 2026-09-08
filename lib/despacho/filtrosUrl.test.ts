import { describe, it, expect } from "vitest";
import {
  HISTORICO_SIN_FILTROS,
  escribirFiltrosDelHistorico,
  hayFiltrosDelHistorico,
  leerFiltrosDelHistorico,
} from "./filtrosUrl";

const EMPRESAS = ["POLCECAL", "POLYSAN"];
const leer = (query: string) => leerFiltrosDelHistorico(new URLSearchParams(query), EMPRESAS);

describe("leerFiltrosDelHistorico", () => {
  it("lee los seis filtros", () => {
    expect(
      leer("cliente=vecchio&material=Cal&envase=Tolva&empresa=POLYSAN&desde=2026-09-01&hasta=2026-09-08")
    ).toEqual({
      cliente: "vecchio",
      material: "Cal",
      envase: "Tolva",
      empresa: "POLYSAN",
      desde: "2026-09-01",
      hasta: "2026-09-08",
    });
  });

  it("una URL sin nada no filtra nada", () => {
    expect(leer("")).toEqual(HISTORICO_SIN_FILTROS);
    expect(hayFiltrosDelHistorico(leer(""))).toBe(false);
  });

  /**
   * Un valor que no está en la lista se descarta y no se pasa a la consulta:
   * pasado tal cual devolvería cero filas y parecería que no hay órdenes.
   */
  it("descarta los valores que no existen en vez de filtrar por ellos", () => {
    expect(leer("material=Titanio").material).toBe("");
    expect(leer("envase=Barril").envase).toBe("");
    expect(leer("empresa=OTRA").empresa).toBe("");
    expect(leer("desde=el+lunes").desde).toBe("");
  });

  it("recorta el cliente, que viene tipeado a mano", () => {
    expect(leer("cliente=%20%20vecchio%20%20").cliente).toBe("vecchio");
  });
});

describe("escribirFiltrosDelHistorico", () => {
  it("ida y vuelta: lo que se escribe se vuelve a leer igual", () => {
    const f = leer("cliente=vecchio&material=Filler&desde=2026-08-01");
    expect(leer(escribirFiltrosDelHistorico(f))).toEqual(f);
  });

  it("sin filtros no ensucia la URL", () => {
    expect(escribirFiltrosDelHistorico(HISTORICO_SIN_FILTROS)).toBe("");
  });
});
