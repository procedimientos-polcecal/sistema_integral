import { describe, it, expect } from "vitest";
import {
  ordenSugerido, moverEnLista, asignarOrden, aplicarOrdenManual, ESTA_PENDIENTE,
} from "./prioridad";

const HOY = "2026-08-26";

describe("ESTA_PENDIENTE", () => {
  it("son los estados en los que la orden todavía espera algo", () => {
    expect(ESTA_PENDIENTE).toEqual(["ATRASADO", "EN_PROCESO", "POR_HACER"]);
  });
});

describe("ordenSugerido", () => {
  const ordenes = [
    { id: "a", ot_number: 10, estado: "POR_HACER", prioridad: "BAJA", fecha: "2026-08-01", proxima_fecha: null },
    { id: "b", ot_number: 11, estado: "ATRASADO", prioridad: "BAJA", fecha: "2026-08-20", proxima_fecha: null },
    { id: "c", ot_number: 12, estado: "POR_HACER", prioridad: "ALTA", fecha: "2026-08-15", proxima_fecha: null },
    { id: "d", ot_number: 13, estado: "EN_PROCESO", prioridad: "ALTA", fecha: "2026-08-10", proxima_fecha: null },
  ];

  it("pone primero lo atrasado, aunque sea de prioridad baja", () => {
    // Ya se pasó de fecha: no importa con qué prioridad nació.
    expect(ordenSugerido(ordenes, HOY)[0].id).toBe("b");
  });

  it("después las de prioridad alta, y entre ellas la más vieja", () => {
    const [, segundo, tercero] = ordenSugerido(ordenes, HOY);
    expect(segundo.id).toBe("d");
    expect(tercero.id).toBe("c");
  });

  it("deja las de prioridad baja al final", () => {
    expect(ordenSugerido(ordenes, HOY).at(-1)!.id).toBe("a");
  });

  it("no rompe con prioridad desconocida o vacía", () => {
    const raras = [
      { id: "x", ot_number: 1, estado: "POR_HACER", prioridad: null, fecha: "2026-08-01" },
      { id: "y", ot_number: 2, estado: "POR_HACER", prioridad: "URGENTÍSIMO", fecha: "2026-08-02" },
    ];
    expect(ordenSugerido(raras, HOY)).toHaveLength(2);
  });
});

describe("moverEnLista", () => {
  const lista = ["a", "b", "c", "d"];

  it("mueve un elemento hacia abajo", () => {
    expect(moverEnLista(lista, 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("mueve un elemento hacia arriba", () => {
    expect(moverEnLista(lista, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("no toca la lista original", () => {
    moverEnLista(lista, 0, 3);
    expect(lista).toEqual(["a", "b", "c", "d"]);
  });

  it("moverlo a su mismo lugar no cambia nada", () => {
    expect(moverEnLista(lista, 1, 1)).toEqual(lista);
  });

  it("ignora posiciones que no existen", () => {
    expect(moverEnLista(lista, 9, 1)).toEqual(lista);
    expect(moverEnLista(lista, 1, -3)).toEqual(lista);
  });
});

describe("asignarOrden", () => {
  it("numera de arriba hacia abajo desde cero", () => {
    expect(asignarOrden([{ id: "a" }, { id: "b" }, { id: "c" }])).toEqual([
      { id: "a", orden: 0 },
      { id: "b", orden: 1 },
      { id: "c", orden: 2 },
    ]);
  });
});

describe("aplicarOrdenManual", () => {
  const ordenes = [
    { id: "a", ot_number: 10, estado: "POR_HACER", prioridad: "ALTA", fecha: "2026-08-01", orden_manual: 2 },
    { id: "b", ot_number: 11, estado: "POR_HACER", prioridad: "BAJA", fecha: "2026-08-02", orden_manual: 0 },
    { id: "c", ot_number: 12, estado: "POR_HACER", prioridad: "MEDIA", fecha: "2026-08-03", orden_manual: 1 },
  ];

  it("manda el orden que alguien puso a mano", () => {
    // Aunque "a" sea la de prioridad alta: si alguien la puso tercera, va
    // tercera. Para eso existe el orden manual.
    expect(aplicarOrdenManual(ordenes, HOY).map((o) => o.id)).toEqual(["b", "c", "a"]);
  });

  it("las que nadie ordenó van después, por el orden sugerido", () => {
    const conSuelta = [
      ...ordenes,
      { id: "d", ot_number: 13, estado: "ATRASADO", prioridad: "BAJA", fecha: "2026-08-04", orden_manual: null },
    ];
    // "d" está atrasada, pero las ordenadas a mano van primero igual.
    expect(aplicarOrdenManual(conSuelta, HOY).map((o) => o.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("sin ninguna ordenada a mano, queda el orden sugerido", () => {
    const sueltas = ordenes.map((o) => ({ ...o, orden_manual: null }));
    expect(aplicarOrdenManual(sueltas, HOY).map((o) => o.id)).toEqual(
      ordenSugerido(sueltas, HOY).map((o) => o.id)
    );
  });

  it("desempata por número de OT si dos quedaron con el mismo orden", () => {
    // Pasa cuando se ordenó una lista filtrada: las de afuera conservan el suyo.
    const empatadas = [
      { id: "x", ot_number: 20, estado: "POR_HACER", prioridad: "BAJA", fecha: "2026-08-01", orden_manual: 0 },
      { id: "y", ot_number: 19, estado: "POR_HACER", prioridad: "BAJA", fecha: "2026-08-01", orden_manual: 0 },
    ];
    expect(aplicarOrdenManual(empatadas, HOY).map((o) => o.id)).toEqual(["y", "x"]);
  });
});
