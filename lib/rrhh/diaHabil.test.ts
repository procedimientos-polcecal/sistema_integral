import { describe, expect, it } from "vitest";
import { ultimoDiaHabilConFichadas } from "./diaHabil";

/*
 * El caso real del 06/10/2026, que es el que motivó la función.
 *
 * Las fichadas se cortaron el 30/09 y desde el 01/10 `calculos_diarios` marca
 * 64, 65, 50 y 66 de 68 empleados como ausentes. Sin retroceder hasta el último
 * día con fichadas, la tarjeta diría 66, que es ruido del feed y no un dato de
 * RRHH.
 */
describe("ultimoDiaHabilConFichadas", () => {
  const FERIADOS_2026 = ["2026-01-01", "2026-07-09", "2026-08-17", "2026-12-25"];

  it("retrocede hasta el último día con fichadas, salteando los que no tienen", () => {
    const conFichadas = ["2026-09-28", "2026-09-29", "2026-09-30"];
    expect(ultimoDiaHabilConFichadas(conFichadas, FERIADOS_2026, "2026-10-06")).toBe("2026-09-30");
  });

  it("toma ayer cuando ayer tiene fichadas", () => {
    const conFichadas = ["2026-09-29", "2026-09-30", "2026-10-05"];
    expect(ultimoDiaHabilConFichadas(conFichadas, FERIADOS_2026, "2026-10-06")).toBe("2026-10-05");
  });

  // Los 36 domingos que ya pasaron en 2026 tienen exactamente 0 ausentes de 68. Un lunes,
  // "ayer" diría 0 y no informaría nada. Pero los domingos sí tienen fichadas
  // —entre 4 y 20— así que no alcanza con pedir que el día tenga fichadas.
  it("saltea el domingo aunque tenga fichadas", () => {
    // 2026-10-04 es domingo, 2026-10-03 sábado.
    const conFichadas = ["2026-10-03", "2026-10-04"];
    expect(ultimoDiaHabilConFichadas(conFichadas, FERIADOS_2026, "2026-10-05")).toBe("2026-10-03");
  });

  // El sábado se trabaja: entre 3 y 9 ausentes todos los sábados. "Día hábil"
  // acá es *no domingo y no feriado*, no la semana de lunes a viernes.
  it("no saltea el sábado", () => {
    const conFichadas = ["2026-10-02", "2026-10-03"];
    expect(ultimoDiaHabilConFichadas(conFichadas, FERIADOS_2026, "2026-10-04")).toBe("2026-10-03");
  });

  // De los 11 feriados de 2026 con datos, 9 tienen 0 ausentes: igual que un
  // domingo.
  it("saltea un feriado aunque tenga fichadas", () => {
    // 2026-08-17 es feriado (lunes); 2026-08-15 sábado.
    const conFichadas = ["2026-08-15", "2026-08-17"];
    expect(ultimoDiaHabilConFichadas(conFichadas, FERIADOS_2026, "2026-08-18")).toBe("2026-08-15");
  });

  it("nunca devuelve hoy, aunque hoy tenga fichadas", () => {
    const conFichadas = ["2026-09-30", "2026-10-06"];
    expect(ultimoDiaHabilConFichadas(conFichadas, FERIADOS_2026, "2026-10-06")).toBe("2026-09-30");
  });

  // Un caller que se olvide del `.lt("fecha", hoy)` no tiene que poder colar un
  // día que todavía no empezó.
  it("nunca devuelve una fecha posterior a hoy", () => {
    const conFichadas = ["2026-09-30", "2026-10-07", "2026-10-08"];
    expect(ultimoDiaHabilConFichadas(conFichadas, FERIADOS_2026, "2026-10-06")).toBe("2026-09-30");
  });

  it("devuelve null cuando no hay ningún día que sirva", () => {
    expect(ultimoDiaHabilConFichadas([], FERIADOS_2026, "2026-10-06")).toBeNull();
    // 2026-10-04 es domingo y es lo único que hay.
    expect(ultimoDiaHabilConFichadas(["2026-10-04"], FERIADOS_2026, "2026-10-05")).toBeNull();
  });

  it("no se marea con fechas repetidas ni desordenadas", () => {
    const conFichadas = ["2026-09-28", "2026-09-30", "2026-09-28", "2026-09-29", "2026-09-30"];
    expect(ultimoDiaHabilConFichadas(conFichadas, FERIADOS_2026, "2026-10-06")).toBe("2026-09-30");
  });
});
