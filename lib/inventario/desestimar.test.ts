import { describe, it, expect } from "vitest";
import {
  sigueDesestimado, desestimacionesPorArticulo, textoDeLaDesestimacion,
  type Desestimacion,
} from "./desestimar";

const d = (p: Partial<Desestimacion> = {}): Desestimacion => ({
  articulo_id: "a1",
  ultimo_movimiento: "2026-09-20",
  motivo: null,
  desestimado_por_nombre: "Juan Pérez",
  desestimado_en: "2026-09-21T10:00:00+00:00",
  ...p,
});

const comoSeLee = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7);

describe("si la decision de no reponer sigue en pie", () => {
  it("sin desestimacion no hay nada que sostener", () => {
    expect(sigueDesestimado(undefined, "2026-10-01")).toBe(false);
  });

  it("sigue mientras el ultimo movimiento sea el mismo", () => {
    expect(sigueDesestimado(d(), "2026-09-20")).toBe(true);
  });

  it("un movimiento del MISMO dia no la levanta", () => {
    // Es la decision que evita que el boton parezca no funcionar: los
    // movimientos llegan en tandas del mismo dia -mediana 0,1 dias entre dos
    // consecutivos- y una tanda importada cinco minutos despues traeria filas
    // de dias que ya estaban a la vista.
    expect(sigueDesestimado(d({ ultimo_movimiento: "2026-09-20" }), "2026-09-20")).toBe(true);
  });

  it("un movimiento de un dia posterior la levanta", () => {
    expect(sigueDesestimado(d(), "2026-09-21")).toBe(false);
  });

  it("uno anterior tampoco la levanta", () => {
    // Puede pasar: la planilla trae filas atrasadas, y una fila vieja no es un
    // hecho nuevo.
    expect(sigueDesestimado(d(), "2026-08-01")).toBe(true);
  });

  it("sin movimientos del lado del articulo, sigue", () => {
    expect(sigueDesestimado(d(), null)).toBe(true);
  });

  it("desestimado sin ningun movimiento, cualquiera lo despierta", () => {
    expect(sigueDesestimado(d({ ultimo_movimiento: null }), "2026-01-02")).toBe(false);
    expect(sigueDesestimado(d({ ultimo_movimiento: null }), null)).toBe(true);
  });

  it("compara el dia y no el instante", () => {
    // `inventario_movimientos.fecha` es un `date` desde la 20260903081542
    // justamente porque un instante corre un dia segun el huso. Si algo llega
    // con hora, se recorta.
    expect(sigueDesestimado(d({ ultimo_movimiento: "2026-09-20" }), "2026-09-20T23:30:00+00:00")).toBe(true);
  });
});

describe("el mapa por articulo", () => {
  it("indexa por articulo_id", () => {
    const m = desestimacionesPorArticulo([d({ articulo_id: "a1" }), d({ articulo_id: "a2" })]);
    expect(m.size).toBe(2);
    expect(m.get("a2")?.articulo_id).toBe("a2");
  });

  it("una fila sin articulo no entra", () => {
    expect(desestimacionesPorArticulo([d({ articulo_id: "   " })]).size).toBe(0);
  });
});

describe("lo que dice la fila desestimada", () => {
  it("nombra a quien fue y cuando", () => {
    expect(textoDeLaDesestimacion(d({ motivo: "Se discontinuó" }), comoSeLee))
      .toBe("Desestimado por Juan Pérez el 21/09 · Se discontinuó");
  });

  it("sin motivo lo dice, en vez de dejar el lugar en blanco", () => {
    // Un blanco se lee como "nadie sabe por que"; esto dice "nadie lo
    // escribio", que es otra cosa. El motivo es opcional a proposito.
    expect(textoDeLaDesestimacion(d(), comoSeLee))
      .toBe("Desestimado por Juan Pérez el 21/09 · sin motivo");
  });

  it("sin nombre no inventa uno", () => {
    expect(textoDeLaDesestimacion(d({ desestimado_por_nombre: null }), comoSeLee))
      .toBe("Desestimado el 21/09 · sin motivo");
  });
});
