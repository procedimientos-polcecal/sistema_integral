import { describe, it, expect } from "vitest";
import {
  llegadasPorRequerimiento, textoDeLaLlegada, elEstadoNoLoDice,
  type EntradaConRequerimiento,
} from "./entradaAlPanol";

const entrada = (p: Partial<EntradaConRequerimiento> = {}): EntradaConRequerimiento => ({
  requerimiento_id: "r1",
  tipo: "entrada",
  fecha: "2026-08-21",
  ...p,
});

// La fecha se lee como la muestra la pantalla; acá alcanza con algo estable.
const comoSeLee = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7);

describe("que pedidos ya llegaron al panol", () => {
  it("junta la entrada con su requerimiento", () => {
    const m = llegadasPorRequerimiento([entrada()]);
    expect(m.get("r1")).toEqual({ fecha: "2026-08-21", cuantas: 1 });
  });

  it("una salida no es una recepcion", () => {
    expect(llegadasPorRequerimiento([entrada({ tipo: "salida" })]).size).toBe(0);
  });

  it("un movimiento sin requerimiento no aporta nada", () => {
    expect(llegadasPorRequerimiento([
      entrada({ requerimiento_id: null }),
      entrada({ requerimiento_id: "   " }),
    ]).size).toBe(0);
  });

  it("con dos entregas se queda con la PRIMERA y las cuenta", () => {
    // La pregunta que contesta es "hace cuanto que esto esta aca": para un
    // pedido que llego en dos partes, la fecha honesta es la primera.
    const m = llegadasPorRequerimiento([
      entrada({ fecha: "2026-09-30" }),
      entrada({ fecha: "2026-08-21" }),
    ]);
    expect(m.get("r1")).toEqual({ fecha: "2026-08-21", cuantas: 2 });
  });

  it("recorta el instante a su dia", () => {
    // El kardex guarda `date`, pero una fila que venga con hora no tiene que
    // cambiar como se compara ni como se muestra.
    const m = llegadasPorRequerimiento([entrada({ fecha: "2026-08-21T13:45:00+00:00" })]);
    expect(m.get("r1")?.fecha).toBe("2026-08-21");
  });

  it("una entrada sin fecha no pisa a una que si la tiene", () => {
    // Diria "llego" sin poder decir cuando, que es menos de lo que ya se sabia.
    const m = llegadasPorRequerimiento([
      entrada({ fecha: "2026-08-21" }),
      entrada({ fecha: null }),
    ]);
    expect(m.get("r1")).toEqual({ fecha: "2026-08-21", cuantas: 2 });
  });

  it("sin ninguna fecha igual dice que llego", () => {
    const m = llegadasPorRequerimiento([entrada({ fecha: null })]);
    expect(m.get("r1")).toEqual({ fecha: null, cuantas: 1 });
  });

  it("separa los requerimientos", () => {
    const m = llegadasPorRequerimiento([
      entrada({ requerimiento_id: "r1" }),
      entrada({ requerimiento_id: "r2", fecha: "2026-11-17" }),
    ]);
    expect(m.size).toBe(2);
    expect(m.get("r2")?.fecha).toBe("2026-11-17");
  });
});

describe("lo que dice la fila en vez de ofrecer un reclamo", () => {
  it("nombra el panol y el dia", () => {
    expect(textoDeLaLlegada({ fecha: "2026-08-21", cuantas: 1 }, comoSeLee))
      .toBe("Ya entró al pañol el 21/08");
  });

  it("con varias entregas lo dice, porque cambia la lectura", () => {
    expect(textoDeLaLlegada({ fecha: "2026-08-21", cuantas: 3 }, comoSeLee))
      .toBe("Ya entró al pañol el 21/08 en 3 entregas");
  });

  it("sin fecha no inventa una", () => {
    expect(textoDeLaLlegada({ fecha: null, cuantas: 1 }, comoSeLee))
      .toBe("Ya entró al pañol");
  });
});

describe("cuando la fila tiene algo que agregar", () => {
  it("un pedido que no dice como termino acepta la nota", () => {
    for (const e of ["SIN_INICIAR", "EN_COMPARATIVA", "PARA_COMPRAR", "APROBADO", "PEDIDO"]) {
      expect(elEstadoNoLoDice(e)).toBe(true);
    }
  });

  it("EN_ESPERA tambien, que es donde mas sirve", () => {
    // Un pedido frenado a propósito cuya mercadería ya está guardada es
    // justo el que nadie vuelve a mirar.
    expect(elEstadoNoLoDice("EN_ESPERA")).toBe(true);
  });

  it("sobre un RECIBIDO seria repetir la etiqueta de al lado", () => {
    expect(elEstadoNoLoDice("RECIBIDO")).toBe(false);
  });

  it("sobre un DENEGADO seria contradecirla", () => {
    expect(elEstadoNoLoDice("DENEGADO")).toBe(false);
  });

  it("sin estado la nota entra: el dato que falta es el estado, no la entrada", () => {
    expect(elEstadoNoLoDice(null)).toBe(true);
  });
});
