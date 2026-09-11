import { describe, it, expect } from "vitest";
import {
  ORDEN_DE_HORARIOS,
  estadoDeLaOrden,
  proximoHorario,
  horariosSalteados,
  tiemposDeLaOrden,
  minutosEnCurso,
  minutosDeLaHoraTipeada,
  instanteEnElDia,
  horariosConLoTipeado,
} from "./orden";
import type { HorariosDeOrden } from "./types";

const VACIA: HorariosDeOrden = {
  entrada_predio: null,
  inicio_carga: null,
  fin_carga: null,
  salida_predio: null,
};

/** Un camión que entró 10:00, cargó de 10:20 a 11:00 y salió 11:15. */
const COMPLETA: HorariosDeOrden = {
  entrada_predio: "2026-09-08T13:00:00.000Z",
  inicio_carga: "2026-09-08T13:20:00.000Z",
  fin_carga: "2026-09-08T14:00:00.000Z",
  salida_predio: "2026-09-08T14:15:00.000Z",
};

describe("estadoDeLaOrden", () => {
  it("recorre los cinco estados a medida que se marcan los horarios", () => {
    expect(estadoDeLaOrden(VACIA)).toBe("esperando");
    expect(estadoDeLaOrden({ ...VACIA, entrada_predio: COMPLETA.entrada_predio })).toBe("en_predio");
    expect(
      estadoDeLaOrden({
        ...VACIA,
        entrada_predio: COMPLETA.entrada_predio,
        inicio_carga: COMPLETA.inicio_carga,
      })
    ).toBe("cargando");
    expect(estadoDeLaOrden({ ...COMPLETA, salida_predio: null })).toBe("cargado");
    expect(estadoDeLaOrden(COMPLETA)).toBe("cerrada");
  });

  /**
   * El hito más avanzado manda, y el hueco se informa aparte.
   *
   * Si el estado se decidiera por "el primero que falta", una orden a la que se
   * le olvidó marcar la entrada quedaría en `esperando` con el camión ya
   * cargado, y la pantalla le ofrecería marcar la entrada de un camión que se
   * fue hace dos horas.
   */
  it("no retrocede cuando falta un horario intermedio", () => {
    const conHueco: HorariosDeOrden = { ...COMPLETA, inicio_carga: null, salida_predio: null };
    expect(estadoDeLaOrden(conHueco)).toBe("cargado");
    expect(horariosSalteados(conHueco)).toEqual(["inicio_carga"]);
  });

  it("una orden completa no tiene horarios salteados", () => {
    expect(horariosSalteados(COMPLETA)).toEqual([]);
    expect(horariosSalteados(VACIA)).toEqual([]);
  });
});

describe("proximoHorario", () => {
  it("es el que sigue al hito alcanzado, y null cuando la orden está cerrada", () => {
    expect(proximoHorario(VACIA)).toBe("entrada_predio");
    expect(proximoHorario({ ...VACIA, entrada_predio: COMPLETA.entrada_predio })).toBe("inicio_carga");
    expect(proximoHorario({ ...COMPLETA, fin_carga: null, salida_predio: null })).toBe("fin_carga");
    expect(proximoHorario({ ...COMPLETA, salida_predio: null })).toBe("salida_predio");
    expect(proximoHorario(COMPLETA)).toBeNull();
  });

  it("no vuelve a pedir un horario salteado", () => {
    const conHueco: HorariosDeOrden = { ...COMPLETA, inicio_carga: null, salida_predio: null };
    expect(proximoHorario(conHueco)).toBe("salida_predio");
  });

  it("los cuatro horarios están en el orden en que ocurren", () => {
    expect(ORDEN_DE_HORARIOS).toEqual([
      "entrada_predio",
      "inicio_carga",
      "fin_carga",
      "salida_predio",
    ]);
  });
});

describe("tiemposDeLaOrden", () => {
  it("son restas, en minutos", () => {
    expect(tiemposDeLaOrden(COMPLETA)).toEqual({ carga: 40, predio: 75 });
  });

  it("falta un extremo y el tiempo es null, no cero", () => {
    expect(tiemposDeLaOrden({ ...COMPLETA, fin_carga: null })).toEqual({ carga: null, predio: 75 });
    expect(tiemposDeLaOrden({ ...COMPLETA, entrada_predio: null })).toEqual({
      carga: 40,
      predio: null,
    });
    expect(tiemposDeLaOrden(VACIA)).toEqual({ carga: null, predio: null });
  });

  /**
   * Un tiempo negativo es un error de carga y se muestra, no se recorta.
   *
   * Es la misma decisión que Producción con una producción negativa: recortarla
   * a cero esconde justo lo que hay que corregir.
   */
  it("un horario mal corregido da negativo y no se recorta", () => {
    const alReves: HorariosDeOrden = {
      ...COMPLETA,
      inicio_carga: "2026-09-08T14:30:00.000Z",
    };
    expect(tiemposDeLaOrden(alReves).carga).toBe(-30);
  });
});

describe("minutosEnCurso", () => {
  const ahora = new Date("2026-09-08T14:42:00.000Z");

  it("mide el tramo abierto: cuánto hace que está cargando", () => {
    const cargando: HorariosDeOrden = { ...COMPLETA, fin_carga: null, salida_predio: null };
    expect(minutosEnCurso(cargando, ahora)).toBe(82);
  });

  it("mide desde la entrada cuando todavía no empezó a cargar", () => {
    const enPredio: HorariosDeOrden = { ...VACIA, entrada_predio: COMPLETA.entrada_predio };
    expect(minutosEnCurso(enPredio, ahora)).toBe(102);
  });

  it("una orden cerrada o que no llegó no tiene tramo en curso", () => {
    expect(minutosEnCurso(COMPLETA, ahora)).toBeNull();
    expect(minutosEnCurso(VACIA, ahora)).toBeNull();
  });
});

describe("las horas que se tipean", () => {
  it("lee una hora tipeada y rechaza lo que no lo es", () => {
    expect(minutosDeLaHoraTipeada("07:35")).toBe(7 * 60 + 35);
    expect(minutosDeLaHoraTipeada("7:35")).toBe(7 * 60 + 35);
    expect(minutosDeLaHoraTipeada("07:35:00")).toBe(7 * 60 + 35);
    expect(minutosDeLaHoraTipeada("00:00")).toBe(0);
    // Estricta a propósito: adivinar qué quiso poner alguien es cómo entra un
    // horario equivocado que después nadie distingue de uno real.
    expect(minutosDeLaHoraTipeada("735")).toBeNull();
    expect(minutosDeLaHoraTipeada("7.35")).toBeNull();
    expect(minutosDeLaHoraTipeada("25:00")).toBeNull();
    expect(minutosDeLaHoraTipeada("07:60")).toBeNull();
    expect(minutosDeLaHoraTipeada("")).toBeNull();
    expect(minutosDeLaHoraTipeada(null)).toBeNull();
  });

  /** La hora se ancla a la fecha de la orden y en hora de Argentina (UTC-3). */
  it("ancla la hora al día de la orden", () => {
    expect(instanteEnElDia(7 * 60 + 35, "2026-09-11")).toBe("2026-09-11T10:35:00.000Z");
    expect(instanteEnElDia(0, "2026-09-11")).toBe("2026-09-11T03:00:00.000Z");
    expect(instanteEnElDia(null, "2026-09-11")).toBeNull();
  });
});

describe("horariosConLoTipeado", () => {
  const vacia = {
    entrada_predio: null,
    inicio_carga: null,
    fin_carga: null,
    salida_predio: null,
  };

  it("ancla lo que se tipeó y deja lo demás como estaba", () => {
    const r = horariosConLoTipeado(
      { ...vacia, entrada_predio: "2026-09-11T13:00:00.000Z" },
      { inicio_carga: "11:30" },
      "2026-09-11"
    );
    expect(r.entrada_predio).toBe("2026-09-11T13:00:00.000Z");
    expect(r.inicio_carga).toBe("2026-09-11T14:30:00.000Z");
    expect(r.fin_carga).toBeNull();
  });

  /**
   * El caso que obliga a recorrerlos en orden: un camión que termina de cargar
   * 23:40 y sale 00:30. Con la fecha de la orden para los dos, el tiempo en
   * predio daría menos veintitrés horas.
   */
  it("la salida después de medianoche cae en el día siguiente", () => {
    const r = horariosConLoTipeado(
      vacia,
      { entrada_predio: "22:50", inicio_carga: "23:10", fin_carga: "23:40", salida_predio: "00:30" },
      "2026-09-11"
    );
    expect(r.fin_carga).toBe("2026-09-12T02:40:00.000Z");
    expect(r.salida_predio).toBe("2026-09-12T03:30:00.000Z");
    // Cien minutos en predio, no menos veintitrés horas.
    expect(tiemposDeLaOrden(r).predio).toBe(100);
  });

  /**
   * Y el que no hay que "arreglar": una salida cinco minutos antes del fin de
   * carga es un error de tipeo, no un cruce de medianoche. Queda negativo para
   * que se vea en rojo.
   */
  it("un salto corto hacia atrás queda negativo y no se corre de día", () => {
    const r = horariosConLoTipeado(
      vacia,
      { inicio_carga: "10:00", fin_carga: "11:00", salida_predio: "10:55" },
      "2026-09-11"
    );
    expect(r.salida_predio).toBe("2026-09-11T13:55:00.000Z");
    expect(tiemposDeLaOrden(r).carga).toBe(60);
  });

  it("una cadena vacía borra el horario", () => {
    const r = horariosConLoTipeado(
      { ...vacia, salida_predio: "2026-09-11T20:00:00.000Z" },
      { salida_predio: "" },
      "2026-09-11"
    );
    expect(r.salida_predio).toBeNull();
  });

  /**
   * Editar un horario no vuelve a anclar los otros. Mover la entrada cambiaría
   * la referencia de la salida, y re-anclarla correría en silencio una hora que
   * nadie tocó.
   */
  it("no toca los horarios que ya estaban guardados", () => {
    const r = horariosConLoTipeado(
      { ...vacia, entrada_predio: "2026-09-11T13:00:00.000Z", salida_predio: "2026-09-12T02:00:00.000Z" },
      { entrada_predio: "08:00" },
      "2026-09-11"
    );
    expect(r.entrada_predio).toBe("2026-09-11T11:00:00.000Z");
    expect(r.salida_predio).toBe("2026-09-12T02:00:00.000Z");
  });
});
