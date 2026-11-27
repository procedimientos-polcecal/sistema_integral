import { describe, it, expect } from "vitest";
import {
  validarLaCarga, planillaDeCadaRenglon, renglonesYaCargados, type Renglon,
} from "./cargaDePresupuestos";

/** Un renglón válido para el pedido `id`; lo demás da igual para estas pruebas. */
function r(id: string | number, cambios: Partial<Renglon> = {}): Renglon {
  return {
    requerimiento_id: String(id),
    precio_unitario: 100,
    cantidad: 1,
    marca: null,
    unidad_medida: null,
    descuento: 0,
    iva: 21,
    plazos_pago_dias: null,
    condiciones_pago: null,
    disponibilidad: null,
    comentario: null,
    costo_envio: null,
    precio_hasta: null,
    moneda: "ARS",
    ...cambios,
  };
}

describe("validarLaCarga", () => {
  it("una carga sin renglones se rechaza", () => {
    expect(validarLaCarga({ proveedorId: "p", fecha: "2026-11-18", renglones: [] }))
      .toContain("Hay que cargar al menos un presupuesto");
  });

  it("el mismo pedido dos veces en la misma carga se rechaza, nombrándolo", () => {
    const e = validarLaCarga({ proveedorId: "p", fecha: "2026-11-18", renglones: [r(1), r(1)] });
    expect(e.join(" ")).toMatch(/dos veces/);

    const con = validarLaCarga({
      proveedorId: "p", fecha: "2026-11-18", renglones: [r(1), r(1)],
      nombreDe: (id) => `RI ${id}00`,
    });
    expect(con.join(" ")).toContain("RI 100");
  });

  it("informa todos los problemas juntos y no de a uno", () => {
    expect(validarLaCarga({ proveedorId: null, fecha: null, renglones: [] })).toHaveLength(3);
  });

  it("una carga bien armada no tiene problemas", () => {
    expect(validarLaCarga({ proveedorId: "p", fecha: "2026-11-18", renglones: [r(1), r(2)] })).toEqual([]);
  });

  it("un renglón sin precio se rechaza, y se nombra cuál", () => {
    const e = validarLaCarga({
      proveedorId: "p", fecha: "2026-11-18",
      renglones: [r(1), r(2, { precio_unitario: Number.NaN })],
    });
    expect(e).toHaveLength(1);
    expect(e[0]).toContain("2");
  });
});

describe("validarLaCarga: renglones sin pedido y mensajes", () => {
  it("un renglón sin pedido se marca en castellano y no cuenta como repetido", () => {
    const e = validarLaCarga({
      proveedorId: "p", fecha: "2026-11-18",
      renglones: [r(""), r(""), r(1)],
    });
    expect(e.join(" ")).toMatch(/sin pedido/);
    expect(e.join(" ")).not.toMatch(/dos veces/);
  });

  it("el mensaje por defecto del precio dice «del pedido», no «de el pedido»", () => {
    const e = validarLaCarga({
      proveedorId: "p", fecha: "2026-11-18",
      renglones: [r(2, { precio_unitario: Number.NaN })],
    });
    expect(e[0]).toContain("del pedido 2");
    expect(e[0]).not.toContain("de el");
  });
});

describe("planillaDeCadaRenglon", () => {
  it("un renglón cuyo pedido ya tiene planilla va a la suya y no a la del encabezado", () => {
    const m = planillaDeCadaRenglon([r("a"), r("b")], "libro-X", { b: "libro-Y" });
    expect([...m.keys()].sort()).toEqual(["libro-X", "libro-Y"]);
    expect(m.get("libro-X")).toEqual(["a"]);
    expect(m.get("libro-Y")).toEqual(["b"]);
  });

  it("sin planilla propia ni de encabezado, el renglón no va a ninguna", () => {
    const m = planillaDeCadaRenglon([r("a")], null, {});
    expect(m.size).toBe(0);
  });
});

describe("renglonesYaCargados", () => {
  const nombreDe = (id: string) => `RI ${id}`;

  it("un renglón idéntico a uno recién insertado se nombra", () => {
    const problemas = renglonesYaCargados({
      renglones: [r("2301", { precio_unitario: 12500 })],
      recientes: [{ requerimiento_id: "2301", precio_unitario: 12500 }],
      nombreDe,
    });
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("RI 2301");
  });

  // El caso legítimo que la migración 026 permite a propósito: dos marcas del
  // mismo proveedor para el mismo pedido. Tienen precios distintos.
  it("dos marcas del mismo proveedor no se frenan: el precio difiere", () => {
    const problemas = renglonesYaCargados({
      renglones: [r("2301", { precio_unitario: 13100 })],
      recientes: [{ requerimiento_id: "2301", precio_unitario: 12500 }],
      nombreDe,
    });
    expect(problemas).toEqual([]);
  });

  it("el mismo precio en otro pedido no frena nada", () => {
    const problemas = renglonesYaCargados({
      renglones: [r("2307", { precio_unitario: 12500 })],
      recientes: [{ requerimiento_id: "2301", precio_unitario: 12500 }],
      nombreDe,
    });
    expect(problemas).toEqual([]);
  });

  // PostgREST devuelve `numeric` como string según el cliente: comparar con ===
  // dejaba pasar el duplicado entero.
  it("un precio que vuelve como texto se compara igual", () => {
    const problemas = renglonesYaCargados({
      renglones: [r("2301", { precio_unitario: 12500 })],
      recientes: [{ requerimiento_id: "2301", precio_unitario: "12500.00" }],
      nombreDe,
    });
    expect(problemas).toHaveLength(1);
  });

  it("sin nada reciente no hay problemas", () => {
    expect(renglonesYaCargados({ renglones: [r("2301")], recientes: [], nombreDe })).toEqual([]);
  });

  it("una carga de varios renglones nombra sólo los repetidos", () => {
    const problemas = renglonesYaCargados({
      renglones: [r("2301", { precio_unitario: 12500 }), r("2307", { precio_unitario: 31200 })],
      recientes: [{ requerimiento_id: "2307", precio_unitario: 31200 }],
      nombreDe,
    });
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("RI 2307");
  });
});
