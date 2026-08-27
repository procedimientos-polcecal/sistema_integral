import { describe, it, expect } from "vitest";
import { ajustarFichadasPorTurno, intervalsParaDia } from "./recalcular-puro";
import { toUtcDateOnly } from "../dates";

// Hora de pared en Argentina (UTC-3 fijo), sin depender del huso horario de
// la máquina que corre los tests — misma convención que `localDateTime`.
function d(y: number, m: number, day: number, h: number, min = 0) {
  return new Date(Date.UTC(y, m - 1, day, h + 3, min, 0, 0));
}

describe("intervalsParaDia", () => {
  it("turno normal dentro del mismo día: se asigna entero a ese día", () => {
    const dia = toUtcDateOnly(2026, 5, 5); // 2026-06-05 (junio=5 idx)
    const fichadas = [{ fecha: dia, horaEntrada: d(2026, 6, 5, 8), horaSalida: d(2026, 6, 5, 16) }];
    const intervals = intervalsParaDia(dia, fichadas);
    expect(intervals).toEqual([{ start: d(2026, 6, 5, 8), end: d(2026, 6, 5, 16) }]);
  });

  it("turno 20 a 4: la parte antes de medianoche queda en el día que entró", () => {
    const dia = toUtcDateOnly(2026, 5, 1); // 2026-06-01
    const fichadas = [{ fecha: dia, horaEntrada: d(2026, 6, 1, 19, 40), horaSalida: d(2026, 6, 2, 3, 40) }];
    const intervals = intervalsParaDia(dia, fichadas);
    expect(intervals).toEqual([{ start: d(2026, 6, 1, 19, 40), end: d(2026, 6, 2, 0, 0) }]);
  });

  it("turno 20 a 4: la parte después de medianoche queda en el día siguiente", () => {
    const diaSiguiente = toUtcDateOnly(2026, 5, 2); // 2026-06-02
    const fichadaAnterior = { fecha: toUtcDateOnly(2026, 5, 1), horaEntrada: d(2026, 6, 1, 19, 40), horaSalida: d(2026, 6, 2, 3, 40) };
    const intervals = intervalsParaDia(diaSiguiente, [fichadaAnterior]);
    expect(intervals).toEqual([{ start: d(2026, 6, 2, 0, 0), end: d(2026, 6, 2, 3, 40) }]);
  });

  it("suma las horas totales correctamente entre ambos días (8h repartidas)", () => {
    const dia1 = toUtcDateOnly(2026, 5, 1);
    const dia2 = toUtcDateOnly(2026, 5, 2);
    const fichadas = [{ fecha: dia1, horaEntrada: d(2026, 6, 1, 19, 40), horaSalida: d(2026, 6, 2, 3, 40) }];
    const antesMedianoche = intervalsParaDia(dia1, fichadas)[0];
    const despuesMedianoche = intervalsParaDia(dia2, fichadas)[0];
    const horasDia1 = (antesMedianoche.end.getTime() - antesMedianoche.start.getTime()) / 3_600_000;
    const horasDia2 = (despuesMedianoche.end.getTime() - despuesMedianoche.start.getTime()) / 3_600_000;
    expect(horasDia1 + horasDia2).toBeCloseTo(8);
  });

  it("fichada abierta (sin salida) no aporta intervalo", () => {
    const dia = toUtcDateOnly(2026, 5, 1);
    const fichadas = [{ fecha: dia, horaEntrada: d(2026, 6, 1, 19, 40), horaSalida: null }];
    expect(intervalsParaDia(dia, fichadas)).toEqual([]);
  });
});

const TURNOS = [
  { id: "manana", horaInicio: "06:00", horaFin: "14:00", toleranciaMinutos: 15 },
  { id: "tarde", horaInicio: "14:00", horaFin: "22:00", toleranciaMinutos: 15 },
  { id: "noche", horaInicio: "22:00", horaFin: "06:00", toleranciaMinutos: 15 },
];

describe("ajustarFichadasPorTurno", () => {
  it("sin turnos en el catálogo: no ajusta nada y no hay tardanzas", () => {
    const dia = toUtcDateOnly(2026, 5, 5);
    const fichadas = [{ fecha: dia, horaEntrada: d(2026, 6, 5, 6, 30), horaSalida: d(2026, 6, 5, 14, 10) }];
    const { ajustadas, tardePorDia } = ajustarFichadasPorTurno(fichadas, []);
    expect(ajustadas).toEqual(fichadas);
    expect(tardePorDia.size).toBe(0);
  });

  it("desvío dentro del margen (entrada y salida): redondea a la hora exacta del turno detectado", () => {
    const dia = toUtcDateOnly(2026, 5, 5);
    const fichadas = [{ fecha: dia, horaEntrada: d(2026, 6, 5, 6, 10), horaSalida: d(2026, 6, 5, 13, 50) }];
    const { ajustadas, tardePorDia } = ajustarFichadasPorTurno(fichadas, TURNOS);
    expect(ajustadas).toEqual([{ fecha: dia, horaEntrada: d(2026, 6, 5, 6, 0), horaSalida: d(2026, 6, 5, 14, 0) }]);
    expect(tardePorDia.get(dia.getTime())).toBe(false);
  });

  it("llegada más allá del margen: marca tardanza y se pierde el tiempo real (no se acredita el turno completo)", () => {
    const dia = toUtcDateOnly(2026, 5, 5);
    const fichadas = [{ fecha: dia, horaEntrada: d(2026, 6, 5, 6, 30), horaSalida: d(2026, 6, 5, 14, 0) }];
    const { ajustadas, tardePorDia } = ajustarFichadasPorTurno(fichadas, TURNOS);
    // entró a las 6:30 (30min tarde, más allá del margen de 15) -> se acredita desde las 6:30, no desde las 6:00
    expect(ajustadas).toEqual([{ fecha: dia, horaEntrada: d(2026, 6, 5, 6, 30), horaSalida: d(2026, 6, 5, 14, 0) }]);
    expect(tardePorDia.get(dia.getTime())).toBe(true);
  });

  it("se queda trabajando más allá del margen: se acredita el tiempo real (hora extra a validar)", () => {
    const dia = toUtcDateOnly(2026, 5, 5);
    const fichadas = [{ fecha: dia, horaEntrada: d(2026, 6, 5, 6, 0), horaSalida: d(2026, 6, 5, 14, 40) }];
    const { ajustadas, tardePorDia, retiroAnticipadoPorDia } = ajustarFichadasPorTurno(fichadas, TURNOS);
    expect(ajustadas).toEqual([{ fecha: dia, horaEntrada: d(2026, 6, 5, 6, 0), horaSalida: d(2026, 6, 5, 14, 40) }]);
    expect(tardePorDia.get(dia.getTime())).toBe(false);
    expect(retiroAnticipadoPorDia.get(dia.getTime())).toBe(false);
  });

  it("el umbral de hora extra (15min) es fijo, no el margen del turno: se queda 18min con un turno de tolerancia 20 y SÍ se acredita extra", () => {
    const turnoTolerancia20 = [{ id: "oficina", horaInicio: "08:00", horaFin: "16:00", toleranciaMinutos: 20 }];
    const dia = toUtcDateOnly(2026, 5, 5);
    // se quedó 18min más: dentro de la tolerancia de 20 del turno, pero por
    // encima del umbral fijo de 15 para hora extra
    const fichadas = [{ fecha: dia, horaEntrada: d(2026, 6, 5, 8, 0), horaSalida: d(2026, 6, 5, 16, 18) }];
    const { ajustadas, retiroAnticipadoPorDia } = ajustarFichadasPorTurno(fichadas, turnoTolerancia20);
    expect(ajustadas).toEqual([{ fecha: dia, horaEntrada: d(2026, 6, 5, 8, 0), horaSalida: d(2026, 6, 5, 16, 18) }]);
    expect(retiroAnticipadoPorDia.get(dia.getTime())).toBe(false);
  });

  it("el umbral de hora extra (15min) es fijo: quedarse solo 10min de más NUNCA es hora extra, aunque el turno tenga tolerancia menor", () => {
    const turnoTolerancia5 = [{ id: "estricto", horaInicio: "08:00", horaFin: "16:00", toleranciaMinutos: 5 }];
    const dia = toUtcDateOnly(2026, 5, 5);
    // se quedó 10min más: más allá de la tolerancia de 5 del turno, pero por
    // debajo del umbral fijo de 15 para hora extra -> no se acredita nada
    const fichadas = [{ fecha: dia, horaEntrada: d(2026, 6, 5, 8, 0), horaSalida: d(2026, 6, 5, 16, 10) }];
    const { ajustadas, retiroAnticipadoPorDia } = ajustarFichadasPorTurno(fichadas, turnoTolerancia5);
    expect(ajustadas).toEqual([{ fecha: dia, horaEntrada: d(2026, 6, 5, 8, 0), horaSalida: d(2026, 6, 5, 16, 0) }]);
    expect(retiroAnticipadoPorDia.get(dia.getTime())).toBe(false);
  });

  it("se retira más allá del margen antes de hora: marca retiro anticipado y se pierde el tiempo real", () => {
    const dia = toUtcDateOnly(2026, 5, 5);
    const fichadas = [{ fecha: dia, horaEntrada: d(2026, 6, 5, 6, 0), horaSalida: d(2026, 6, 5, 13, 20) }];
    const { ajustadas, tardePorDia, retiroAnticipadoPorDia } = ajustarFichadasPorTurno(fichadas, TURNOS);
    // se fue a las 13:20 (40min antes de las 14:00, más allá del margen) -> se acredita hasta las 13:20, no hasta las 14:00
    expect(ajustadas).toEqual([{ fecha: dia, horaEntrada: d(2026, 6, 5, 6, 0), horaSalida: d(2026, 6, 5, 13, 20) }]);
    expect(tardePorDia.get(dia.getTime())).toBe(false);
    expect(retiroAnticipadoPorDia.get(dia.getTime())).toBe(true);
  });

  it("caso real: llegó mucho antes del inicio del turno detectado, se acredita el tiempo real (no se recorta la entrada)", () => {
    const turnosConOficina = [
      { id: "oficina", horaInicio: "08:00", horaFin: "16:00", toleranciaMinutos: 20 },
      { id: "manana", horaInicio: "04:00", horaFin: "12:00", toleranciaMinutos: 20 },
      { id: "tarde", horaInicio: "12:00", horaFin: "20:00", toleranciaMinutos: 20 },
    ];
    const dia = toUtcDateOnly(2026, 6, 13);
    // entró a las 4 y se fue a las 19:55: matchea "oficina" (08-16) por
    // distancia combinada, pero entró 4hs antes de su inicio nominal (08:00),
    // muy por fuera del margen de 20min -> no se debe recortar a las 8:00.
    const fichadas = [{ fecha: dia, horaEntrada: d(2026, 7, 13, 4, 0), horaSalida: d(2026, 7, 13, 19, 55) }];
    const { ajustadas, tardePorDia } = ajustarFichadasPorTurno(fichadas, turnosConOficina);
    expect(ajustadas).toEqual([{ fecha: dia, horaEntrada: d(2026, 7, 13, 4, 0), horaSalida: d(2026, 7, 13, 19, 55) }]);
    expect(tardePorDia.get(dia.getTime())).toBe(false);
  });

  it("detecta el turno más cercano por horario de entrada entre varios candidatos", () => {
    const dia = toUtcDateOnly(2026, 5, 5);
    const fichadas = [{ fecha: dia, horaEntrada: d(2026, 6, 5, 13, 55), horaSalida: d(2026, 6, 5, 22, 0) }];
    const { ajustadas } = ajustarFichadasPorTurno(fichadas, TURNOS);
    // debe matchear "tarde" (14:00), no "mañana" (06:00) ni "noche" (22:00)
    expect(ajustadas[0].horaEntrada).toEqual(d(2026, 6, 5, 14, 0));
  });

  it("distingue turnos con la misma entrada pero distinta duración (ej. pasante 8-12 vs oficina 8-16)", () => {
    const turnosConPasante = [
      { id: "oficina", horaInicio: "08:00", horaFin: "16:00", toleranciaMinutos: 15 },
      { id: "pasante", horaInicio: "08:00", horaFin: "12:00", toleranciaMinutos: 15 },
    ];
    const dia = toUtcDateOnly(2026, 5, 5);
    const fichadas = [{ fecha: dia, horaEntrada: d(2026, 6, 5, 8, 5), horaSalida: d(2026, 6, 5, 11, 58) }];
    const { ajustadas, tardePorDia, retiroAnticipadoPorDia } = ajustarFichadasPorTurno(fichadas, turnosConPasante);
    // debe matchear "pasante" (8-12), no "oficina" (8-16): sin eso, la salida a
    // las 11:58 se compararía contra las 16:00 y marcaría un falso retiro anticipado.
    expect(ajustadas).toEqual([{ fecha: dia, horaEntrada: d(2026, 6, 5, 8, 0), horaSalida: d(2026, 6, 5, 12, 0) }]);
    expect(tardePorDia.get(dia.getTime())).toBe(false);
    expect(retiroAnticipadoPorDia.get(dia.getTime())).toBe(false);
  });

  it("turno que cruza medianoche: se reparte igual entre los dos días calendario", () => {
    const dia = toUtcDateOnly(2026, 5, 1);
    const diaSiguiente = toUtcDateOnly(2026, 5, 2);
    const fichadas = [{ fecha: dia, horaEntrada: d(2026, 6, 1, 22, 5), horaSalida: d(2026, 6, 2, 6, 10) }];
    const { ajustadas, tardePorDia } = ajustarFichadasPorTurno(fichadas, TURNOS);
    expect(ajustadas).toEqual([{ fecha: dia, horaEntrada: d(2026, 6, 1, 22, 0), horaSalida: d(2026, 6, 2, 6, 0) }]);
    expect(tardePorDia.get(dia.getTime())).toBe(false);

    const antesMedianoche = intervalsParaDia(dia, ajustadas)[0];
    const despuesMedianoche = intervalsParaDia(diaSiguiente, ajustadas)[0];
    const horasDia1 = (antesMedianoche.end.getTime() - antesMedianoche.start.getTime()) / 3_600_000;
    const horasDia2 = (despuesMedianoche.end.getTime() - despuesMedianoche.start.getTime()) / 3_600_000;
    expect(horasDia1 + horasDia2).toBeCloseTo(8);
  });
});
