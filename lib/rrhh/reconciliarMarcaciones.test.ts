import { describe, it, expect } from "vitest";
import { reconciliarMarcaciones } from "./excelImport";
import { toUtcDateOnly } from "./dates";

function dia(y: number, m: number, d: number) {
  return toUtcDateOnly(y, m - 1, d);
}

describe("reconciliarMarcaciones", () => {
  it("turnos normales sin cruce de medianoche quedan igual", () => {
    const { turnos, avisos } = reconciliarMarcaciones([
      { fecha: dia(2026, 6, 1), raw: "E 08:07 - S 15:56" },
      { fecha: dia(2026, 6, 2), raw: "E 08:01 - S 16:07" },
    ]);
    expect(avisos).toEqual([]);
    expect(turnos).toEqual([
      { fecha: dia(2026, 6, 1), entradaStr: "08:07", salidaStr: "15:56", fechaSalida: dia(2026, 6, 1) },
      { fecha: dia(2026, 6, 2), entradaStr: "08:01", salidaStr: "16:07", fechaSalida: dia(2026, 6, 2) },
    ]);
  });

  it("turno 20 a 4 real (caso PC_002): cierra cruzando medianoche con el primer token del día siguiente", () => {
    const { turnos, avisos } = reconciliarMarcaciones([
      { fecha: dia(2026, 6, 1), raw: " E 19:40" },
      { fecha: dia(2026, 6, 2), raw: " E 03:40 - S 19:37" },
    ]);
    // el turno nocturno queda cerrado cruzando medianoche
    expect(turnos[0]).toEqual({ fecha: dia(2026, 6, 1), entradaStr: "19:40", salidaStr: "03:40", fechaSalida: dia(2026, 6, 2) });
    // lo que queda del día 2 (19:37) arranca un nuevo turno nocturno, sin día 3 en los datos para confirmarlo
    expect(turnos[1]).toEqual({ fecha: dia(2026, 6, 2), entradaStr: "19:37", salidaStr: null, fechaSalida: dia(2026, 6, 2) });
    expect(avisos).toHaveLength(1);
    expect(avisos[0].fecha).toEqual(dia(2026, 6, 2));
  });

  it("marcación realmente faltante (caso PC_002 real: 32hs de diferencia) NO se fuerza a cerrar", () => {
    const { turnos, avisos } = reconciliarMarcaciones([
      { fecha: dia(2026, 6, 7), raw: " E 03:33" },
      { fecha: dia(2026, 6, 8), raw: " E 11:40 - S 19:41" },
    ]);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].fecha).toEqual(dia(2026, 6, 7));
    // el turno del día 7 queda abierto (marcación faltante)
    expect(turnos[0]).toEqual({ fecha: dia(2026, 6, 7), entradaStr: "03:33", salidaStr: null, fechaSalida: dia(2026, 6, 7) });
    // el día 8 se procesa normal, sin robarle el primer token
    expect(turnos[1]).toEqual({ fecha: dia(2026, 6, 8), entradaStr: "11:40", salidaStr: "19:41", fechaSalida: dia(2026, 6, 8) });
  });

  it("día sin marcaciones después de una entrada abierta: se avisa y queda abierta", () => {
    const { turnos, avisos } = reconciliarMarcaciones([
      { fecha: dia(2026, 6, 1), raw: "E 20:00" },
      { fecha: dia(2026, 6, 2), raw: "" },
    ]);
    expect(avisos).toHaveLength(1);
    expect(turnos).toEqual([{ fecha: dia(2026, 6, 1), entradaStr: "20:00", salidaStr: null, fechaSalida: dia(2026, 6, 1) }]);
  });

  it("entrada abierta al final de los datos importados se avisa", () => {
    const { turnos, avisos } = reconciliarMarcaciones([{ fecha: dia(2026, 6, 30), raw: "E 20:00" }]);
    expect(avisos).toHaveLength(1);
    expect(turnos).toEqual([{ fecha: dia(2026, 6, 30), entradaStr: "20:00", salidaStr: null, fechaSalida: dia(2026, 6, 30) }]);
  });

  it("turno abierto de una importación anterior se cierra con el primer dato de la nueva (abiertoPrevio)", () => {
    const { turnos, avisos } = reconciliarMarcaciones(
      [{ fecha: dia(2026, 6, 2), raw: "E 03:40 - S 19:37" }],
      { fecha: dia(2026, 6, 1), entradaStr: "19:40" }
    );
    expect(turnos[0]).toEqual({ fecha: dia(2026, 6, 1), entradaStr: "19:40", salidaStr: "03:40", fechaSalida: dia(2026, 6, 2) });
    expect(turnos[1]).toEqual({ fecha: dia(2026, 6, 2), entradaStr: "19:37", salidaStr: null, fechaSalida: dia(2026, 6, 2) });
    expect(avisos).toHaveLength(1);
    expect(avisos[0].fecha).toEqual(dia(2026, 6, 2));
  });

  it("turno abierto de una importación anterior que sigue sin cerrar queda como aviso, no se fuerza", () => {
    const { turnos, avisos } = reconciliarMarcaciones(
      [{ fecha: dia(2026, 6, 10), raw: "E 11:40 - S 19:41" }],
      { fecha: dia(2026, 6, 1), entradaStr: "03:33" }
    );
    expect(avisos).toHaveLength(1);
    expect(avisos[0].fecha).toEqual(dia(2026, 6, 1));
    expect(turnos[0]).toEqual({ fecha: dia(2026, 6, 1), entradaStr: "03:33", salidaStr: null, fechaSalida: dia(2026, 6, 1) });
    expect(turnos[1]).toEqual({ fecha: dia(2026, 6, 10), entradaStr: "11:40", salidaStr: "19:41", fechaSalida: dia(2026, 6, 10) });
  });

  it("corte de almuerzo se mantiene igual (varios pares en un mismo día)", () => {
    const { turnos } = reconciliarMarcaciones([{ fecha: dia(2026, 6, 1), raw: "E 08:00 - S 12:00  E 13:00 - S 17:00" }]);
    expect(turnos).toEqual([
      { fecha: dia(2026, 6, 1), entradaStr: "08:00", salidaStr: "12:00", fechaSalida: dia(2026, 6, 1) },
      { fecha: dia(2026, 6, 1), entradaStr: "13:00", salidaStr: "17:00", fechaSalida: dia(2026, 6, 1) },
    ]);
  });

  it("caso ROSSI: salida y vuelta del almuerzo con 12min de diferencia se toman como dos tramos reales", () => {
    const { turnos } = reconciliarMarcaciones([{ fecha: dia(2026, 7, 6), raw: "E 08:05 - S 12:50  E 13:02 - S 16:02" }]);
    expect(turnos).toEqual([
      { fecha: dia(2026, 7, 6), entradaStr: "08:05", salidaStr: "12:50", fechaSalida: dia(2026, 7, 6) },
      { fecha: dia(2026, 7, 6), entradaStr: "13:02", salidaStr: "16:02", fechaSalida: dia(2026, 7, 6) },
    ]);
  });

  it("marcación fantasma (≤5min de la anterior) se descarta, quedando un turno normal", () => {
    const { turnos } = reconciliarMarcaciones([{ fecha: dia(2026, 6, 1), raw: "E 08:00 - E 08:03 - S 16:00" }]);
    expect(turnos).toEqual([{ fecha: dia(2026, 6, 1), entradaStr: "08:00", salidaStr: "16:00", fechaSalida: dia(2026, 6, 1) }]);
  });

  it("marcación fantasma pegada a la salida también se descarta", () => {
    const { turnos } = reconciliarMarcaciones([{ fecha: dia(2026, 6, 1), raw: "E 08:00 - S 16:00 - S 16:02" }]);
    expect(turnos).toEqual([{ fecha: dia(2026, 6, 1), entradaStr: "08:00", salidaStr: "16:00", fechaSalida: dia(2026, 6, 1) }]);
  });

  it("caso AGOSTA: entrada colgada a 18min de la última salida se funde con ese tramo (reingreso rápido)", () => {
    const { turnos } = reconciliarMarcaciones([{ fecha: dia(2026, 7, 17), raw: "E 07:59 - S 15:43 E 16:01" }]);
    expect(turnos).toEqual([{ fecha: dia(2026, 7, 17), entradaStr: "07:59", salidaStr: "16:01", fechaSalida: dia(2026, 7, 17) }]);
  });

  it("caso PC_204: entrada colgada a varias horas de la última salida es un turno realmente distinto, no se funde", () => {
    const { turnos, avisos } = reconciliarMarcaciones([{ fecha: dia(2026, 7, 11), raw: "E 11:50 - S 16:25 E 19:34" }]);
    // el tramo de la mañana queda intacto, y la entrada de la tarde/noche queda pendiente de cierre
    expect(turnos).toEqual([
      { fecha: dia(2026, 7, 11), entradaStr: "11:50", salidaStr: "16:25", fechaSalida: dia(2026, 7, 11) },
      { fecha: dia(2026, 7, 11), entradaStr: "19:34", salidaStr: null, fechaSalida: dia(2026, 7, 11) },
    ]);
    expect(avisos).toHaveLength(1);
  });

  it("entrada colgada tras un almuerzo con reingreso rápido después: solo se funde el último tramo, el almuerzo queda intacto", () => {
    const { turnos } = reconciliarMarcaciones([
      { fecha: dia(2026, 7, 1), raw: "E 08:00 - S 12:00 E 13:00 - S 17:00 E 17:10" },
    ]);
    expect(turnos).toEqual([
      { fecha: dia(2026, 7, 1), entradaStr: "08:00", salidaStr: "12:00", fechaSalida: dia(2026, 7, 1) },
      { fecha: dia(2026, 7, 1), entradaStr: "13:00", salidaStr: "17:10", fechaSalida: dia(2026, 7, 1) },
    ]);
  });
});
