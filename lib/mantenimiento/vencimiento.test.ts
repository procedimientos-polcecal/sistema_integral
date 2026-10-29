import { describe, it, expect } from "vitest";
import { leToca, proximaFecha } from "./vencimiento";

const mensual = (next_date: string) => ({
  schedule_type: "MENSUAL", interval_days: null, next_date,
});

const HOY = "2026-10-29";

describe("leToca", () => {
  it("le toca si su fecha ya pasó", () => {
    expect(leToca(mensual("2026-10-28"), HOY)).toBe(true);
  });

  it("le toca el mismo día", () => {
    expect(leToca(mensual(HOY), HOY)).toBe(true);
  });

  it("no le toca si su fecha es futura", () => {
    expect(leToca(mensual("2026-10-30"), HOY)).toBe(false);
  });

  it("sin fecha no le toca nunca", () => {
    expect(leToca({ ...mensual(HOY), next_date: null }, HOY)).toBe(false);
  });
});

describe("proximaFecha", () => {
  /**
   * El caso real, y el que decidió el usuario: el único programado del sistema
   * venció el 8/8/2026 y es mensual, o sea que lleva tres ciclos perdidos.
   * Sumar 30 una vez deja la fecha nueva **también vencida**, y entonces la
   * corrida siguiente genera otra OT, y otra. Se saltea hasta la primera
   * futura: tres ciclos viejos serían tres números de la serie y tres filas en
   * el libro que mira la planta, por un trabajo que no se va a hacer tres
   * veces.
   */
  it("saltea los ciclos perdidos y cae en una fecha futura", () => {
    // 8/8 + 30 = 7/9, + 30 = 7/10, + 30 = 6/11. Tres saltos, no uno.
    const r = proximaFecha(mensual("2026-08-08"), HOY);
    expect(r).toBe("2026-11-06");
    expect(r! > HOY).toBe(true);
  });

  it("de uno al día, suma su intervalo una sola vez", () => {
    expect(proximaFecha(mensual(HOY), HOY)).toBe("2026-11-28");
  });

  it("cada tipo suma lo suyo", () => {
    const de = (t: string) => proximaFecha({ schedule_type: t, interval_days: null, next_date: HOY }, HOY);
    expect(de("DIARIO")).toBe("2026-10-30");
    expect(de("SEMANAL")).toBe("2026-11-05");
    expect(de("QUINCENAL")).toBe("2026-11-13");
    expect(de("TRIMESTRAL")).toBe("2027-01-27");
    expect(de("SEMESTRAL")).toBe("2027-04-27");
    expect(de("ANUAL")).toBe("2027-10-29");
  });

  /**
   * Los dos que no tienen próxima: una fecha fija no se repite, y un
   * personalizado sin intervalo no dice cada cuánto. Devuelven null y quien
   * llama cierra el programado, en vez de dejarlo generando para siempre.
   */
  it("una fecha fija no tiene próxima", () => {
    expect(proximaFecha({ schedule_type: "FECHA_FIJA", interval_days: null, next_date: HOY }, HOY)).toBeNull();
  });

  it("un personalizado sin intervalo tampoco", () => {
    expect(proximaFecha({ schedule_type: "PERSONALIZADO", interval_days: null, next_date: HOY }, HOY)).toBeNull();
  });

  it("un personalizado con intervalo lo usa, y también saltea lo perdido", () => {
    expect(proximaFecha({ schedule_type: "PERSONALIZADO", interval_days: 45, next_date: HOY }, HOY))
      .toBe("2026-12-13");
    const viejo = proximaFecha({ schedule_type: "PERSONALIZADO", interval_days: 45, next_date: "2026-01-01" }, HOY);
    expect(viejo! > HOY).toBe(true);
  });

  it("un tipo que no conoce no inventa una fecha", () => {
    expect(proximaFecha({ schedule_type: "LO_QUE_SEA", interval_days: null, next_date: HOY }, HOY)).toBeNull();
  });

  it("sin fecha de la que partir, no hay próxima", () => {
    expect(proximaFecha({ schedule_type: "MENSUAL", interval_days: null, next_date: null }, HOY)).toBeNull();
  });
});
