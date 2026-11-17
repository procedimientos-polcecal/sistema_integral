import { describe, expect, it } from "vitest";
import { DURACION, armarTurnos, turnoDelCorte } from "./turnos";
import type { CorteDeTurno, FilaCruda, TurnoDeMolino } from "./types";

const CORTES: CorteDeTurno[] = ["3:59", "11:59", "19:59", "23:59"];

function fila(
  fecha: string,
  corte: CorteDeTurno,
  minutos: number,
  kg = 1000,
  porMaterial: Record<string, number> = {},
): FilaCruda {
  return { fecha, corte, kg, minutos, porMaterial };
}

/** Las cuatro filas de un día, cada una con su duración teórica exacta. */
function diaCompleto(fecha: string): FilaCruda[] {
  return CORTES.map((c) => fila(fecha, c, DURACION[c]));
}

function turnoDe(turnos: ReturnType<typeof armarTurnos>["turnos"], fecha: string, turno: TurnoDeMolino) {
  const t = turnos.find((x) => x.fecha === fecha && x.turno === turno);
  if (!t) throw new Error(`no hay turno ${turno} el ${fecha}`);
  return t;
}

describe("turnoDelCorte", () => {
  it("el turno lo decide la hora de cierre", () => {
    expect(turnoDelCorte("23:59")).toBe("20_00");
    expect(turnoDelCorte("3:59")).toBe("00_04");
    expect(turnoDelCorte("11:59")).toBe("04_12");
    expect(turnoDelCorte("19:59")).toBe("12_20");
  });

  it("las duraciones teóricas son 240/480/480/240 por corte", () => {
    expect(DURACION).toEqual({ "3:59": 240, "11:59": 480, "19:59": 480, "23:59": 240 });
  });
});

describe("armarTurnos: días sin filas", () => {
  it("un día sin ninguna fila no cuenta: ni numerador ni denominador", () => {
    // 2026-10-12, feriado: Filler 1 no tiene ninguna fila.
    const filasDel11Y13 = [...diaCompleto("2026-10-11"), ...diaCompleto("2026-10-13")];
    const { turnos, diasNoOperativos } = armarTurnos(filasDel11Y13);
    expect(diasNoOperativos).toEqual(["2026-10-12"]);
    expect(turnos.some((t) => t.fecha === "2026-10-12")).toBe(false);
    // Ni siquiera como huérfanos: ese día no existe para el molino.
    expect(turnos).toHaveLength(8);
    expect(turnos.every((t) => t.estado === "normal")).toBe(true);
  });

  it("los días sin filas se listan en orden y cruzando el fin de mes", () => {
    const { diasNoOperativos } = armarTurnos([...diaCompleto("2026-02-27"), ...diaCompleto("2026-03-02")]);
    expect(diasNoOperativos).toEqual(["2026-02-28", "2026-03-01"]);
  });

  it("un día con sólo una fila no es un día no operativo", () => {
    const { diasNoOperativos } = armarTurnos([...diaCompleto("2026-10-11"), fila("2026-10-12", "23:59", 240), ...diaCompleto("2026-10-13")]);
    expect(diasNoOperativos).toEqual([]);
  });

  it("sin filas no hay turnos ni días", () => {
    expect(armarTurnos([])).toEqual({ turnos: [], diasNoOperativos: [] });
  });
});

describe("armarTurnos: un cero es una parada", () => {
  it("un turno en cero dentro de un día con filas es una parada normal", () => {
    // Filler 2 el 2026-10-12: cuatro filas en cero. NO es no_opero.
    const cuatroCerosDelMismoDia = CORTES.map((c) => fila("2026-10-12", c, 0, 0));
    const { turnos, diasNoOperativos } = armarTurnos(cuatroCerosDelMismoDia);
    expect(diasNoOperativos).toHaveLength(0);
    expect(turnos).toHaveLength(4);
    expect(turnos[0]).toMatchObject({ estado: "normal", minutosMarcha: 0, minutosTeoricos: 240 });
    expect(turnos.map((t) => t.minutosTeoricos)).toEqual([240, 480, 480, 240]);
  });
});

describe("armarTurnos: exceso de marcha", () => {
  it("una fila que excede su duración se cubre con la racha de turnos faltantes", () => {
    // 2026-03-09 11:59, 631 minutos en un bloque de 480. Hacia atrás sólo falta
    // el 3:59 del lunes: antes está el domingo 08/03, sin una fila, donde la
    // racha se corta. 631 <= 480 + 240 + 10.
    const { turnos } = armarTurnos([
      ...diaCompleto("2026-03-07"),
      fila("2026-03-09", "11:59", 631, 20000),
      fila("2026-03-09", "19:59", 480),
      fila("2026-03-09", "23:59", 240),
    ]);
    const t = turnoDe(turnos, "2026-03-09", "04_12");
    expect(t.estado).toBe("acumulado");
    expect(t.minutosTeoricos).toBe(720); // 480 propios + el 3:59 faltante, NO 2160
    expect(t.minutosMarcha).toBe(631);
    expect(t.kg).toBe(20000);
    // Lo que absorbe no aparece como turno propio: ni parada ni huérfano.
    expect(turnos.some((x) => x.fecha === "2026-03-08")).toBe(false);
    expect(turnos.some((x) => x.fecha === "2026-03-09" && x.turno === "00_04")).toBe(false);
    expect(turnos.some((x) => x.estado === "huerfano")).toBe(false);
  });

  it("la racha se corta en un día sin filas: no suma sus 1.440 minutos", () => {
    // Es la decisión que separa 85,3 % de 82,0 % de utilización en Filler 1: el
    // día que la planta estuvo cerrada no se sabe cuánto de la marcha informada
    // ocurrió entonces, y contarlo inflaría el denominador con horas que nadie
    // pudo trabajar. 900 minutos no entran en 480 + 240 + 10 y el domingo no
    // ayuda: queda inconsistente, conserva los kilos, y no se vuelve acumulado.
    const { turnos } = armarTurnos([
      ...diaCompleto("2026-03-07"),
      fila("2026-03-09", "11:59", 900, 31000),
      fila("2026-03-09", "19:59", 480),
      fila("2026-03-09", "23:59", 240),
    ]);
    expect(turnoDe(turnos, "2026-03-09", "04_12")).toMatchObject({
      estado: "inconsistente",
      minutosTeoricos: 480,
      kg: 31000,
    });
    // El 3:59 del lunes quedó sin quién lo absorba.
    expect(turnoDe(turnos, "2026-03-09", "00_04").estado).toBe("huerfano");
  });

  it("lo que quedó antes del corte tampoco lo absorbe una fila posterior", () => {
    // Faltan el 19:59 y el 23:59 del sábado, el domingo está vacío y del lunes
    // falta el 3:59. Sin el corte la racha del 11:59 sería 480+240+240+480 y
    // cubriría los 900 minutos; con el corte sólo cuenta el 3:59 del lunes
    // (480+240 = 720) y el turno queda inconsistente.
    const { turnos } = armarTurnos([
      fila("2026-03-07", "3:59", 240),
      fila("2026-03-07", "11:59", 480),
      fila("2026-03-09", "11:59", 900),
      fila("2026-03-09", "19:59", 480),
      fila("2026-03-09", "23:59", 240),
    ]);
    expect(turnoDe(turnos, "2026-03-09", "04_12").estado).toBe("inconsistente");
    // Salen en su lugar cronológico: los del sábado y el 3:59 del lunes.
    expect(turnos.map((t) => `${t.fecha} ${t.turno} ${t.estado}`)).toEqual([
      "2026-03-07 00_04 normal",
      "2026-03-07 04_12 normal",
      "2026-03-07 12_20 huerfano",
      "2026-03-07 20_00 huerfano",
      "2026-03-09 00_04 huerfano",
      "2026-03-09 04_12 inconsistente",
      "2026-03-09 12_20 normal",
      "2026-03-09 20_00 normal",
    ]);
  });

  it("la racha también se arma con faltantes de días que sí tienen filas", () => {
    // 19:59 y 23:59 del primer día sin informar, y el 3:59 del siguiente: 480+240+240
    const { turnos } = armarTurnos([
      fila("2026-05-04", "3:59", 240),
      fila("2026-05-04", "11:59", 480),
      fila("2026-05-05", "11:59", 700, 30000),
      fila("2026-05-05", "19:59", 480),
      fila("2026-05-05", "23:59", 240),
    ]);
    const t = turnoDe(turnos, "2026-05-05", "04_12");
    expect(t).toMatchObject({ estado: "acumulado", minutosTeoricos: 480 + 480 + 240 + 240, minutosMarcha: 700 });
    expect(turnos.filter((x) => x.estado === "huerfano")).toEqual([]);
  });

  it("un exceso dentro de la tolerancia es un turno normal", () => {
    // Filler 2, 2026-06-04 11:59: 486 minutos en 480.
    const { turnos } = armarTurnos([fila("2026-06-04", "11:59", 486)]);
    const t = turnoDe(turnos, "2026-06-04", "04_12");
    expect(t.estado).toBe("normal");
    expect(t.minutosMarcha).toBe(486);
    expect(t.minutosTeoricos).toBe(486);
  });

  it("la tolerancia es de 10 minutos justos: 490 es normal y 491 no", () => {
    const previo = [fila("2026-06-04", "3:59", 240)];
    const en = armarTurnos([...previo, fila("2026-06-04", "11:59", 490)]).turnos;
    expect(turnoDe(en, "2026-06-04", "04_12")).toMatchObject({ estado: "normal", minutosTeoricos: 490 });
    const pasa = armarTurnos([...previo, fila("2026-06-04", "11:59", 491)]).turnos;
    expect(turnoDe(pasa, "2026-06-04", "04_12").estado).toBe("inconsistente");
  });

  it("la tolerancia se puede cambiar", () => {
    const filas = [fila("2026-06-04", "3:59", 240), fila("2026-06-04", "11:59", 486)];
    expect(turnoDe(armarTurnos(filas, 0).turnos, "2026-06-04", "04_12").estado).toBe("inconsistente");
    expect(turnoDe(armarTurnos(filas, 6).turnos, "2026-06-04", "04_12").estado).toBe("normal");
  });

  it("un exceso sin racha que lo explique queda inconsistente y conserva sus kilos", () => {
    // Filler 1, 2026-06-04 11:59: 498 minutos en 480, sin turnos faltantes antes.
    const { turnos } = armarTurnos([
      fila("2026-06-04", "3:59", 240),
      fila("2026-06-04", "11:59", 498, 90000),
    ]);
    const t = turnoDe(turnos, "2026-06-04", "04_12");
    expect(t.estado).toBe("inconsistente");
    expect(t.kg).toBe(90000);
    expect(t.minutosMarcha).toBe(498);
    // Las horas se las saca el consumidor mirando el estado; acá se informa la
    // duración del bloque, no una racha inventada.
    expect(t.minutosTeoricos).toBe(480);
  });

  it("una racha que no alcanza a explicar el exceso lo deja inconsistente, y sus faltantes quedan huérfanos", () => {
    // Falta el 3:59 (240): cubre hasta 480+240+10 = 730; la fila informa 731.
    const { turnos } = armarTurnos([
      fila("2026-06-04", "11:59", 731, 55000),
      fila("2026-06-04", "19:59", 480),
      fila("2026-06-04", "23:59", 240),
    ]);
    expect(turnos.map((t) => [t.turno, t.estado])).toEqual([
      ["00_04", "huerfano"],
      ["04_12", "inconsistente"],
      ["12_20", "normal"],
      ["20_00", "normal"],
    ]);
    expect(turnoDe(turnos, "2026-06-04", "04_12").kg).toBe(55000);
  });

  it("una racha que explica el exceso por la tolerancia lo cubre: 730 sí, 731 no", () => {
    const resto = [fila("2026-06-04", "19:59", 480), fila("2026-06-04", "23:59", 240)];
    const cubre = armarTurnos([fila("2026-06-04", "11:59", 730), ...resto]).turnos;
    expect(turnoDe(cubre, "2026-06-04", "04_12")).toMatchObject({ estado: "acumulado", minutosTeoricos: 720 });
  });
});

describe("armarTurnos: huérfanos", () => {
  it("un turno que falta sin racha que lo absorba es huérfano, no una parada", () => {
    // El día en curso siempre llega con un solo turno: el zip se corta a las 09:00.
    const { turnos } = armarTurnos([fila("2026-10-27", "3:59", 239)]);
    const huerfanos = turnos.filter((t) => t.estado === "huerfano");
    expect(huerfanos.map((t) => t.turno)).toEqual(["04_12", "12_20", "20_00"]);
    expect(huerfanos.every((t) => t.minutosMarcha === 0 && t.minutosTeoricos === 0)).toBe(true);
    expect(huerfanos.every((t) => t.kg === 0)).toBe(true);
    expect(turnos).toHaveLength(4);
  });

  it("un faltante antes de una fila normal no se absorbe: es huérfano y va en su lugar", () => {
    // 300 minutos en un bloque de 480 no es un exceso, así que no hay racha.
    const { turnos } = armarTurnos([
      fila("2026-07-01", "3:59", 240),
      fila("2026-07-01", "19:59", 300),
      fila("2026-07-01", "23:59", 240),
    ]);
    expect(turnos.map((t) => [t.turno, t.estado])).toEqual([
      ["00_04", "normal"],
      ["04_12", "huerfano"],
      ["12_20", "normal"],
      ["20_00", "normal"],
    ]);
  });

  it("las filas de un día en curso con un solo corte no inventan días no operativos", () => {
    const { diasNoOperativos } = armarTurnos([...diaCompleto("2026-10-26"), fila("2026-10-27", "3:59", 239)]);
    expect(diasNoOperativos).toEqual([]);
  });
});

describe("armarTurnos: el resto", () => {
  it("ordena cronológicamente aunque las filas lleguen desordenadas", () => {
    const filas = [...diaCompleto("2026-04-02")].reverse().concat([...diaCompleto("2026-04-01")].reverse());
    const { turnos } = armarTurnos(filas);
    expect(turnos.map((t) => `${t.fecha} ${t.turno}`)).toEqual([
      "2026-04-01 00_04",
      "2026-04-01 04_12",
      "2026-04-01 12_20",
      "2026-04-01 20_00",
      "2026-04-02 00_04",
      "2026-04-02 04_12",
      "2026-04-02 12_20",
      "2026-04-02 20_00",
    ]);
  });

  it("si llegan dos filas del mismo día y corte se queda con la última, sin sumarlas", () => {
    const { turnos } = armarTurnos([
      fila("2026-04-01", "3:59", 100, 111),
      fila("2026-04-01", "3:59", 200, 222),
    ]);
    expect(turnoDe(turnos, "2026-04-01", "00_04")).toMatchObject({ kg: 222, minutosMarcha: 200 });
    expect(turnos.filter((t) => t.turno === "00_04")).toHaveLength(1);
  });

  it("porMaterial se arrastra tal cual, sin conciliarlo con kg", () => {
    // 65 de 842 turnos de Filler 1 tienen un reparto que no suma sus kilos.
    const reparto = { membranero: 10, dolomita: 20, caliza: 30 };
    const { turnos } = armarTurnos([fila("2026-04-01", "3:59", 240, 1000, reparto)]);
    expect(turnoDe(turnos, "2026-04-01", "00_04").porMaterial).toEqual(reparto);
    expect(turnoDe(turnos, "2026-04-01", "00_04").kg).toBe(1000);
    // Un huérfano no tiene reparto.
    expect(turnoDe(turnos, "2026-04-01", "04_12").porMaterial).toEqual({});
  });

  it("un turno acumulado e uno inconsistente conservan su porMaterial", () => {
    const reparto = { piedra_caliza: 70 };
    const acumulado = armarTurnos([
      fila("2026-04-01", "3:59", 240),
      fila("2026-04-01", "19:59", 700, 5000, reparto),
      fila("2026-04-01", "23:59", 240),
    ]).turnos;
    expect(turnoDe(acumulado, "2026-04-01", "12_20")).toMatchObject({ estado: "acumulado", porMaterial: reparto });
    const inconsistente = armarTurnos([
      fila("2026-04-01", "3:59", 240),
      fila("2026-04-01", "11:59", 900, 5000, reparto),
    ]).turnos;
    expect(turnoDe(inconsistente, "2026-04-01", "04_12")).toMatchObject({ estado: "inconsistente", porMaterial: reparto });
  });
});
