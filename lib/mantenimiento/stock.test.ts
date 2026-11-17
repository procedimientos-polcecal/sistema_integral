import { describe, it, expect } from "vitest";
import { mapearInventario, filaDeInsumo, buscarEnInventario, primerNumero, cuantosPide } from "./stock";

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

  /*
   * HABER NO ES ALCANZAR, Y ÉSA ERA LA PREGUNTA QUE NO SE HACÍA.
   *
   * Reportado el 04/11/2026 probando el preview: la OT 2971 pedía 80 tuercas,
   * el pañol tenía 61 y la pantalla decía «Hay» en verde. El estado se
   * calculaba **sólo con el stock** —por eso el comentario de `estadoDe` decía
   * que al mínimo «alcanza para este trabajo», que es justo lo que no se sabía—
   * y nadie comparaba contra lo que la orden necesita. El resultado es el peor
   * de los posibles: el sistema afirma en verde que está todo bien y el
   * repuesto falta el día del trabajo.
   */
  it("avisa cuando hay, pero no alcanza para lo que la orden pide", () => {
    const [r] = buscarEnInventario(
      [{ codigo: "ROD-6206", nombre: "", cantidad: "6" }], inventario
    );
    expect(r.estado).toBe("no_alcanza");
  });

  it("si la cantidad entra justa, alcanza", () => {
    expect(buscarEnInventario([{ codigo: "ROD-6206", nombre: "", cantidad: "4" }], inventario)[0].estado)
      .toBe("hay");
  });

  /*
   * La cantidad es texto libre porque la planilla lo es. Si de ahí no sale un
   * número, **no se compara**: decir «no alcanza» sin saber cuánto hace falta
   * es inventar, y es la misma cautela que `sin_dato`.
   */
  it("sin un número que comparar, se comporta como siempre", () => {
    for (const cantidad of ["un juego", "", null, undefined]) {
      expect(buscarEnInventario([{ codigo: "ROD-6206", nombre: "", cantidad }], inventario)[0].estado)
        .toBe("hay");
    }
  });

  /*
   * Y el orden entre los estados: «no hay» y «no está» son más graves y ganan
   * —no tiene sentido decir «no alcanza» de algo que no existe—, pero «no
   * alcanza» le gana a «queda poco», que es el más blando de los tres y además
   * el que afirma de más: «queda poco» dice que alcanza para este trabajo.
   */
  it("no hay le gana a no alcanza, y no alcanza le gana a queda poco", () => {
    expect(buscarEnInventario([{ codigo: "COR-B75", nombre: "", cantidad: "9" }], inventario)[0].estado)
      .toBe("no_hay");
    expect(buscarEnInventario([{ codigo: "XX-999", nombre: "Algo raro", cantidad: "9" }], inventario)[0].estado)
      .toBe("no_esta");
    // RET-40: hay 1, el mínimo son 3 —«queda poco»— y se piden 2.
    expect(buscarEnInventario([{ codigo: "RET-40", nombre: "", cantidad: "2" }], inventario)[0].estado)
      .toBe("no_alcanza");
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

  // Medido contra producción el 13/11/2026: la OT escribe el diámetro con ø y
  // espacios, y el pañol lo tiene pegado.
  it("reconoce el niple aunque la OT escriba el diámetro con ø y espacios", () => {
    const inv = [{ codigo: "01221", descripcion: 'NIPLE GALVANIZADO 3" X 300MM', stock: 5, seguridad: 1, ubicacion: null }];
    const [d] = buscarEnInventario([{ codigo: null, nombre: 'Niple galvanizado ø 3 " x 300 mm', cantidad: null }], inv);
    expect(d.insumo?.codigo).toBe("01221");
  });

  it("reconoce la tapa con el mismo ø", () => {
    const inv = [{ codigo: "01220", descripcion: 'TAPA GALVANIZADA 3"', stock: 2, seguridad: 1, ubicacion: null }];
    const [d] = buscarEnInventario([{ codigo: null, nombre: 'Tapa galvanizada ø 3"', cantidad: null }], inv);
    expect(d.insumo?.codigo).toBe("01220");
  });

  // La otra dirección: aflojar no puede juntar medidas distintas.
  it("sigue sin confundir dos medidas que sólo difieren en el número", () => {
    const inv = [{ codigo: "01222", descripcion: 'NIPLE GALVANIZADO 3" X 200MM', stock: 5, seguridad: 1, ubicacion: null }];
    const [d] = buscarEnInventario([{ codigo: null, nombre: 'Niple galvanizado ø 3 " x 300 mm', cantidad: null }], inv);
    expect(d.insumo).toBeNull();
  });

  it("no pega números que no llevan unidad: BULON 1/2 no es BULON 12", () => {
    const inv = [{ codigo: "9", descripcion: "BULON 12", stock: 5, seguridad: 1, ubicacion: null }];
    const [d] = buscarEnInventario([{ codigo: null, nombre: "Bulon 1/2", cantidad: null }], inv);
    expect(d.insumo).toBeNull();
  });

  // Lo que pegar la unidad podía perder: el pañol escribe la palabra entera.
  it("sigue reconociendo `2 m` contra un artículo que dice `2 METROS`", () => {
    const inv = [{ codigo: "7", descripcion: "CABLE 2 METROS", stock: 5, seguridad: 1, ubicacion: null }];
    const [d] = buscarEnInventario([{ codigo: null, nombre: "Cable 2 m", cantidad: null }], inv);
    expect(d.insumo?.codigo).toBe("7");
  });

  it("sigue reconociendo `5 l` contra `5 LITROS` (caso que ya andaba antes de pegar unidades)", () => {
    const inv = [{ codigo: "8", descripcion: "ACEITE 5 LITROS", stock: 5, seguridad: 1, ubicacion: null }];
    const [d] = buscarEnInventario([{ codigo: null, nombre: "Aceite 5 l", cantidad: null }], inv);
    expect(d.insumo?.codigo).toBe("8");
  });
});

describe("primerNumero y cuantosPide: una sola lectura de la cantidad", () => {
  it("lee enteros, decimales con coma o punto, y espacios", () => {
    expect(cuantosPide("10")).toBe(10);
    expect(cuantosPide(" 2,5 ")).toBe(2.5);
    expect(cuantosPide("2.5")).toBe(2.5);
  });
  it("toma el primer número aunque haya texto alrededor", () => {
    expect(cuantosPide("80 u.")).toBe(80);
    expect(cuantosPide("x3")).toBe(3);
    expect(cuantosPide("10 unidades")).toBe(10);
  });
  it("lo que no es un número positivo no es una cantidad", () => {
    for (const v of ["", null, undefined, "abc", "un juego", "0", "0 bolsas"]) {
      expect(cuantosPide(v as string | null | undefined)).toBeNull();
    }
  });
  it("el signo no se lee: «-3» da 3 y no null", () => {
    // La lectura vieja de `cantidadDelRenglon` hacía `Number("-3")` y daba null; ésta
    // toma el primer número y da 3. Es la semántica que `cuantosPide` ya tenía para el
    // stock, así que no es una regresión, y medido el 17/11/2026 **ninguno** de los 27
    // renglones de repuesto trae un número negativo: no mueve ninguna cuenta de hoy.
    // Está escrito porque el caso desapareció al unificar y el cambio de signo no se
    // notaba en ningún lado.
    expect(cuantosPide("-3")).toBe(3);
  });

  it("primerNumero conserva el 0 como texto y normaliza el punto decimal", () => {
    expect(primerNumero("0 bolsas")).toBe("0");
    expect(primerNumero("2,5")).toBe("2.5");
    expect(primerNumero("un juego")).toBeNull();
    expect(primerNumero("80 u.")).toBe("80");
  });
});
