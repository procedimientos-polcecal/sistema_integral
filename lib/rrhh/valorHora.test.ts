import { describe, it, expect } from "vitest";
import { valorHoraDe, conValorHoraPlano } from "./valorHora";

describe("valorHoraDe", () => {
  it("lee el embed cuando viene como objeto, que es la forma de hoy", () => {
    expect(valorHoraDe({ rrhh_empleados_datos: { valor_hora_normal: 3500 } })).toBe(3500);
  });

  /**
   * PostgREST devuelve un arreglo cuando no puede probar que la relación es de
   * uno a uno. Hoy sí puede —`empleado_id` es clave primaria y foránea a la
   * vez— pero la forma no es un contrato: si algún día un `select` la cambia,
   * lo que se rompe sin esto es un recibo, no una pantalla.
   */
  it("lee el embed cuando viene como arreglo de una fila", () => {
    expect(valorHoraDe({ rrhh_empleados_datos: [{ valor_hora_normal: 3500 }] })).toBe(3500);
  });

  /** numeric(12,2) puede llegar como texto por la API. */
  it("acepta el numero como texto, que es como viaja un numeric", () => {
    expect(valorHoraDe({ rrhh_empleados_datos: { valor_hora_normal: "3500.50" } })).toBe(3500.5);
  });

  it("un empleado sin fila satelite da 0 y no NaN", () => {
    expect(valorHoraDe({ rrhh_empleados_datos: null })).toBe(0);
    expect(valorHoraDe({ rrhh_empleados_datos: [] })).toBe(0);
    expect(valorHoraDe({})).toBe(0);
    expect(valorHoraDe(null)).toBe(0);
  });

  /**
   * El caso que motiva toda la funcion: `Number(undefined)` es `NaN`, y un NaN
   * multiplicado por horas no rompe nada — se propaga callado hasta el recibo.
   */
  it("un valor ilegible da 0 y no NaN", () => {
    expect(valorHoraDe({ rrhh_empleados_datos: { valor_hora_normal: null } })).toBe(0);
    expect(valorHoraDe({ rrhh_empleados_datos: { valor_hora_normal: "ninguno" } })).toBe(0);
  });

  it("el cero se devuelve cero, que es un valor cargado y no un faltante", () => {
    expect(valorHoraDe({ rrhh_empleados_datos: { valor_hora_normal: 0 } })).toBe(0);
  });
});

describe("conValorHoraPlano", () => {
  it("deja el valor hora plano y no toca el resto de la fila", () => {
    const filas = [
      { id: "a", legajo: "101", rrhh_empleados_datos: { valor_hora_normal: 3500 } },
      { id: "b", legajo: "102", rrhh_empleados_datos: null },
    ];
    expect(conValorHoraPlano(filas)).toEqual([
      { id: "a", legajo: "101", rrhh_empleados_datos: { valor_hora_normal: 3500 }, valor_hora_normal: 3500 },
      { id: "b", legajo: "102", rrhh_empleados_datos: null, valor_hora_normal: 0 },
    ]);
  });

  it("sin filas devuelve una lista vacia, no revienta", () => {
    expect(conValorHoraPlano(null)).toEqual([]);
    expect(conValorHoraPlano(undefined)).toEqual([]);
  });
});
