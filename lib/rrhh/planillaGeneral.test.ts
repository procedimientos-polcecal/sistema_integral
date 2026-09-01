import { describe, it, expect } from "vitest";
import { dia, diasSuperpuestos, diasHabilesSuperpuestos, extrasSinValidar } from "./planillaGeneral";

// Julio 2026: el 1 cae miércoles. Domingos: 5, 12, 19, 26. Sábados: 4, 11, 18, 25.
const sinFeriados = new Set<number>();

describe("diasSuperpuestos", () => {
  it("período contenido entero en el rango: cuenta todos sus días", () => {
    expect(diasSuperpuestos(dia("2026-07-06"), dia("2026-07-10"), dia("2026-07-01"), dia("2026-07-31"))).toBe(5);
  });

  it("un solo día cuenta 1, no 0 (los extremos van incluidos)", () => {
    expect(diasSuperpuestos(dia("2026-07-06"), dia("2026-07-06"), dia("2026-07-01"), dia("2026-07-31"))).toBe(1);
  });

  it("período que arranca antes del rango: solo cuenta la parte de adentro", () => {
    // vacaciones del 25/06 al 03/07, liquidando julio -> 3 días (1, 2 y 3)
    expect(diasSuperpuestos(dia("2026-06-25"), dia("2026-07-03"), dia("2026-07-01"), dia("2026-07-31"))).toBe(3);
  });

  it("período que termina después del rango: solo cuenta la parte de adentro", () => {
    // vacaciones del 28/07 al 10/08, liquidando julio -> 4 días (28 al 31)
    expect(diasSuperpuestos(dia("2026-07-28"), dia("2026-08-10"), dia("2026-07-01"), dia("2026-07-31"))).toBe(4);
  });

  it("período que envuelve al rango entero: cuenta el rango completo", () => {
    expect(diasSuperpuestos(dia("2026-01-01"), dia("2026-12-31"), dia("2026-07-01"), dia("2026-07-15"))).toBe(15);
  });

  it("período fuera del rango: no cuenta nada", () => {
    expect(diasSuperpuestos(dia("2026-05-01"), dia("2026-05-10"), dia("2026-07-01"), dia("2026-07-31"))).toBe(0);
  });
});

describe("diasHabilesSuperpuestos (enfermedad: no suman domingos ni feriados)", () => {
  it("semana de lunes a viernes: los 5 días cuentan", () => {
    // lunes 06/07 a viernes 10/07
    expect(diasHabilesSuperpuestos(dia("2026-07-06"), dia("2026-07-10"), dia("2026-07-01"), dia("2026-07-31"), sinFeriados)).toBe(5);
  });

  it("el sábado sí cuenta, el domingo no", () => {
    // sábado 04/07 y domingo 05/07 -> solo el sábado
    expect(diasHabilesSuperpuestos(dia("2026-07-04"), dia("2026-07-05"), dia("2026-07-01"), dia("2026-07-31"), sinFeriados)).toBe(1);
  });

  it("licencia de una semana corrida descuenta el domingo del medio", () => {
    // lunes 06/07 a domingo 12/07 = 7 días calendario, 6 hábiles+sábado
    expect(diasHabilesSuperpuestos(dia("2026-07-06"), dia("2026-07-12"), dia("2026-07-01"), dia("2026-07-31"), sinFeriados)).toBe(6);
  });

  it("un feriado en el medio tampoco cuenta", () => {
    // 09/07 (jueves, Día de la Independencia) como feriado
    const feriados = new Set([dia("2026-07-09").getTime()]);
    expect(diasHabilesSuperpuestos(dia("2026-07-06"), dia("2026-07-10"), dia("2026-07-01"), dia("2026-07-31"), feriados)).toBe(4);
  });

  it("licencia larga: se recorta al rango liquidado y sigue salteando domingos", () => {
    // licencia de todo julio y agosto, liquidando la primera quincena de julio:
    // 1 al 15 = 15 días calendario, menos los domingos 5 y 12 -> 13
    expect(diasHabilesSuperpuestos(dia("2026-07-01"), dia("2026-08-31"), dia("2026-07-01"), dia("2026-07-15"), sinFeriados)).toBe(13);
  });

  it("licencia que cae toda en domingo no suma horas", () => {
    expect(diasHabilesSuperpuestos(dia("2026-07-05"), dia("2026-07-05"), dia("2026-07-01"), dia("2026-07-31"), sinFeriados)).toBe(0);
  });

  it("licencia fuera del rango liquidado no suma nada", () => {
    expect(diasHabilesSuperpuestos(dia("2026-05-04"), dia("2026-05-08"), dia("2026-07-01"), dia("2026-07-31"), sinFeriados)).toBe(0);
  });
});

/**
 * La planilla suma las extra solo de los dias validados. Mostrar 0 sin mas se
 * lee igual que "no hizo extras", asi que ademas hay que poder decir cuanto
 * quedo afuera.
 */
describe("extrasSinValidar", () => {
  const dia = (horas50: number, horas100: number, validadas: boolean) => ({
    empleado_id: "e1",
    horas_normales: 8,
    horas_extra_50: horas50,
    horas_extra_100: horas100,
    extras_validadas: validadas,
  });

  it("sin dias no hay nada pendiente", () => {
    expect(extrasSinValidar([])).toEqual({ dias: 0, horas50: 0, horas100: 0 });
  });

  it("un dia validado no queda pendiente por mas horas que tenga", () => {
    expect(extrasSinValidar([dia(8, 4, true)])).toEqual({ dias: 0, horas50: 0, horas100: 0 });
  });

  it("un dia sin validar con extras queda pendiente", () => {
    expect(extrasSinValidar([dia(4, 0, false)])).toEqual({ dias: 1, horas50: 4, horas100: 0 });
  });

  it("un dia sin validar y sin extras no cuenta como pendiente", () => {
    // Es el caso normal: casi todos los dias no tienen extras y nadie los valida.
    expect(extrasSinValidar([dia(0, 0, false)])).toEqual({ dias: 0, horas50: 0, horas100: 0 });
  });

  it("suma las dos clases de extra y cuenta el dia una sola vez", () => {
    expect(extrasSinValidar([dia(4, 8.5, false)])).toEqual({ dias: 1, horas50: 4, horas100: 8.5 });
  });

  it("mezcla de dias: solo suma los que faltan validar", () => {
    expect(
      extrasSinValidar([dia(8, 0, true), dia(4, 0, false), dia(0, 0, false), dia(0, 7.5, false)])
    ).toEqual({ dias: 2, horas50: 4, horas100: 7.5 });
  });
});
