import { describe, it, expect } from "vitest";
import { filasPorLeer, type FilaOcupada } from "./desdeLaPlanilla";

// CODIGO, DESCRIPCION, ENTRADAS, SALIDAS, TOTAL, VEGETAL, RESIDUAL, FECHA
const fila = (codigo: string, entradas: number | "", salidas: number | "", serial: number) =>
  [codigo, "", entradas, salidas, "", "", "", serial];

/** 46276 = 2026-09-11; 46277 = 2026-09-12. */
const LUNES = 46276;
const MARTES = 46277;

/** La planilla entera: encabezado y tres renglones, filas 1 a 4. */
const PLANILLA = [
  ["CODIGO", "DESCRIPCION", "ENTRADAS", "SALIDAS"],
  fila("00003", 20.58, "", LUNES),
  fila("00015", "", 37, LUNES),
  fila("00007", 19.14, "", MARTES),
];

const ocupada = (
  fila: number,
  fecha: string,
  entradas: number | null,
  salidas: number | null
): [number, FilaOcupada] => [fila, { fecha, entradas, salidas }];

describe("filasPorLeer", () => {
  it("devuelve las filas que todavía no son de ningún movimiento", () => {
    const r = filasPorLeer(new Map([ocupada(2, "2026-09-11", 20.58, null)]), PLANILLA);
    expect(r.nuevas.map((n) => n.fila)).toEqual([3, 4]);
  });

  it("una fila ocupada no se vuelve a leer: es lo único que evita el lazo", () => {
    const todas = new Map([
      ocupada(2, "2026-09-11", 20.58, null),
      ocupada(3, "2026-09-11", null, 37),
      ocupada(4, "2026-09-12", 19.14, null),
    ]);
    expect(filasPorLeer(todas, PLANILLA).nuevas).toEqual([]);
  });

  it("salta el encabezado", () => {
    expect(filasPorLeer(new Map(), PLANILLA).nuevas.map((n) => n.fila)).toEqual([2, 3, 4]);
  });

  it("una fila vacía no es una fila nueva", () => {
    const conHuecos = [...PLANILLA, ["", ""], ["", " "]];
    expect(filasPorLeer(new Map(), conHuecos).nuevas.map((n) => n.fila)).toEqual([2, 3, 4]);
  });

  // Review Focus 1.
  it("una fila con entrada Y salida a la vez no se importa: se informa", () => {
    // `movimientoDesdeElRenglon` toma la entrada y pierde la salida en
    // silencio. En una importación de una vez nadie lo miró; corriendo todos
    // los días, ese renglón entraría mal para siempre.
    const rara = [...PLANILLA, fila("00003", 20.58, 37, MARTES)];
    const r = filasPorLeer(new Map(), rara);
    expect(r.nuevas.map((n) => n.fila)).toEqual([2, 3, 4]);
    expect(r.ambiguas).toHaveLength(1);
    expect(r.ambiguas[0].fila).toBe(5);
    expect(r.ambiguas[0].motivo).toMatch(/entrada y salida/i);
  });

  // Review Focus 2.
  it("avisa cuando una fila ya leída cambió de contenido en la planilla", () => {
    // Alguien corrigió 20,58 por 21,58 en una fila que el SdG ya importó. No
    // se corrige sola —el saldo de todo lo que sigue cambiaría— pero tiene que
    // verse.
    const r = filasPorLeer(new Map([ocupada(2, "2026-09-11", 21.58, null)]), PLANILLA);
    expect(r.cambiadas).toHaveLength(1);
    expect(r.cambiadas[0].fila).toBe(2);
    expect(r.cambiadas[0].motivo).toContain("21.58");
    expect(r.cambiadas[0].motivo).toContain("20.58");
  });

  it("una fila ocupada que no cambió no se informa", () => {
    const r = filasPorLeer(new Map([ocupada(2, "2026-09-11", 20.58, null)]), PLANILLA);
    expect(r.cambiadas).toEqual([]);
  });

  // Review Focus 3.
  it("si la planilla devuelve menos filas que las ocupadas, no rompe ni crea nada", () => {
    const masAllaDelFinal = new Map([
      ocupada(2, "2026-09-11", 20.58, null),
      ocupada(99, "2026-09-11", 1, null),
    ]);
    const r = filasPorLeer(masAllaDelFinal, PLANILLA);
    expect(r.nuevas.map((n) => n.fila)).toEqual([3, 4]);
    expect(r.desaparecidas).toEqual([99]);
  });

  it("una planilla vacía no es un error", () => {
    expect(filasPorLeer(new Map(), [])).toEqual({
      nuevas: [],
      cambiadas: [],
      ambiguas: [],
      desaparecidas: [],
    });
  });
});
