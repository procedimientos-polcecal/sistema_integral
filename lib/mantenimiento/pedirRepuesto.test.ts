import { describe, it, expect } from "vitest";
import {
  convienePedir, cantidadPedida, deDondeSale, pedidoSugerido,
} from "./pedirRepuesto";
import type { Disponibilidad } from "./stock";

const orden = {
  ot_number: 2381,
  descripcion: "Cambio de rodamientos del eje",
  equipment_id: "eq-compresor",
  equipo_raw: "PO-A1-01 Compresor A1",
};

const ubicaciones = [
  { id: "u-compresor", nombre: "Compresor A1", equipo_id: "eq-compresor", sector_id: null },
  { id: "u-doosan-1",  nombre: "Doosan 225 n°1", equipo_id: "eq-doosan", sector_id: null },
  { id: "u-doosan-2",  nombre: "Doosan 225",     equipo_id: "eq-doosan", sector_id: null },
  { id: "u-panol",     nombre: "Pañol",          equipo_id: null,        sector_id: "s-panol" },
];

const hallado = (stock: number | null, seguridad = 2): Disponibilidad => ({
  codigo: "00473",
  nombre: "guantes",
  insumo: {
    codigo: "00473", descripcion: "GUANTES DE VAQUETA",
    stock, seguridad, ubicacion: "Estante 3",
  },
  estado: stock === null ? "sin_dato" : stock <= 0 ? "no_hay" : stock <= seguridad ? "bajo_minimo" : "hay",
});

describe("cuando conviene ofrecer un pedido", () => {
  it("cuando no hay y cuando ni siquiera esta en el inventario", () => {
    expect(convienePedir("no_hay")).toBe(true);
    expect(convienePedir("no_esta")).toBe(true);
  });

  /** Alcanza para este trabajo pero hay que reponer, y este es el momento. */
  it("cuando queda poco tambien", () => {
    expect(convienePedir("bajo_minimo")).toBe(true);
  });

  it("cuando hay, no", () => {
    expect(convienePedir("hay")).toBe(false);
  });

  /**
   * La celda de stock vacia es "nadie lo conto", no "no hay". Sugerir un
   * pedido ahi es mandar a comprar algo que puede estar en el estante.
   */
  it("sin stock informado NO se sugiere pedir", () => {
    expect(convienePedir("sin_dato")).toBe(false);
  });
});

describe("la cantidad que se sugiere", () => {
  it("saca el numero de lo que se haya anotado", () => {
    expect(cantidadPedida("2")).toBe("2");
    expect(cantidadPedida("2 u.")).toBe("2");
    expect(cantidadPedida("x3")).toBe("3");
    expect(cantidadPedida("1,5")).toBe("1.5");
  });

  /** Un 1 puesto por el sistema se firma sin mirarlo. */
  it("lo que no tiene numero queda vacio, no en uno", () => {
    expect(cantidadPedida("un juego")).toBe("");
    expect(cantidadPedida("")).toBe("");
    expect(cantidadPedida(null)).toBe("");
  });
});

describe("de donde sale el pedido", () => {
  it("dice la OT, el equipo y cuanto quedaba", () => {
    expect(deDondeSale(orden, hallado(0))).toBe(
      "Para la OT 2381 — Cambio de rodamientos del eje. " +
      "Equipo: PO-A1-01 Compresor A1. En el pañol quedan 0"
    );
  });

  it("cuando el repuesto ni figura en el panol, lo dice asi", () => {
    const sinHallar: Disponibilidad = {
      codigo: null, nombre: "buje especial", insumo: null, estado: "no_esta",
    };
    expect(deDondeSale(orden, sinHallar)).toContain("No está en el inventario del pañol");
  });

  it("una orden sin numero ni equipo no inventa nada", () => {
    expect(deDondeSale(
      { ot_number: null, descripcion: null, equipment_id: null, equipo_raw: null },
      null
    )).toBe("");
  });
});

describe("el requerimiento que se sugiere", () => {
  /**
   * "00473 GUANTES DE VAQUETA" se cruza con el inventario cuando llega;
   * "guantes" no.
   */
  it("usa el nombre y el codigo del articulo cuando se lo reconocio", () => {
    const p = pedidoSugerido(
      { nombre: "guantes", codigo: null, cantidad: "2" },
      hallado(0), orden, ubicaciones
    );
    expect(p.descripcion).toBe("GUANTES DE VAQUETA");
    expect(p.codigo).toBe("00473");
    expect(p.cantidad).toBe("2");
  });

  it("y el texto libre cuando no lo reconocio", () => {
    const p = pedidoSugerido(
      { nombre: "buje especial", codigo: "X-9", cantidad: null },
      { codigo: "X-9", nombre: "buje especial", insumo: null, estado: "no_esta" },
      orden, ubicaciones
    );
    expect(p.descripcion).toBe("buje especial");
    expect(p.codigo).toBe("X-9");
    expect(p.cantidad).toBe("");
  });

  it("enlaza la ubicacion cuando la maquina tiene una sola", () => {
    const p = pedidoSugerido(
      { nombre: "guantes", codigo: null, cantidad: null },
      hallado(0), orden, ubicaciones
    );
    expect(p.ubicacionId).toBe("u-compresor");
  });

  /**
   * Con dos, cual es la correcta no se deduce. Elegir cualquiera pone el gasto
   * en el lugar que no es y nadie lo nota.
   */
  it("con dos ubicaciones no elige ninguna", () => {
    const p = pedidoSugerido(
      { nombre: "guantes", codigo: null, cantidad: null },
      hallado(0), { ...orden, equipment_id: "eq-doosan" }, ubicaciones
    );
    expect(p.ubicacionId).toBe("");
  });

  it("sin equipo enlazado tampoco", () => {
    const p = pedidoSugerido(
      { nombre: "guantes", codigo: null, cantidad: null },
      hallado(0), { ...orden, equipment_id: null }, ubicaciones
    );
    expect(p.ubicacionId).toBe("");
  });

  /** El numero de OT va al detalle: en la descripcion impediria agrupar dos
   * pedidos del mismo material. */
  it("el origen va al detalle y no a la descripcion", () => {
    const p = pedidoSugerido(
      { nombre: "guantes", codigo: null, cantidad: null },
      hallado(0), orden, ubicaciones
    );
    expect(p.descripcion).not.toContain("2381");
    expect(p.detalle).toContain("OT 2381");
  });
});
