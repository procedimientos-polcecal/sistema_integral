import { describe, expect, it } from "vitest";
import {
  comoReferencia,
  laQueRige,
  turnoDeLaPersona,
  type FilaDeReferencia,
} from "./referenciaDelTaller";

const fila = (lunes: string, grupo = "A"): FilaDeReferencia => ({
  lunes,
  grupo_en_4a12: grupo,
  electricista_4a12_id: "e1",
  electricista_8a16_id: "e2",
  electricista_12a20_id: "e3",
});

describe("laQueRige", () => {
  const filas = [fila("2026-09-07", "A"), fila("2026-10-19", "B"), fila("2026-11-30", "A")];

  it("rige la más nueva que NO sea posterior a la semana pedida", () => {
    // Anclar de nuevo no puede reescribir lo que el encargado ya vio: la del
    // 30/11 existe, pero para el 09/11 manda la del 19/10.
    expect(laQueRige(filas, "2026-11-09")?.lunes).toBe("2026-10-19");
  });

  it("la de esa misma semana cuenta como que rige", () => {
    expect(laQueRige(filas, "2026-10-19")?.lunes).toBe("2026-10-19");
  });

  it("antes de la primera ancla se extrapola hacia atrás con la más vieja", () => {
    expect(laQueRige(filas, "2026-08-03")?.lunes).toBe("2026-09-07");
  });

  it("sin ninguna fila no hay ciclo, y eso es el estado real de hoy", () => {
    expect(laQueRige([], "2026-11-09")).toBeNull();
  });

  it("no depende del orden en que vengan las filas", () => {
    const alReves = [...filas].reverse();
    expect(laQueRige(alReves, "2026-11-09")?.lunes).toBe("2026-10-19");
  });

  it("una fecha con hora pegada se compara igual", () => {
    // Las columnas son `date` y hoy PostgREST las devuelve sin hora, pero el
    // corte cuesta nada y lo que hay del otro lado deja de depender de eso.
    const conHora = [{ ...fila("2026-10-19"), lunes: "2026-10-19T00:00:00" }];
    expect(laQueRige(conHora, "2026-11-09")?.lunes).toBe("2026-10-19T00:00:00");
  });
});

describe("turnoDeLaPersona", () => {
  const ref = comoReferencia(fila("2026-11-09", "A"));

  it("el electricista de la referencia arranca en su turno", () => {
    expect(turnoDeLaPersona(ref, "2026-11-09", { empleadoId: "e2", oficio: "electricista", grupo: null })).toBe("8-16");
  });

  it("un electricista que no es ninguno de los tres queda sin turno", () => {
    expect(turnoDeLaPersona(ref, "2026-11-09", { empleadoId: "otro", oficio: "electricista", grupo: null })).toBeNull();
  });

  it("el grupo A arranca en 4-12 esa semana, y el B en 12-20", () => {
    expect(turnoDeLaPersona(ref, "2026-11-09", { empleadoId: "m1", oficio: "mecanico", grupo: "A" })).toBe("4-12");
    expect(turnoDeLaPersona(ref, "2026-11-09", { empleadoId: "m2", oficio: "mecanico", grupo: "B" })).toBe("12-20");
  });

  it("a la semana siguiente los grupos se cambiaron", () => {
    expect(turnoDeLaPersona(ref, "2026-11-16", { empleadoId: "m1", oficio: "mecanico", grupo: "A" })).toBe("12-20");
  });

  it("un mecánico sin grupo queda sin turno en vez de caer en uno cualquiera", () => {
    expect(turnoDeLaPersona(ref, "2026-11-09", { empleadoId: "m3", oficio: "mecanico", grupo: null })).toBeNull();
  });

  it("el lubricador rota con su grupo, igual que un mecánico", () => {
    expect(turnoDeLaPersona(ref, "2026-11-09", { empleadoId: "l1", oficio: "lubricador", grupo: "B" })).toBe("12-20");
  });
});
