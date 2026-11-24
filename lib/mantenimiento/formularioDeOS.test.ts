import { describe, expect, it } from "vitest";
import {
  celdasDelAltaDeOS, columnaDeEquipo, COLUMNA_DE_EQUIPO_POR_SECTOR,
  HOJA_DE_ALTAS_OS, HOJA_DE_RESPUESTAS_OS, loQueSigueEnLaSerieDeOS,
  type DatosDelAltaDeOS,
} from "./formularioDeOS";
import { serialDelDia, serialDelInstante } from "@/lib/core/fechaDeSheets";

const base: DatosDelAltaDeOS = {
  fecha: new Date("2026-11-19T15:30:00Z"),
  area: "Producción",
  sector: "Planta filler 2",
  equipo: "PY-B2-01 – Molino",
  descripcion: "Cambiar rodamientos",
  fechaRequerimiento: "2026-12-01",
  detalleExtra: "Urgente",
};

type R = ReturnType<typeof celdasDelAltaDeOS>;
const celda = (r: R, columna: number) => {
  if (!r.ok) throw new Error(r.error);
  return r.celdas.find((c) => c.columna === columna);
};

describe("las pestañas", () => {
  it("llevan el nombre que tienen en el libro de respuestas", () => {
    expect(HOJA_DE_RESPUESTAS_OS).toBe("Respuestas de formulario 1");
    expect(HOJA_DE_ALTAS_OS).toBe("Altas del sistema");
  });
});

describe("columnaDeEquipo", () => {
  it("manda cada sector a su columna", () => {
    expect(columnaDeEquipo("Planta filler 2")).toEqual({ ok: true, columna: 14 }); // O
    expect(columnaDeEquipo("Despacho")).toEqual({ ok: true, columna: 16 });        // Q
  });
  it("ignora acentos y mayusculas, como el resto del modulo", () => {
    expect(columnaDeEquipo("PLANTA DE TRITURACION 3")).toEqual({ ok: true, columna: 9 }); // J
    expect(columnaDeEquipo("Calcinación")).toEqual(columnaDeEquipo("calcinacion"));
  });
  it("se niega con el nombre del sector cuando no tiene columna", () => {
    const r = columnaDeEquipo("Sector nuevo");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("Sector nuevo");
  });
  it("sólo apunta a G..T", () => {
    for (const letra of Object.values(COLUMNA_DE_EQUIPO_POR_SECTOR)) {
      expect(letra).toMatch(/^[G-T]$/);
    }
  });
});

describe("celdasDelAltaDeOS", () => {
  it("escribe la fecha como serial y el numero como numero", () => {
    const r = celdasDelAltaDeOS(base, 281);
    expect(celda(r, 0)?.valor).toBe(281);
    expect(celda(r, 1)?.valor).toBe(serialDelInstante(base.fecha));
    expect(typeof celda(r, 1)?.valor).toBe("number");
  });
  it("escribe area, sector, descripcion, para cuando y detalles", () => {
    const r = celdasDelAltaDeOS(base, 281);
    expect(celda(r, 4)?.valor).toBe("Producción");
    expect(celda(r, 5)?.valor).toBe("Planta filler 2");
    expect(celda(r, 20)?.valor).toBe("Cambiar rodamientos");
    expect(celda(r, 21)?.valor).toBe(serialDelDia("2026-12-01"));
    expect(celda(r, 22)?.valor).toBe("Urgente");
  });
  it("pone el equipo en la columna del sector y en ninguna otra", () => {
    const r = celdasDelAltaDeOS(base, 281);
    if (!r.ok) throw new Error(r.error);
    const enEquipos = r.celdas.filter((c) => c.columna >= 6 && c.columna <= 19);
    expect(enEquipos).toEqual([{ columna: 14, valor: "PY-B2-01 – Molino" }]);
  });
  it("no escribe nunca la columna Y, que son correos", () => {
    const r = celdasDelAltaDeOS(base, 281);
    if (!r.ok) throw new Error(r.error);
    expect(r.celdas.some((c) => c.columna === 24)).toBe(false);
  });
  it("omite lo opcional que no vino", () => {
    const r = celdasDelAltaDeOS({ ...base, fechaRequerimiento: null, detalleExtra: null }, 281);
    expect(celda(r, 21)).toBeUndefined();
    expect(celda(r, 22)).toBeUndefined();
  });
  it("protege una descripcion que arranca con =", () => {
    const r = celdasDelAltaDeOS({ ...base, descripcion: "=IMPORTRANGE(…)" }, 281);
    expect(celda(r, 20)?.valor).toBe("'=IMPORTRANGE(…)");
  });
  it("se niega si el sector no tiene columna, sin escribir nada", () => {
    const r = celdasDelAltaDeOS({ ...base, sector: "Sector nuevo" }, 281);
    expect(r.ok).toBe(false);
  });
  it.each(["", "   "])("se niega con el equipo vacio (%j): cero valores en G..T desalinea", (equipo) => {
    const r = celdasDelAltaDeOS({ ...base, equipo }, 281);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("equipo");
  });
  it.each(["", "   "])("se niega con el sector vacio (%j)", (sector) => {
    expect(celdasDelAltaDeOS({ ...base, sector }, 281).ok).toBe(false);
  });
  it.each(["area", "descripcion"] as const)("se niega con %s vacia", (campo) => {
    expect(celdasDelAltaDeOS({ ...base, [campo]: "  " }, 281).ok).toBe(false);
  });
  it("se niega si la fecha no es valida", () => {
    expect(celdasDelAltaDeOS({ ...base, fecha: new Date("x") }, 281).ok).toBe(false);
  });
  it("se niega si la fecha pedida no existe", () => {
    expect(celdasDelAltaDeOS({ ...base, fechaRequerimiento: "2026-02-31" }, 281).ok).toBe(false);
  });
});

describe("loQueSigueEnLaSerieDeOS", () => {
  it("toma el maximo de las dos pestanas mas uno", () => {
    const form = [["ID SERVICIO"], [279], [280]];
    const r = loQueSigueEnLaSerieDeOS(form, [[]]);
    expect(r).toEqual({ ok: true, os_number: 281, fila: 2 });
  });
  it("cuenta las altas del sistema tambien", () => {
    const r = loQueSigueEnLaSerieDeOS([[280]], [["ID"], [281], [282]]);
    expect(r).toMatchObject({ ok: true, os_number: 283, fila: 4 });
  });
  it("se niega mientras la columna A siga siendo una formula", () => {
    const r = loQueSigueEnLaSerieDeOS([["=IF(B:B<>\"\";A282+1;\"\")"]], [[]]);
    expect(r.ok).toBe(false);
  });
});
