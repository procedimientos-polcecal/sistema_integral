import { it, expect } from "vitest";
import { diasEnElMes, diasDelAnual, mesDeImputacion, type Ausencia } from "./diasDeAusencia";

const a = (desde: string, hasta: string, tipo = "VACACIONES"): Ausencia =>
  ({ empleado_id: "e1", fecha_desde: desde, fecha_hasta: hasta, tipo });

it("el mensual cuenta inclusive", () => {
  expect(diasEnElMes(a("2026-01-05", "2026-01-12"), "2026-01")).toBe(8);
});

it("el anual cuenta exclusive, sin el mas uno", () => {
  expect(diasDelAnual(a("2026-01-05", "2026-01-12"))).toBe(7);
});

// Son 97 de las 147 ausencias de la base: un mas uno de mas acá duplica el anual
it("una ausencia de un solo dia vale cero en el anual y uno en el mensual", () => {
  expect(diasDelAnual(a("2026-03-10", "2026-03-10"))).toBe(0);
  expect(diasEnElMes(a("2026-03-10", "2026-03-10"), "2026-03")).toBe(1);
});

// 49 de las 207 novedades cruzan un fin de mes
it("el mensual prorratea entre los meses y el anual no", () => {
  const cruza = a("2025-12-19", "2026-01-02");
  expect(diasEnElMes(cruza, "2025-12")).toBe(13);
  expect(diasEnElMes(cruza, "2026-01")).toBe(2);
  expect(mesDeImputacion(cruza)).toBe("2025-12");
  expect(diasDelAnual(cruza)).toBe(14);
});

it("un mes que la ausencia no toca da cero", () => {
  expect(diasEnElMes(a("2026-01-05", "2026-01-12"), "2026-02")).toBe(0);
});

it("cuenta dias de calendario, fines de semana incluidos", () => {
  // 2026-03-07 es sabado y 2026-03-08 domingo
  expect(diasEnElMes(a("2026-03-06", "2026-03-09"), "2026-03")).toBe(4);
});
