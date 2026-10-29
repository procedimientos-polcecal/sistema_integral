import { describe, it, expect } from "vitest";
import {
  loQueSeGuardaDelContraste, TOPE_DE_DIVERGENCIAS,
} from "./divergencias";
import type { Contraste, Divergencia } from "./contraste";

const una = (ot_number: number, campo = "la fecha de ejecución"): Divergencia => ({
  ot_number, campo, enElSistema: "2026-11-03", enLaPlanilla: "2026-11-02",
});

const contraste = (p: Partial<Contraste>): Contraste => ({
  divergencias: [], enLaCola: [], soloEnElSistema: [], soloEnLaPlanilla: [], ...p,
});

describe("loQueSeGuardaDelContraste", () => {
  it("guarda cada divergencia con los dos lados", () => {
    const r = loQueSeGuardaDelContraste(contraste({ divergencias: [una(2896)] }));
    expect(r.filas).toEqual([{
      ot_number: 2896, campo: "la fecha de ejecución",
      en_el_sistema: "2026-11-03", en_la_planilla: "2026-11-02",
    }]);
    expect(r.total).toBe(1);
    expect(r.recortadas).toBe(0);
  });

  /**
   * Una OT con dos campos corridos son dos filas, y la clave de la tabla es
   * `(ot_number, campo)` justamente para eso: la corrida siguiente las pisa en
   * vez de duplicarlas.
   */
  it("una orden con dos problemas deja dos filas", () => {
    const r = loQueSeGuardaDelContraste(contraste({
      divergencias: [una(2896, "la fecha de ejecución"), una(2896, "el estado")],
    }));
    expect(r.filas).toHaveLength(2);
    expect(r.filas.map((f) => f.campo)).toEqual(["la fecha de ejecución", "el estado"]);
  });

  /**
   * Las tres listas que NO se guardan. Es la mitad que importa: un aviso que
   * suena todos los días por algo normal termina en que alguien apaga las
   * notificaciones.
   */
  it("no guarda la cola, ni lo que está de un lado solo", () => {
    const r = loQueSeGuardaDelContraste(contraste({
      enLaCola: [2908], soloEnElSistema: [2930], soloEnLaPlanilla: [2931],
    }));
    expect(r.filas).toEqual([]);
    expect(r.total).toBe(0);
  });

  /**
   * El freno. Si se cae una fórmula de la planilla, el contraste encuentra una
   * divergencia por orden; escribir dos mil filas para decir "se cayó la
   * planilla" es ruido caro. Se guarda el tope y se cuenta el resto.
   */
  it("recorta en el tope y dice cuántas quedaron afuera", () => {
    const muchas = Array.from({ length: TOPE_DE_DIVERGENCIAS + 37 }, (_, i) => una(1000 + i));
    const r = loQueSeGuardaDelContraste(contraste({ divergencias: muchas }));
    expect(r.filas).toHaveLength(TOPE_DE_DIVERGENCIAS);
    expect(r.total).toBe(TOPE_DE_DIVERGENCIAS + 37);
    expect(r.recortadas).toBe(37);
  });

  it("sin divergencias no hay nada que guardar", () => {
    const r = loQueSeGuardaDelContraste(contraste({}));
    expect(r).toEqual({ filas: [], total: 0, recortadas: 0 });
  });
});
