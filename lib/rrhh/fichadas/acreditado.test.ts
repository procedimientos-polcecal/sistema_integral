import { describe, it, expect } from "vitest";
import {
  acreditarDia,
  acreditarLista,
  formatearHoras,
  instanteDePared,
  textoAcreditado,
  type CalculoDelDia,
} from "./acreditado";
import { unirCalculos } from "./calculoDelDia";
import { formatHHMM } from "../dates";
import type { TurnoLike } from "../engine/recalcular-puro";

// Los turnos reales del catálogo al 08/10/2026, con la tolerancia ya en 30.
const TURNOS: TurnoLike[] = [
  { id: "oficina", horaInicio: "08:00", horaFin: "16:00", toleranciaMinutos: 30 },
  { id: "pasantes", horaInicio: "08:00", horaFin: "12:00", toleranciaMinutos: 30 },
  { id: "pasantes-tarde", horaInicio: "12:00", horaFin: "16:00", toleranciaMinutos: 30 },
  { id: "manana", horaInicio: "04:00", horaFin: "12:00", toleranciaMinutos: 30 },
  { id: "noche", horaInicio: "20:00", horaFin: "04:00", toleranciaMinutos: 30 },
  { id: "tarde", horaInicio: "12:00", horaFin: "20:00", toleranciaMinutos: 30 },
];

/** Instante en hora de pared de Argentina (UTC-3 fijo), como lo guarda la base. */
function iso(dia: string, hhmm: string, diasDespues = 0): string {
  const [y, m, d] = dia.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d + diasDespues, h + 3, min)).toISOString();
}

/** Lo que guardaría el motor para un día; sólo se pisa lo que importa en cada test. */
function calculo(p: Partial<CalculoDelDia> = {}): CalculoDelDia {
  return {
    horas_normales: 8,
    horas_extra_50: 0,
    horas_extra_100: 0,
    tarde: false,
    retiro_anticipado: false,
    horas_manual: false,
    ...p,
  };
}

const hhmm = (d: Date | null) => (d ? formatHHMM(d) : null);

describe("acreditarDia: el caso que motivó esto", () => {
  it("PC_052, 29/09: marca 19:46 → 03:42 se acredita 20:00 → 04:00 y son 8h", () => {
    const m = acreditarDia(
      [{ id: "a", hora_entrada: iso("2026-09-29", "19:46"), hora_salida: iso("2026-09-29", "03:42", 1) }],
      "2026-09-29",
      TURNOS
    );
    const a = m.get("a")!;
    expect(hhmm(a.entrada)).toBe("20:00");
    expect(hhmm(a.salida)).toBe("04:00");
    expect(a.horas).toBeCloseTo(8);
    expect(a.difiereEntrada).toBe(true);
    expect(a.difiereSalida).toBe(true);
    expect(textoAcreditado(a, calculo())).toMatchObject({
      rango: "20:00 → 04:00",
      horas: "8h",
      tardanza: false,
      retiroAnticipado: false,
    });
  });

  it("PC_125, 29/09: salida 04:00 editada a mano da lo mismo que sin editar", () => {
    const sinEditar = acreditarDia(
      [{ id: "a", hora_entrada: iso("2026-09-29", "19:50"), hora_salida: iso("2026-09-29", "03:52", 1) }],
      "2026-09-29",
      TURNOS
    ).get("a")!;
    const editada = acreditarDia(
      [{ id: "a", hora_entrada: iso("2026-09-29", "19:50"), hora_salida: iso("2026-09-29", "04:00", 1) }],
      "2026-09-29",
      TURNOS
    ).get("a")!;
    expect(sinEditar.horas).toBeCloseTo(8);
    expect(editada.horas).toBeCloseTo(8);
    // En la editada la salida ya coincide: sólo la entrada difiere.
    expect(editada.difiereSalida).toBe(false);
    expect(editada.difiereEntrada).toBe(true);
  });
});

describe("acreditarDia: cuándo se muestra lo acreditado", () => {
  it("marca exacta al turno: nada difiere y el rango no se repite", () => {
    const a = acreditarDia(
      [{ id: "a", hora_entrada: iso("2026-09-30", "08:00"), hora_salida: iso("2026-09-30", "16:00") }],
      "2026-09-30",
      TURNOS
    ).get("a")!;
    expect(a.difiereEntrada).toBe(false);
    expect(a.difiereSalida).toBe(false);
    const t = textoAcreditado(a, calculo());
    expect(t.rango).toBeNull();
    expect(t.horas).toBe("8h");
  });

  it("segundos de diferencia no cuentan como diferencia: se ve igual", () => {
    const entrada = new Date(Date.UTC(2026, 8, 30, 11, 0, 20)).toISOString(); // 08:00:20
    const a = acreditarDia(
      [{ id: "a", hora_entrada: entrada, hora_salida: iso("2026-09-30", "16:00") }],
      "2026-09-30",
      TURNOS
    ).get("a")!;
    expect(a.difiereEntrada).toBe(false);
    expect(textoAcreditado(a, calculo()).rango).toBeNull();
  });

  it("llegó antes y se quedó de más: se acredita lo real, que es una hora extra a validar", () => {
    const a = acreditarDia(
      [{ id: "a", hora_entrada: iso("2026-09-30", "07:00"), hora_salida: iso("2026-09-30", "17:00") }],
      "2026-09-30",
      TURNOS
    ).get("a")!;
    expect(a.difiereEntrada).toBe(false);
    expect(a.difiereSalida).toBe(false);
    expect(a.horas).toBeCloseTo(10);
  });
});

describe("acreditarDia: fuera del margen", () => {
  it("pasado el margen de tardanza se acredita desde la marca, y no difiere de ella", () => {
    const a = acreditarDia(
      [{ id: "a", hora_entrada: iso("2026-09-30", "08:45"), hora_salida: iso("2026-09-30", "16:00") }],
      "2026-09-30",
      TURNOS
    ).get("a")!;
    expect(a.difiereEntrada).toBe(false);
    expect(a.horas).toBeCloseTo(7.25);
  });

  it("justo en el margen se acredita desde el horario del turno", () => {
    const a = acreditarDia(
      [{ id: "a", hora_entrada: iso("2026-09-30", "08:30"), hora_salida: iso("2026-09-30", "16:00") }],
      "2026-09-30",
      TURNOS
    ).get("a")!;
    expect(a.difiereEntrada).toBe(true);
    expect(a.horas).toBeCloseTo(8);
  });

  it("pasado el margen de salida se acredita hasta la marca", () => {
    const a = acreditarDia(
      [{ id: "a", hora_entrada: iso("2026-09-30", "08:00"), hora_salida: iso("2026-09-30", "15:10") }],
      "2026-09-30",
      TURNOS
    ).get("a")!;
    expect(a.difiereSalida).toBe(false);
    expect(a.horas).toBeCloseTo(7 + 10 / 60);
  });
});

describe("textoAcreditado: lo que dice calculos_diarios y no lo que deduce la pantalla", () => {
  const tardeEnElTurno = acreditarDia(
    [{ id: "a", hora_entrada: iso("2026-09-30", "08:45"), hora_salida: iso("2026-09-30", "16:00") }],
    "2026-09-30",
    TURNOS
  ).get("a")!;

  it("si el motor dice que no hubo tardanza, no la hay, aunque el horario diga otra cosa", () => {
    // 45 minutos tarde sobre el turno, pero el motor no lo marcó (por ejemplo
    // un sábado de un sector de lunes a viernes). Manda el motor.
    expect(textoAcreditado(tardeEnElTurno, calculo({ tarde: false })).tardanza).toBe(false);
    expect(textoAcreditado(tardeEnElTurno, calculo({ tarde: true })).tardanza).toBe(true);
  });

  it("si el motor marcó tardanza se muestra, aunque con el margen de hoy ya no lo fuera", () => {
    // Día calculado cuando el margen era de 20: 08:25 era tardanza; con 30 ya no.
    const dentroDeLos30 = acreditarDia(
      [{ id: "a", hora_entrada: iso("2026-09-30", "08:25"), hora_salida: iso("2026-09-30", "16:00") }],
      "2026-09-30",
      TURNOS
    ).get("a")!;
    const t = textoAcreditado(dentroDeLos30, calculo({ tarde: true }));
    expect(t.tardanza).toBe(true);
    expect(t.rango).toBe("08:00 → 16:00");
  });

  it("la tardanza va en la primera marcación del día y el retiro anticipado en la última", () => {
    const m = acreditarDia(
      [
        { id: "uno", hora_entrada: iso("2026-09-30", "09:00"), hora_salida: iso("2026-09-30", "12:00") },
        { id: "dos", hora_entrada: iso("2026-09-30", "13:00"), hora_salida: iso("2026-09-30", "14:00") },
      ],
      "2026-09-30",
      TURNOS
    );
    const c = calculo({ tarde: true, retiro_anticipado: true });
    expect(textoAcreditado(m.get("uno")!, c)).toMatchObject({ tardanza: true, retiroAnticipado: false });
    expect(textoAcreditado(m.get("dos")!, c)).toMatchObject({ tardanza: false, retiroAnticipado: true });
  });

  it("día sin fila en calculos_diarios: se dice que está sin calcular y no se inventan señales", () => {
    const t = textoAcreditado(tardeEnElTurno, null);
    expect(t.diaSinCalcular).toBe(true);
    expect(t.tardanza).toBe(false);
    expect(t.retiroAnticipado).toBe(false);
    // Lo acreditado sí se muestra: eso no depende de la tabla.
    expect(t.horas).toBe("7h 15m");
  });

  it("un día sin tardanza y un día sin calcular no se ven igual", () => {
    expect(textoAcreditado(tardeEnElTurno, calculo()).diaSinCalcular).toBe(false);
    expect(textoAcreditado(tardeEnElTurno, null).diaSinCalcular).toBe(true);
  });

  it("tabla que no se pudo leer (undefined): ni señales ni 'sin calcular'", () => {
    expect(textoAcreditado(tardeEnElTurno, undefined)).toMatchObject({
      diaSinCalcular: false,
      tardanza: false,
      retiroAnticipado: false,
    });
  });

  it("horas fijadas a mano: se muestran esas horas, dichas, y no el rango acreditado", () => {
    // PC_052, 29/09: la marca se acredita 20:00 → 04:00 (8h), pero el día tiene horas fijadas.
    const a = acreditarDia(
      [{ id: "a", hora_entrada: iso("2026-09-29", "19:46"), hora_salida: iso("2026-09-29", "03:42", 1) }],
      "2026-09-29",
      TURNOS
    ).get("a")!;
    const t = textoAcreditado(a, calculo({ horas_manual: true, horas_normales: 6, horas_extra_50: 1.5 }));
    expect(t).toMatchObject({ horas: "7h 30m", horasFijadasAMano: true, rango: null });
  });

  it("horas fijadas a mano con varias marcaciones: el total va una sola vez, en la primera", () => {
    const m = acreditarDia(
      [
        { id: "uno", hora_entrada: iso("2026-09-30", "08:00"), hora_salida: iso("2026-09-30", "12:00") },
        { id: "dos", hora_entrada: iso("2026-09-30", "13:00"), hora_salida: iso("2026-09-30", "16:00") },
      ],
      "2026-09-30",
      TURNOS
    );
    const c = calculo({ horas_manual: true });
    expect(textoAcreditado(m.get("uno")!, c)).toMatchObject({ horas: "8h", horasFijadasAMano: true });
    expect(textoAcreditado(m.get("dos")!, c)).toMatchObject({ horas: null, horasFijadasAMano: false });
  });
});

describe("unirCalculos", () => {
  const fila = (p: Partial<{ empleado_id: string; fecha: string; horas_manual: boolean; tarde: boolean }> = {}) => ({
    empleado_id: "e1",
    fecha: "2026-09-29",
    horas_normales: "8.00",
    horas_extra_50: 0,
    horas_extra_100: 0,
    tarde: false,
    retiro_anticipado: false,
    horas_manual: false,
    ...p,
  });

  it("pega a cada fichada el cálculo de su empleado y día", () => {
    const r = unirCalculos(
      [
        { id: "1", empleado_id: "e1", fecha: "2026-09-29" },
        { id: "2", empleado_id: "e1", fecha: "2026-09-30" },
        { id: "3", empleado_id: "e2", fecha: "2026-09-29" },
      ],
      [fila({ horas_manual: true }), fila({ empleado_id: "e2", tarde: true })]
    );
    expect(r[0].calculo_dia).toMatchObject({ horas_manual: true, horas_normales: 8 });
    expect(r[2].calculo_dia).toMatchObject({ tarde: true, horas_manual: false });
  });

  it("sin fila para ese día: null, que es 'sin calcular'", () => {
    const r = unirCalculos([{ id: "2", empleado_id: "e1", fecha: "2026-09-30" }], [fila()]);
    expect(r[0].calculo_dia).toBeNull();
  });

  it("la fecha con parte de hora también engancha, y las horas numeric llegan como número", () => {
    const r = unirCalculos([{ id: "1", empleado_id: "e1", fecha: "2026-09-29T00:00:00+00:00" }], [fila()]);
    expect(r[0].calculo_dia?.horas_normales).toBe(8);
  });
});

describe("acreditarDia: casos de borde", () => {
  it("sin salida: no acredita horas y se dice", () => {
    const a = acreditarDia(
      [{ id: "a", hora_entrada: iso("2026-09-30", "07:50"), hora_salida: null }],
      "2026-09-30",
      TURNOS
    ).get("a")!;
    expect(a.horas).toBeNull();
    expect(a.salida).toBeNull();
    expect(textoAcreditado(a, calculo()).sinSalida).toBe(true);
  });

  it("sin turnos en el catálogo: lo acreditado es la marca", () => {
    const a = acreditarDia(
      [{ id: "a", hora_entrada: iso("2026-09-29", "19:46"), hora_salida: iso("2026-09-29", "03:42", 1) }],
      "2026-09-29",
      []
    ).get("a")!;
    expect(a.difiereEntrada).toBe(false);
    expect(a.difiereSalida).toBe(false);
    expect(a.horas).toBeCloseTo(7 + 56 / 60);
  });

  it("sin marcaciones: nada", () => {
    expect(acreditarDia([], "2026-09-29", TURNOS).size).toBe(0);
  });

  it("varias marcaciones en el día: el ajuste va a la primera entrada y a la última salida", () => {
    const m = acreditarDia(
      [
        // Desordenadas a propósito: se ordenan por entrada.
        { id: "tarde", hora_entrada: iso("2026-09-30", "13:00"), hora_salida: iso("2026-09-30", "15:55") },
        { id: "manana", hora_entrada: iso("2026-09-30", "07:55"), hora_salida: iso("2026-09-30", "12:00") },
      ],
      "2026-09-30",
      TURNOS
    );
    expect(hhmm(m.get("manana")!.entrada)).toBe("08:00");
    expect(m.get("manana")!.difiereEntrada).toBe(true);
    expect(m.get("manana")!.difiereSalida).toBe(false);
    expect(hhmm(m.get("tarde")!.salida)).toBe("16:00");
    expect(m.get("tarde")!.difiereSalida).toBe(true);
    expect(m.get("tarde")!.difiereEntrada).toBe(false);
    const total = (m.get("manana")!.horas ?? 0) + (m.get("tarde")!.horas ?? 0);
    expect(total).toBeCloseTo(4 + 3);
    expect(m.get("manana")!.esPrimeraDelDia).toBe(true);
    expect(m.get("tarde")!.esUltimaDelDia).toBe(true);
  });
});

describe("acreditarLista", () => {
  it("agrupa por empleado y día, y devuelve todo por id", () => {
    const m = acreditarLista(
      [
        { id: "e1-d1", empleado_id: "e1", fecha: "2026-09-29", hora_entrada: iso("2026-09-29", "19:46"), hora_salida: iso("2026-09-29", "03:42", 1) },
        { id: "e2-d1", empleado_id: "e2", fecha: "2026-09-29", hora_entrada: iso("2026-09-29", "07:55"), hora_salida: iso("2026-09-29", "16:05") },
        { id: "e1-d2", empleado_id: "e1", fecha: "2026-09-30", hora_entrada: iso("2026-09-30", "20:50"), hora_salida: iso("2026-10-01", "04:00") },
      ],
      TURNOS
    );
    expect(m.size).toBe(3);
    expect(hhmm(m.get("e1-d1")!.entrada)).toBe("20:00");
    expect(hhmm(m.get("e2-d1")!.entrada)).toBe("08:00");
    expect(hhmm(m.get("e2-d1")!.salida)).toBe("16:00");
    // El mismo empleado otro día no se mezcla con el primero: 50 min tarde, se acredita lo real.
    expect(hhmm(m.get("e1-d2")!.entrada)).toBe("20:50");
  });

  it("acepta la fecha con o sin parte de hora", () => {
    const m = acreditarLista(
      [{ id: "a", empleado_id: "e1", fecha: "2026-09-29T00:00:00+00:00", hora_entrada: iso("2026-09-29", "19:46"), hora_salida: iso("2026-09-29", "03:42", 1) }],
      TURNOS
    );
    expect(hhmm(m.get("a")!.entrada)).toBe("20:00");
  });
});

describe("formatearHoras", () => {
  it("redondea al minuto y no muestra ceros de más", () => {
    expect(formatearHoras(8)).toBe("8h");
    expect(formatearHoras(7 + 53 / 60)).toBe("7h 53m");
    expect(formatearHoras(0.75)).toBe("45m");
    expect(formatearHoras(7.9999)).toBe("8h");
  });
});

describe("instanteDePared", () => {
  it("la hora de pared es la de Argentina: 20:00 son las 23:00 UTC", () => {
    expect(instanteDePared("2026-09-29", "20:00")).toBe("2026-09-29T23:00:00.000Z");
  });

  it("después de las 21:00 el día UTC ya es el siguiente y no se pierde", () => {
    expect(instanteDePared("2026-09-29", "22:30")).toBe("2026-09-30T01:30:00.000Z");
  });

  it("devuelve null si falta algo o no es válido", () => {
    expect(instanteDePared("", "20:00")).toBeNull();
    expect(instanteDePared("2026-09-29", "")).toBeNull();
    expect(instanteDePared("2026-13-45", "20:00")).toBeNull();
    expect(instanteDePared("2026-09-29", "25:00")).toBeNull();
  });

  it("coincide con lo que guarda la base para la misma hora", () => {
    expect(instanteDePared("2026-09-29", "19:46")).toBe(iso("2026-09-29", "19:46"));
  });
});
