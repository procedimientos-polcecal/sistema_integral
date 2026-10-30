import { it, expect } from "vitest";
import { habilesDelMes, habilesAcumulados, mesesSinFeriados } from "./diasHabiles";

it("cuenta lunes a viernes del mes", () => {
  // Enero 2026: 31 dias, 22 habiles si no hubiera feriados
  expect(habilesDelMes("2026-01", [])).toBe(22);
});

it("descuenta un feriado que cae en dia habil y no uno que cae en domingo", () => {
  expect(habilesDelMes("2026-01", ["2026-01-01"])).toBe(21);  // jueves
  expect(habilesDelMes("2026-01", ["2026-01-04"])).toBe(22);  // domingo
});

it("acumula desde enero hasta el mes pedido", () => {
  expect(habilesAcumulados("2026-02", [])).toBe(habilesDelMes("2026-01", []) + habilesDelMes("2026-02", []));
});

// feriados tiene 17 filas, todas de 2026: en 2027 los habiles saldrian de mas
it("dice que meses del anio no tienen feriados cargados", () => {
  expect(mesesSinFeriados(2027, ["2026-01-01"])).toHaveLength(12);
  expect(mesesSinFeriados(2026, ["2026-01-01"])).not.toContain("2026-01");
});
