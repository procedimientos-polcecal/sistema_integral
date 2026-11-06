import { describe, it, expect } from "vitest";
import { queGenerar } from "./generarPeriodicas";
import type { MantenimientoParaLaOT } from "./otDesdeMantenimiento";

const HOY = "2026-10-29";

/** El único programado que existe, tal cual está en la base. */
const BASE = {
  id: "afe8aa63-05ac-4612-8163-cbcc8affe110",
  equipment_id: "03dc185f-6fa6-46c0-a249-b8b6dafb8ed9",
  maintenance_type: "Lubricacion",
  description: "Lubricación mensual de rodamientos",
  next_date: "2026-08-08",
  estimated_hours: null,
  equipos: {
    code: "PO-B1-27", name: "Rodamiento principal",
    sector_id: "sec-calcinacion", sectores: { nombre: "Calcinación" },
  },
  assigned_user: null,
  status: "active",
  schedule_type: "MENSUAL",
  interval_days: null,
} as MantenimientoParaLaOT & { status: string; schedule_type: string; interval_days: number | null };

const con = (p: Partial<typeof BASE>) => ({ ...BASE, ...p });

describe("qué programados hay que generar hoy", () => {
  it("el vencido entra", () => {
    const r = queGenerar([BASE], HOY);
    expect(r.generar).toHaveLength(1);
    expect(r.generar[0].id).toBe(BASE.id);
    expect(r.incompletos).toEqual([]);
  });

  it("uno con fecha futura no entra", () => {
    expect(queGenerar([con({ next_date: "2026-12-01" })], HOY).generar).toEqual([]);
  });

  it("uno que no está activo no entra, aunque esté vencido", () => {
    for (const status of ["paused", "cancelled", "completed"]) {
      expect(queGenerar([con({ status })], HOY).generar).toEqual([]);
    }
  });

  it("uno sin fecha no entra", () => {
    expect(queGenerar([con({ next_date: null })], HOY).generar).toEqual([]);
  });

  /**
   * El caso que hace que esto sea una función y no un `filter`: un programado
   * vencido al que le falta la especialidad **no se genera ni se saltea en
   * silencio**. Va a `incompletos` con qué le falta, para que la pantalla lo
   * pueda decir. Inventarle la especialidad sería el enlace por parecido que
   * `especialidadDeTipo` existe para no hacer.
   */
  it("un vencido sin especialidad no se genera: queda informado", () => {
    const r = queGenerar([con({ maintenance_type: "Inspeccion" })], HOY);
    expect(r.generar).toEqual([]);
    expect(r.incompletos).toEqual([
      { id: BASE.id, falta: ["la especialidad"] },
    ]);
  });

  it("el mismo, con su especialidad cargada, sí se genera", () => {
    const r = queGenerar(
      [con({ maintenance_type: "Inspeccion", especialidad: "ELÉCTRICO" })], HOY
    );
    expect(r.generar).toHaveLength(1);
    expect(r.incompletos).toEqual([]);
  });

  /** Uno que todavía no vence y está incompleto no molesta: no es de hoy. */
  it("un incompleto que no vence todavía no se informa", () => {
    const r = queGenerar(
      [con({ maintenance_type: "Inspeccion", next_date: "2026-12-01" })], HOY
    );
    expect(r.generar).toEqual([]);
    expect(r.incompletos).toEqual([]);
  });

  it("de varios, separa cada uno donde va", () => {
    const r = queGenerar([
      BASE,
      con({ id: "b", maintenance_type: "Limpieza" }),
      con({ id: "c", next_date: "2027-01-01" }),
    ], HOY);
    expect(r.generar.map((g) => g.id)).toEqual([BASE.id]);
    expect(r.incompletos.map((i) => i.id)).toEqual(["b"]);
  });
});
