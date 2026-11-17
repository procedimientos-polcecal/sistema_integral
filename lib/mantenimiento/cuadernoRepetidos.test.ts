import { describe, expect, it } from "vitest";
import { diasRepetidos, type RenglonPrevio } from "./cuadernoRepetidos";

const previo = (o: Partial<RenglonPrevio> & { id: string }): RenglonPrevio => ({
  cuaderno_id: "c1", foto_id: "f-viejo", fecha: "2026-09-21", tarea: "Tranqueras D6",
  orden_trabajo_id: null, grupo_id: null, ...o,
});

describe("diasRepetidos", () => {
  it("un día que ya tenía renglones se avisa, con cuántos eran", () => {
    const r = diasRepetidos(
      ["2026-09-21", "2026-09-22"],
      [previo({ id: "a" }), previo({ id: "b", tarea: "Limpieza" })],
      new Set(["f-nuevo"]), "c1"
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ fecha: "2026-09-21", cantidad: 2, se_puede_reemplazar: true, motivo: null });
    expect(r[0].renglon_ids).toEqual(["a", "b"]);
  });

  it("un día sin renglones previos no se avisa", () => {
    expect(diasRepetidos(["2026-09-22"], [previo({ id: "a" })], new Set(), "c1")).toEqual([]);
  });

  it("los renglones de las fotos recién leídas no son previos de sí mismos", () => {
    // Un día que cruza el borde de una hoja: dos renglones de la misma sesión.
    const r = diasRepetidos(
      ["2026-09-21"],
      [previo({ id: "a", foto_id: "f-nuevo" }), previo({ id: "b", foto_id: "f-nuevo-2" })],
      new Set(["f-nuevo", "f-nuevo-2"]), "c1"
    );
    expect(r).toEqual([]);
  });

  it("se niega a reemplazar si alguno ya generó su OT, y dice por qué", () => {
    const r = diasRepetidos(
      ["2026-09-21"],
      [previo({ id: "a" }), previo({ id: "b", orden_trabajo_id: "ot-1" })],
      new Set(), "c1"
    );
    expect(r[0].se_puede_reemplazar).toBe(false);
    expect(r[0].con_ot).toBe(1);
    expect(r[0].motivo).toContain("ya generó su orden de trabajo");
  });

  it("un renglón de un grupo que tiene OT también bloquea, aunque él no la tenga", () => {
    const r = diasRepetidos(
      ["2026-09-21"],
      [previo({ id: "a", grupo_id: "g1" })],
      new Set(), "c1",
      [{ grupo_id: "g1", orden_trabajo_id: "ot-9" }]
    );
    expect(r[0].se_puede_reemplazar).toBe(false);
  });

  it("cuenta cuántos vienen de otra carga", () => {
    const r = diasRepetidos(
      ["2026-09-21"],
      [previo({ id: "a", cuaderno_id: "c0" }), previo({ id: "b" })],
      new Set(), "c1"
    );
    expect(r[0].de_otras_cargas).toBe(1);
  });

  it("ignora los renglones previos sin fecha y las fechas nulas de las nuevas", () => {
    expect(diasRepetidos([null], [previo({ id: "a", fecha: null })], new Set(), "c1")).toEqual([]);
  });
});
