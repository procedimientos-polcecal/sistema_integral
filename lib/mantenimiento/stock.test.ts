import { describe, it, expect } from "vitest";
import { mapearInventario, filaDeInsumo, buscarEnInventario } from "./stock";

describe("mapearInventario", () => {
  it("ubica las columnas por su encabezado", () => {
    const idx = mapearInventario(["CÓDIGO", "DESCRIPCIÓN", "STOCK ACTUAL", "STOCK MÍNIMO", "UBICACIÓN"]);
    expect(idx.codigo).toBe(0);
    expect(idx.descripcion).toBe(1);
    expect(idx.stock).toBe(2);
    expect(idx.seguridad).toBe(3);
    expect(idx.ubicacion).toBe(4);
  });

  it("acepta las maneras de llamar a lo mismo", () => {
    // Cada pañol nombra sus columnas a su modo.
    expect(mapearInventario(["SKU", "REPUESTO", "CANT"]).codigo).toBe(0);
    expect(mapearInventario(["SKU", "REPUESTO", "CANT"]).descripcion).toBe(1);
    expect(mapearInventario(["SKU", "REPUESTO", "CANT"]).stock).toBe(2);
  });

  it("marca con -1 lo que la planilla no trae", () => {
    expect(mapearInventario(["CODIGO", "DESCRIPCION"]).seguridad).toBe(-1);
  });
});

describe("filaDeInsumo", () => {
  const idx = mapearInventario(["CODIGO", "DESCRIPCION", "STOCK", "MINIMO", "UBICACION"]);

  it("lee una fila", () => {
    const i = filaDeInsumo(["ROD-6206", "Rodamiento 6206 2RS", 4, 2, "Estante B3"], idx)!;
    expect(i.codigo).toBe("ROD-6206");
    expect(i.descripcion).toBe("Rodamiento 6206 2RS");
    expect(i.stock).toBe(4);
    expect(i.seguridad).toBe(2);
    expect(i.ubicacion).toBe("Estante B3");
  });

  it("distingue el stock en cero del stock sin informar", () => {
    // Cero es un dato: quiere decir que no hay. Vacío quiere decir que nadie
    // lo contó, y mostrarlo como cero manda a comprar algo que puede haber.
    expect(filaDeInsumo(["A", "Algo", 0], idx)!.stock).toBe(0);
    expect(filaDeInsumo(["A", "Algo", ""], idx)!.stock).toBeNull();
  });

  it("descarta una fila sin código ni descripción", () => {
    expect(filaDeInsumo(["", "", 5], idx)).toBeNull();
  });
});

describe("buscarEnInventario", () => {
  const inventario = [
    { codigo: "ROD-6206", descripcion: "Rodamiento 6206 2RS", stock: 4, seguridad: 2, ubicacion: "B3" },
    { codigo: "COR-B75", descripcion: "Correa B-75", stock: 0, seguridad: 1, ubicacion: "A1" },
    { codigo: "RET-40", descripcion: "Retén 40x62x8", stock: 1, seguridad: 3, ubicacion: "C2" },
    { codigo: "ACE-46", descripcion: "Aceite hidráulico ISO 46", stock: null, seguridad: null, ubicacion: "D1" },
  ];

  it("encuentra por código, sin importar mayúsculas", () => {
    const [r] = buscarEnInventario([{ codigo: "rod-6206", nombre: "" }], inventario);
    expect(r.insumo?.codigo).toBe("ROD-6206");
    expect(r.estado).toBe("hay");
  });

  it("encuentra por nombre cuando no hay código", () => {
    const [r] = buscarEnInventario([{ codigo: null, nombre: "Correa B-75" }], inventario);
    expect(r.insumo?.codigo).toBe("COR-B75");
  });

  it("encuentra por nombre parcial", () => {
    const [r] = buscarEnInventario([{ codigo: null, nombre: "rodamiento 6206" }], inventario);
    expect(r.insumo?.codigo).toBe("ROD-6206");
  });

  it("dice que no hay cuando el stock es cero", () => {
    expect(buscarEnInventario([{ codigo: "COR-B75", nombre: "" }], inventario)[0].estado).toBe("no_hay");
  });

  it("avisa cuando queda en el mínimo o por debajo", () => {
    // Hay uno y el mínimo son tres: alcanza para este trabajo, pero hay que
    // reponer.
    expect(buscarEnInventario([{ codigo: "RET-40", nombre: "" }], inventario)[0].estado)
      .toBe("bajo_minimo");
  });

  it("no inventa cuando el stock no está informado", () => {
    expect(buscarEnInventario([{ codigo: "ACE-46", nombre: "" }], inventario)[0].estado)
      .toBe("sin_dato");
  });

  it("distingue no estar en el inventario de no haber stock", () => {
    // Son cosas distintas: una se compra, la otra se busca en otro lado.
    const [r] = buscarEnInventario([{ codigo: "XX-999", nombre: "Algo raro" }], inventario);
    expect(r.estado).toBe("no_esta");
    expect(r.insumo).toBeNull();
  });

  it("no encuentra cualquier cosa por un nombre demasiado corto", () => {
    // "de" aparece en media planilla.
    expect(buscarEnInventario([{ codigo: null, nombre: "de" }], inventario)[0].estado)
      .toBe("no_esta");
  });
});
