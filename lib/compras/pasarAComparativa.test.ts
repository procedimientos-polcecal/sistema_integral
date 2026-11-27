import { describe, it, expect } from "vitest";
import {
  repartirSegunPuedenPasar,
  motivoPorElQueNoPasa,
  type RiParaMover,
} from "./pasarAComparativa";

const ri = (p: Partial<RiParaMover> = {}): RiParaMover => ({
  id: "r1",
  nro_ri: 100,
  estado_compra: "SIN_INICIAR",
  estado_aprobacion: "APROBADA",
  ...p,
});

describe("motivoPorElQueNoPasa", () => {
  it("un SIN_INICIAR aprobado pasa", () => {
    expect(motivoPorElQueNoPasa(ri())).toBeNull();
  });

  /*
   * El orden de los dos controles importa para el mensaje, no para el
   * resultado: un RI que no está aprobado **y** ya arrancó la compra es una
   * contradicción, y decir «no está aprobado» explica el caso mejor que decir
   * «ya está en otra etapa».
   */
  it("sin aprobación no pasa, aunque esté SIN_INICIAR", () => {
    expect(motivoPorElQueNoPasa(ri({ estado_aprobacion: "PENDIENTE" }))).toBe(
      "todavía no está aprobado"
    );
  });

  /*
   * Los 27 DENEGADA que hoy siguen en SIN_INICIAR son filas viejas: desde que
   * el PATCH pone `estado_compra: "DENEGADO"` al denegar, un pedido denegado no
   * se queda ahí. Entran igual al filtro para que una selección «todos» no los
   * reviva.
   */
  it("un pedido denegado no revive", () => {
    expect(motivoPorElQueNoPasa(ri({ estado_aprobacion: "DENEGADA" }))).toBe(
      "todavía no está aprobado"
    );
  });

  it("el que ya está en comparativa no se mueve", () => {
    expect(motivoPorElQueNoPasa(ri({ estado_compra: "EN_COMPARATIVA" }))).toBe(
      "ya está en comparativa"
    );
  });

  /*
   * Un pedido en espera está frenado a propósito —hoy son 20— y sacarlo de ahí
   * es una decisión con su propio botón, que además guarda de qué etapa venía
   * en `etapa_previa`. Una acción masiva que lo arrastre pierde ese dato.
   */
  it("el que está en espera no se arrastra", () => {
    expect(motivoPorElQueNoPasa(ri({ estado_compra: "EN_ESPERA" }))).toBe(
      "está en espera y hay que sacarlo desde su ficha"
    );
  });

  it("el que ya avanzó más no retrocede", () => {
    expect(motivoPorElQueNoPasa(ri({ estado_compra: "PEDIDO" }))).toBe(
      "ya está más adelante en el circuito"
    );
  });
});

describe("repartirSegunPuedenPasar", () => {
  it("separa los que pasan de los que no, y dice por qué", () => {
    const { pasan, noPasan } = repartirSegunPuedenPasar([
      ri({ id: "a", nro_ri: 1 }),
      ri({ id: "b", nro_ri: 2, estado_aprobacion: "PENDIENTE" }),
      ri({ id: "c", nro_ri: 3 }),
    ]);

    expect(pasan.map((r) => r.id)).toEqual(["a", "c"]);
    expect(noPasan).toEqual([{ nro_ri: 2, motivo: "todavía no está aprobado" }]);
  });

  it("de una lista vacía no pasa ninguno", () => {
    expect(repartirSegunPuedenPasar([])).toEqual({ pasan: [], noPasan: [] });
  });

  it("con todos aptos no hay motivos que informar", () => {
    const { pasan, noPasan } = repartirSegunPuedenPasar([ri({ id: "a" }), ri({ id: "b" })]);
    expect(pasan).toHaveLength(2);
    expect(noPasan).toEqual([]);
  });
});
