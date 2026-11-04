import { describe, expect, it } from "vitest";
import { AVISO_DE_TOPE, HORA_DE_ARRANQUE, TOPE_DE_ARRANQUE, claveDeApilado, horarioApilado } from "./apilado";
import { DURACION_OT_MINUTOS } from "./evento";

describe("donde cae una OT en su dia", () => {
  it("las constantes son las de la spec", () => {
    expect(HORA_DE_ARRANQUE).toBe("08:00");
    expect(TOPE_DE_ARRANQUE).toBe("20:00");
    expect(DURACION_OT_MINUTOS).toBe(90);
    expect(AVISO_DE_TOPE).toMatch(/nueve/);
    expect(AVISO_DE_TOPE).toMatch(/20:00/);
  });

  it("la primera arranca a las 08:00 y dura 1:30", () => {
    expect(horarioApilado("2026-11-06", 0)).toEqual({
      inicio: "2026-11-06T08:00:00", fin: "2026-11-06T09:30:00", topeado: false,
    });
  });

  it("la segunda cae hora y media despues", () => {
    expect(horarioApilado("2026-11-06", 1)?.inicio).toBe("2026-11-06T09:30:00");
  });

  it("la quinta cae a las 14:00", () => {
    expect(horarioApilado("2026-11-06", 4)?.inicio).toBe("2026-11-06T14:00:00");
  });

  /** 08:00 + 8 x 1:30 = 20:00, el fin del ultimo turno: todavia sin topear. */
  it("la novena cae justo en el tope y no se marca", () => {
    const r = horarioApilado("2026-11-06", 8);
    expect(r?.inicio).toBe("2026-11-06T20:00:00");
    expect(r?.topeado).toBe(false);
  });

  /**
   * Sin tope, la undecima daria 24:30: `instanteDe` la rechaza y la OT se
   * quedaria SIN EVENTO, en silencio. Comparten las 20:00 y se marcan.
   */
  it("de la decima en adelante comparten las 20:00 y quedan marcadas", () => {
    for (const n of [9, 10, 25]) {
      const r = horarioApilado("2026-11-06", n);
      expect(r?.inicio).toBe("2026-11-06T20:00:00");
      expect(r?.topeado).toBe(true);
    }
  });

  it("una fecha mal formada no produce horario", () => {
    for (const f of ["", "06/11/2026", "2026-13-01", "ayer"]) {
      expect(horarioApilado(f, 0)).toBeNull();
    }
  });

  it("ningun horario cruza la medianoche", () => {
    for (let n = 0; n < 30; n++) {
      expect(horarioApilado("2026-11-06", n)?.fin.slice(0, 10)).toBe("2026-11-06");
    }
  });
});

describe("como se agrupa el apilado", () => {
  it("la especialidad decide el grupo", () => {
    expect(claveDeApilado("MECÁNICO")).toBe(claveDeApilado("MECÁNICO"));
    expect(claveDeApilado("MECÁNICO")).not.toBe(claveDeApilado("ELÉCTRICO"));
  });

  /** Hay una OT en produccion con la especialidad vacia. No puede reventar ni
      caer en el monton de las mecanicas. */
  it("las de especialidad vacia son su propio grupo", () => {
    const sinNada = claveDeApilado(null);
    expect(sinNada).toBe(claveDeApilado(""));
    expect(sinNada).toBe(claveDeApilado("   "));
    expect(sinNada).not.toBe(claveDeApilado("MECÁNICO"));
  });
});
