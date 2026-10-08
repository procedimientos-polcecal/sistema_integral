import { describe, it, expect } from "vitest";
import { problemaDelRango, ventanaDelCron, DIAS_MAX_RANGO, DIAS_DEL_CRON } from "./rango";
import { ventanasDe, DIAS_MAX_POR_PEDIDO } from "./cliente";
import { toUtcDateOnly } from "../dates";

const dia = (y: number, m: number, d: number) => toUtcDateOnly(y, m - 1, d);
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("ventanaDelCron", () => {
  it("son 7 días contando hoy", () => {
    const { desde, hasta } = ventanaDelCron(dia(2026, 10, 8));
    expect(iso(desde)).toBe("2026-10-02");
    expect(iso(hasta)).toBe("2026-10-08");
  });

  it("cruza el fin de mes sin perder días", () => {
    const { desde } = ventanaDelCron(dia(2026, 11, 3));
    expect(iso(desde)).toBe("2026-10-28");
  });

  // Lo que sostiene el comentario del cron ("una sola llamada"): si alguien
  // sube los días sin subir el tope, el cron pasaría a gastar dos llamadas por
  // día y nada lo avisaría.
  it("entra en una sola ventana de pedido a la API", () => {
    expect(DIAS_DEL_CRON).toBeLessThanOrEqual(DIAS_MAX_POR_PEDIDO);
    const { desde, hasta } = ventanaDelCron(dia(2026, 10, 8));
    expect(ventanasDe(desde, hasta)).toHaveLength(1);
  });
});

describe("problemaDelRango", () => {
  it("un rango bien armado no tiene problema", () => {
    expect(problemaDelRango(dia(2026, 10, 1), dia(2026, 10, 7))).toBeNull();
  });

  it("un solo día es válido", () => {
    expect(problemaDelRango(dia(2026, 10, 1), dia(2026, 10, 1))).toBeNull();
  });

  it("rechaza un fin anterior al inicio", () => {
    expect(problemaDelRango(dia(2026, 10, 7), dia(2026, 10, 1))).toMatch(/anterior/);
  });

  it("el tope se cuenta en días inclusive: DIAS_MAX_RANGO pasa y uno más no", () => {
    const desde = dia(2026, 8, 1);
    const hastaTope = new Date(desde.getTime() + (DIAS_MAX_RANGO - 1) * 86_400_000);
    const hastaUnoMas = new Date(desde.getTime() + DIAS_MAX_RANGO * 86_400_000);
    expect(problemaDelRango(desde, hastaTope)).toBeNull();
    expect(problemaDelRango(desde, hastaUnoMas)).toMatch(new RegExp(`${DIAS_MAX_RANGO} días`));
  });

  it("el mensaje dice cuántos días se pidieron", () => {
    expect(problemaDelRango(dia(2026, 1, 1), dia(2026, 12, 31))).toMatch(/pediste 365/);
  });
});
