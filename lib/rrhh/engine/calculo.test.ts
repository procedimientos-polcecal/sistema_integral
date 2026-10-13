import { describe, it, expect } from "vitest";
import { calcularDia, mismasHoras, type PayrollConfigLike } from "./calculo";

const config: PayrollConfigLike = {
  horasNormalesPorDia: 8,
  horaCorteSabado: "12:00",
  feriadoComoDomingo: true,
};

// Hora de pared en Argentina (UTC-3 fijo), sin depender del huso horario de
// la máquina que corre los tests — misma convención que `localDateTime`.
function d(y: number, m: number, day: number, h: number, min = 0) {
  return new Date(Date.UTC(y, m - 1, day, h + 3, min, 0, 0));
}

describe("calcularDia", () => {
  it("día hábil con 10 horas: 8 normales + 2 extra 50%", () => {
    // 2026-07-06 es lunes
    const fecha = d(2026, 7, 6, 0, 0);
    const r = calcularDia(fecha, [{ start: d(2026, 7, 6, 8), end: d(2026, 7, 6, 18) }], false, config);
    expect(r.tipoDia).toBe("HABIL");
    expect(r.horasNormales).toBe(8);
    expect(r.horasExtra50).toBe(2);
    expect(r.horasExtra100).toBe(0);
    expect(r.francoGenerado).toBe(false);
  });

  it("día hábil con exactamente 8 horas: sin extra", () => {
    const fecha = d(2026, 7, 6, 0, 0);
    const r = calcularDia(fecha, [{ start: d(2026, 7, 6, 8), end: d(2026, 7, 6, 16) }], false, config);
    expect(r.horasNormales).toBe(8);
    expect(r.horasExtra50).toBe(0);
  });

  it("sábado que cruza el mediodía: normales + extra50 antes de las 12, extra100 después", () => {
    // 2026-07-11 es sábado. Entrada 02:00, salida 13:00 -> 10h antes de las 12, 1h después
    const fecha = d(2026, 7, 11, 0, 0);
    const r = calcularDia(fecha, [{ start: d(2026, 7, 11, 2), end: d(2026, 7, 11, 13) }], false, config);
    expect(r.tipoDia).toBe("SABADO");
    expect(r.horasNormales).toBe(8);
    expect(r.horasExtra50).toBe(2);
    expect(r.horasExtra100).toBe(1);
    expect(r.francoGenerado).toBe(false);
  });

  it("sábado con jornada corta antes del mediodía: solo normales", () => {
    const fecha = d(2026, 7, 11, 0, 0);
    const r = calcularDia(fecha, [{ start: d(2026, 7, 11, 7), end: d(2026, 7, 11, 12) }], false, config);
    expect(r.horasNormales).toBe(5);
    expect(r.horasExtra50).toBe(0);
    expect(r.horasExtra100).toBe(0);
  });

  it("sábado con trabajo solo después del mediodía: todo extra100", () => {
    const fecha = d(2026, 7, 11, 0, 0);
    const r = calcularDia(fecha, [{ start: d(2026, 7, 11, 13), end: d(2026, 7, 11, 17) }], false, config);
    expect(r.horasNormales).toBe(0);
    expect(r.horasExtra50).toBe(0);
    expect(r.horasExtra100).toBe(4);
  });

  it("domingo trabajado: todo extra100 y genera franco compensatorio", () => {
    // 2026-07-12 es domingo
    const fecha = d(2026, 7, 12, 0, 0);
    const r = calcularDia(fecha, [{ start: d(2026, 7, 12, 8), end: d(2026, 7, 12, 16) }], false, config);
    expect(r.tipoDia).toBe("DOMINGO");
    expect(r.horasNormales).toBe(0);
    expect(r.horasExtra50).toBe(0);
    expect(r.horasExtra100).toBe(8);
    expect(r.francoGenerado).toBe(true);
  });

  it("domingo sin fichadas: no genera franco", () => {
    const fecha = d(2026, 7, 12, 0, 0);
    const r = calcularDia(fecha, [], false, config);
    expect(r.francoGenerado).toBe(false);
    expect(r.horasExtra100).toBe(0);
  });

  it("feriado con feriadoComoDomingo=true: se comporta como domingo", () => {
    // 2026-07-09 es feriado (día de la independencia) y jueves
    const fecha = d(2026, 7, 9, 0, 0);
    const r = calcularDia(fecha, [{ start: d(2026, 7, 9, 8), end: d(2026, 7, 9, 16) }], true, config);
    expect(r.tipoDia).toBe("FERIADO");
    expect(r.horasExtra100).toBe(8);
    expect(r.francoGenerado).toBe(true);
  });

  it("feriado con feriadoComoDomingo=false: se comporta como día hábil (50% desde la 9na hora)", () => {
    const fecha = d(2026, 7, 9, 0, 0);
    const configSinFranco: PayrollConfigLike = { ...config, feriadoComoDomingo: false };
    const r = calcularDia(fecha, [{ start: d(2026, 7, 9, 8), end: d(2026, 7, 9, 18) }], true, configSinFranco);
    expect(r.horasNormales).toBe(8);
    expect(r.horasExtra50).toBe(2);
    expect(r.horasExtra100).toBe(0);
    expect(r.francoGenerado).toBe(false);
  });

  it("horas fraccionarias no se tocan (el redondeo ahora se aplica antes, según el turno detectado)", () => {
    const fecha = d(2026, 7, 6, 0, 0);
    const r = calcularDia(fecha, [{ start: d(2026, 7, 6, 8), end: d(2026, 7, 6, 15, 54) }], false, config);
    expect(r.horasNormales).toBeCloseTo(7.9, 5);
  });

  it("múltiples intervalos el mismo día (entrada/salida por almuerzo) se suman", () => {
    const fecha = d(2026, 7, 6, 0, 0);
    const r = calcularDia(
      fecha,
      [
        { start: d(2026, 7, 6, 8), end: d(2026, 7, 6, 12) },
        { start: d(2026, 7, 6, 13), end: d(2026, 7, 6, 19) },
      ],
      false,
      config
    );
    // 4h + 6h = 10h -> 8 normales + 2 extra50
    expect(r.horasNormales).toBe(8);
    expect(r.horasExtra50).toBe(2);
  });
});

/**
 * Las horas salen de dividir milisegundos y se guardan en numeric(5,2). Lo que
 * vuelve de la base no es el mismo float que salio del motor, y hay que poder
 * reconocer que son el mismo dato.
 */
describe("mismasHoras", () => {
  it("un numero identico es el mismo", () => {
    expect(mismasHoras(8, 8)).toBe(true);
  });

  it("0.08 guardado y 0.08333... calculado son las mismas horas", () => {
    // 8h05 de jornada: 0.08333... de extra, que la base guarda como 0.08.
    expect(mismasHoras(0.08, 5 / 60)).toBe(true);
  });

  it("0.38 guardado y 0.38333... calculado tambien", () => {
    expect(mismasHoras(0.38, 23 / 60)).toBe(true);
  });

  it("un minuto de diferencia ya es otra cantidad de horas", () => {
    expect(mismasHoras(0.08, 6 / 60)).toBe(false);
  });

  it("dos horas contra cinco minutos no son lo mismo", () => {
    expect(mismasHoras(2, 5 / 60)).toBe(false);
  });

  it("el limite son 18 segundos: menos es lo mismo, mas no", () => {
    expect(mismasHoras(1, 1.004)).toBe(true);
    expect(mismasHoras(1, 1.006)).toBe(false);
  });
});
