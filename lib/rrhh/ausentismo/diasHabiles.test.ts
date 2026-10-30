import { it, expect } from "vitest";
import {
  habilesDelMes,
  habilesAcumulados,
  mesesSinFeriados,
  sabadosDelMes,
  anioSinFeriadosCargados,
} from "./diasHabiles";

// Los 17 feriados reales de 2026, tal como están en la tabla `feriados`.
const FERIADOS_2026 = [
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-03-24", "2026-04-02",
  "2026-04-03", "2026-05-01", "2026-05-25", "2026-06-15", "2026-06-20",
  "2026-07-09", "2026-08-17", "2026-10-12", "2026-10-28", "2026-11-20",
  "2026-12-08", "2026-12-25",
];

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

// Valores absolutos calculados aparte, no con las mismas funciones: si no, el
// test sólo repite la implementación.
it("cuenta los sábados del mes", () => {
  expect(sabadosDelMes("2026-01")).toBe(5);
  expect(sabadosDelMes("2026-02")).toBe(4);
});

it("el acumulado de enero da 22 y con su feriado 21", () => {
  expect(habilesAcumulados("2026-01", [])).toBe(22);
  expect(habilesAcumulados("2026-01", ["2026-01-01"])).toBe(21);
});

it("el acumulado con los feriados reales de 2026 da 204 a octubre y 245 al año entero", () => {
  expect(habilesAcumulados("2026-10", FERIADOS_2026)).toBe(204);
  expect(habilesAcumulados("2026-12", FERIADOS_2026)).toBe(245);
});

// 2028 es bisiesto: febrero tiene 29 días, 4 sábados y 4 domingos, así que 21.
it("febrero de un año bisiesto tiene 21 hábiles sin feriados", () => {
  expect(habilesDelMes("2028-02", [])).toBe(21);
});

// Septiembre de 2026 no tiene feriado nacional: `mesesSinFeriados` lo lista
// igual, y por eso la alerta del año no puede ser esa lista.
it("con los feriados reales de 2026, septiembre es el único mes sin feriado", () => {
  expect(mesesSinFeriados(2026, FERIADOS_2026)).toEqual(["2026-09"]);
});

it("un año con feriados cargados no está sin cargar", () => {
  expect(anioSinFeriadosCargados(2026, FERIADOS_2026)).toBe(false);
});

it("sin ningún feriado cargado, el año está sin cargar", () => {
  expect(anioSinFeriadosCargados(2026, [])).toBe(true);
});

it("con sólo feriados de 2026, el año 2027 está sin cargar", () => {
  expect(anioSinFeriadosCargados(2027, FERIADOS_2026)).toBe(true);
});
