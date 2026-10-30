import { describe, it, expect } from "vitest";
import { DIAS_DE_VENTANA_DE_OT, filtroDeVentanaDeOt, otsParaEnlazar } from "./consultas";
import { mensajeDeDuplicada } from "./paradas";

type Fila = { id: string; ot_number: number; fecha: string | null; estado: string; equipo_raw: string | null; descripcion: string | null };
const ot = (n: number, fecha: string, estado = "REALIZADO"): Fila => ({
  id: `ot-${n}`, ot_number: n, fecha, estado, equipo_raw: null, descripcion: null,
});

/** Un cliente de mentira que anota lo que se le pide y contesta como la base: `.or` trae la ventana, `.in` trae por id. */
function clienteFalso(ventana: Fila[], todas: Fila[]) {
  const llamadas = { or: [] as string[], in: [] as string[][] };
  const admin = {
    from: () => {
      let ids: string[] | null = null;
      const b: Record<string, unknown> = {
        select: () => b,
        order: () => b,
        range: () => b,
        or: (f: string) => { llamadas.or.push(f); return b; },
        in: (_c: string, v: string[]) => { llamadas.in.push(v); ids = v; return b; },
        then: (ok: (r: unknown) => unknown) =>
          ok({ data: ids ? todas.filter((o) => ids!.includes(o.id)) : ventana, error: null }),
      };
      return b;
    },
  };
  return { admin: admin as never, llamadas };
}

describe("la ventana de OT que se ofrece para enlazar", () => {
  it("son 90 dias, y las abiertas entran sea cual sea su fecha", () => {
    expect(DIAS_DE_VENTANA_DE_OT).toBe(90);
    // 30/10 menos 90 dias es el 1/8.
    expect(filtroDeVentanaDeOt("2026-10-30")).toBe("fecha.gte.2026-08-01,estado.neq.REALIZADO");
  });

  it("el corte se mueve con los dias que se pidan", () => {
    expect(filtroDeVentanaDeOt("2026-10-30", 30)).toBe("fecha.gte.2026-09-30,estado.neq.REALIZADO");
  });

  it("otsParaEnlazar le pasa ese filtro a la base", async () => {
    const { admin, llamadas } = clienteFalso([ot(2929, "2026-10-29")], []);
    await otsParaEnlazar(admin, "2026-10-30");
    expect(llamadas.or).toEqual(["fecha.gte.2026-08-01,estado.neq.REALIZADO"]);
  });

  it("una OT ya enlazada que cae fuera de la ventana se agrega, y la lista sale de la mas nueva a la mas vieja", async () => {
    // Fecha vieja y numero en el medio: la lista no puede dejarla pegada al final.
    const vieja = ot(2910, "2026-02-10");
    const { admin, llamadas } = clienteFalso([ot(2929, "2026-10-29"), ot(2900, "2026-10-01")], [vieja]);
    const r = await otsParaEnlazar(admin, "2026-10-30", [vieja.id]);
    expect(r.map((o) => o.numero)).toEqual([2929, 2910, 2900]);
    expect(llamadas.in).toEqual([[vieja.id]]);
  });

  it("una enlazada que ya viene en la ventana no se pide dos veces ni se repite", async () => {
    const { admin, llamadas } = clienteFalso([ot(2929, "2026-10-29")], []);
    const r = await otsParaEnlazar(admin, "2026-10-30", ["ot-2929", "ot-2929"]);
    expect(r).toHaveLength(1);
    expect(llamadas.in).toEqual([]);
  });

  it("las enlazadas se piden de a lotes de 200", async () => {
    const todas = Array.from({ length: 450 }, (_, i) => ot(1000 + i, "2026-01-01"));
    const { admin, llamadas } = clienteFalso([], todas);
    const r = await otsParaEnlazar(admin, "2026-10-30", todas.map((o) => o.id));
    expect(r).toHaveLength(450);
    expect(llamadas.in.map((l) => l.length)).toEqual([200, 200, 50]);
  });
});

describe("el cartel de lo que ya esta cargado", () => {
  it("distingue el turno con motivo del dia con la planta parada", () => {
    expect(mensajeDeDuplicada("04_12")).toContain("Ese turno ya tiene un motivo");
    expect(mensajeDeDuplicada(null)).toContain("Ese día ya tiene marcada la planta parada");
    expect(mensajeDeDuplicada(null)).not.toContain("turno");
  });
});
