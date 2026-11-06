import { describe, it, expect } from "vitest";
import {
  diaMesAnio, filasDelParte, paginasDelParte, pieDeHoja, FILAS_POR_HOJA,
  type ItemDelPlan,
} from "@/lib/mantenimiento/parteDiario";

function item(n: number, extra: Partial<ItemDelPlan> = {}): ItemDelPlan {
  return {
    id: `i-${n}`,
    ot_number: 2800 + n,
    sector_raw: "Calcinación",
    equipo_raw: "PO-B1-28 – Ventilador 6",
    descripcion: "Cambio de correas",
    repuesto: "3 correas B-86",
    orden: n,
    ...extra,
  };
}

describe("diaMesAnio", () => {
  it("parte la fecha sin construir un Date", () => {
    // Un `new Date("2026-10-19")` se interpreta en UTC y en Argentina se lee
    // como el 18 a las 21: la hoja saldría fechada el día anterior.
    expect(diaMesAnio("2026-10-19")).toEqual({ dia: "19", mes: "10", anio: "2026" });
    expect(diaMesAnio("2026-01-01")).toEqual({ dia: "01", mes: "01", anio: "2026" });
  });

  it("con una fecha que no sirve deja los casilleros vacíos", () => {
    // Vacíos y no "NaN": el casillero se completa a mano y eso ya es la hoja
    // de siempre, mientras que un "NaN" impreso no se puede ni tachar.
    for (const mala of ["", null, undefined, "19/10/2026", "2026-10"]) {
      expect(diaMesAnio(mala)).toEqual({ dia: "", mes: "", anio: "" });
    }
  });
});

describe("filasDelParte", () => {
  it("arma las cinco columnas del papel", () => {
    expect(filasDelParte([item(1)], new Set(["i-1"]))).toEqual([{
      id: "i-1",
      nroOt: "2801",
      sector: "Calcinación",
      equipo: "PO-B1-28 – Ventilador 6",
      trabajo: "Cambio de correas",
      repuestos: "3 correas B-86",
    }]);
  });

  it("deja afuera lo que no se eligió", () => {
    const filas = filasDelParte([item(1), item(2), item(3)], new Set(["i-1", "i-3"]));
    expect(filas.map((f) => f.nroOt)).toEqual(["2801", "2803"]);
  });

  it("respeta el orden del plan y no el de la selección", () => {
    // La hoja tiene que salir igual sin importar en qué orden se tildaron las
    // casillas: es el mismo orden en que se va a trabajar.
    const items = [item(3, { orden: 3 }), item(1, { orden: 1 }), item(2, { orden: 2 })];
    const filas = filasDelParte(items, new Set(["i-2", "i-3", "i-1"]));
    expect(filas.map((f) => f.nroOt)).toEqual(["2801", "2802", "2803"]);
  });

  it("un campo vacío queda vacío y no dice 'null'", () => {
    const filas = filasDelParte(
      [item(1, { ot_number: null, sector_raw: null, repuesto: "  " })],
      new Set(["i-1"])
    );
    expect(filas[0]).toMatchObject({ nroOt: "", sector: "", repuestos: "" });
  });

  it("sin nada elegido no devuelve ningún renglón", () => {
    expect(filasDelParte([item(1)], new Set())).toEqual([]);
  });
});

describe("paginasDelParte", () => {
  it("completa la última hoja con renglones vacíos, como el papel", () => {
    const hojas = paginasDelParte(filasDelParte([item(1), item(2)], new Set(["i-1", "i-2"])));
    expect(hojas).toHaveLength(1);
    expect(hojas[0]).toHaveLength(FILAS_POR_HOJA);
    expect(hojas[0][2]).toEqual({ id: "", nroOt: "", sector: "", equipo: "", trabajo: "", repuestos: "" });
  });

  it("corta en varias hojas cuando no entran", () => {
    const items = Array.from({ length: 11 }, (_, i) => item(i + 1));
    const hojas = paginasDelParte(filasDelParte(items, new Set(items.map((i) => i.id))));
    expect(hojas).toHaveLength(2);
    expect(hojas[0].filter((f) => f.id)).toHaveLength(8);
    expect(hojas[1].filter((f) => f.id)).toHaveLength(3);
    expect(hojas[1]).toHaveLength(FILAS_POR_HOJA);
  });

  it("sin filas devuelve una hoja vacía y no cero hojas", () => {
    // Quien entra a imprimir y todavía no tildó nada tiene que ver la grilla,
    // no una página en blanco que parece un error.
    const hojas = paginasDelParte([]);
    expect(hojas).toHaveLength(1);
    expect(hojas[0]).toHaveLength(FILAS_POR_HOJA);
    expect(hojas[0].every((f) => f.id === "")).toBe(true);
  });

  it("no se cuelga si le pasan cero renglones por hoja", () => {
    expect(paginasDelParte([], 0)[0]).toHaveLength(1);
    expect(paginasDelParte(filasDelParte([item(1)], new Set(["i-1"])), -5)).toHaveLength(1);
  });

  it("cada hoja es independiente: tocar una no toca la otra", () => {
    const items = Array.from({ length: 9 }, (_, i) => item(i + 1));
    const hojas = paginasDelParte(filasDelParte(items, new Set(items.map((i) => i.id))));
    hojas[0][0].trabajo = "pisado";
    expect(hojas[1][0].trabajo).not.toBe("pisado");
  });
});

describe("pieDeHoja", () => {
  it("numera sólo cuando hay más de una", () => {
    expect(pieDeHoja(1, 1)).toBeNull();
    expect(pieDeHoja(1, 3)).toBe("Hoja 1 de 3");
    expect(pieDeHoja(3, 3)).toBe("Hoja 3 de 3");
  });
});
