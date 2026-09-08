import { describe, it, expect } from "vitest";
import {
  ORDEN_DE_HORARIOS,
  estadoDeLaOrden,
  proximoHorario,
  horariosSalteados,
  tiemposDeLaOrden,
  minutosEnCurso,
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
