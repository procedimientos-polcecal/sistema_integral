import { describe, it, expect } from "vitest";
import { numeroDeCampo, leerCampo, numerosDelRenglon } from "./numeroDeCampo";

describe("numeroDeCampo", () => {
  it.each([
    ["12.500", 12500],
    ["12.500,50", 12500.5],
    ["1.234.567", 1234567],
    ["12500,50", 12500.5],
    ["12.5", 12.5],
    ["12500.5", 12500.5],
    ["  21 ", 21],
    ["0,5", 0.5],
    ["0.500", 0.5],
    ["0.125", 0.125],
    ["0.750", 0.75],
    ["1,234.56", 1234.56],
  ])("%s → %s", (texto, esperado) => {
    expect(numeroDeCampo(texto)).toBe(esperado);
  });

  it("vacío y lo que no es un número dan null", () => {
    expect(numeroDeCampo("")).toBeNull();
    expect(numeroDeCampo("   ")).toBeNull();
    expect(numeroDeCampo("abc")).toBeNull();
    expect(numeroDeCampo("12,3,4")).toBeNull();
    expect(numeroDeCampo("1e3")).toBeNull();
    expect(numeroDeCampo("-12.500")).toBeNull();
    expect(numeroDeCampo("-3,5")).toBeNull();
  });
});

describe("leerCampo", () => {
  it("vacío es vacío, y no un cero", () => {
    expect(leerCampo("")).toEqual({ estado: "vacio" });
    expect(leerCampo("   ")).toEqual({ estado: "vacio" });
  });

  it("un número es un número", () => {
    expect(leerCampo("12.500,50")).toEqual({ estado: "numero", valor: 12500.5 });
  });

  // Es la distinción entera: con `?? 0` esto valía cero y nadie se enteraba.
  it("lo que no se pudo leer no es cero: es ilegible", () => {
    expect(leerCampo("21%")).toEqual({ estado: "ilegible" });
    expect(leerCampo("1.500 $")).toEqual({ estado: "ilegible" });
    expect(leerCampo("-3")).toEqual({ estado: "ilegible" });
  });
});

describe("numerosDelRenglon", () => {
  const vacio = { precio: "", cantidad: "", descuento: "", iva: "", envio: "" };

  it("los porcentajes vuelven como fracción, que es lo que guarda la base", () => {
    const { campos, problemas } = numerosDelRenglon(
      { ...vacio, precio: "12.500", cantidad: "4", descuento: "10", iva: "21" },
      "renglón 1"
    );
    expect(problemas).toEqual([]);
    expect(campos).toEqual({
      precio_unitario: 12500, cantidad: 4, descuento: 0.1, iva: 0.21, costo_envio: null,
    });
  });

  // Un campo en blanco sigue valiendo 0: es lo que la gente quiere decir.
  it("un descuento o un IVA vacíos valen cero", () => {
    const { campos, problemas } = numerosDelRenglon({ ...vacio, precio: "100" }, "renglón 1");
    expect(problemas).toEqual([]);
    expect(campos.descuento).toBe(0);
    expect(campos.iva).toBe(0);
  });

  // El caso que elige proveedor: "21%" en la columna IVA daba IVA 0 y un total
  // 21% más barato que el de los demás.
  it("un IVA que no se pudo leer se rechaza y se nombra, no vale cero", () => {
    const { problemas } = numerosDelRenglon({ ...vacio, precio: "100", iva: "21%" }, "RI 2301");
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("RI 2301");
    expect(problemas[0]).toContain("IVA");
    expect(problemas[0]).toContain("21%");
  });

  it("un envío o una cantidad ilegibles también se nombran, en vez de perderse", () => {
    const { problemas } = numerosDelRenglon(
      { ...vacio, precio: "100", envio: "1.500 $", cantidad: "cuatro" },
      "RI 2301"
    );
    expect(problemas).toHaveLength(2);
  });

  // El precio lo nombra la ruta ("Falta el precio unitario del RI X"), así que
  // acá viaja como null y no se duplica el mensaje.
  it("el precio vacío viaja en null y lo nombra la ruta", () => {
    const { campos, problemas } = numerosDelRenglon(vacio, "RI 2301");
    expect(campos.precio_unitario).toBeNull();
    expect(problemas).toEqual([]);
  });

  it("un precio ilegible sí se nombra acá: la ruta sólo sabría decir que falta", () => {
    const { problemas } = numerosDelRenglon({ ...vacio, precio: "mil quinientos" }, "RI 2301");
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("Precio unitario");
  });
});
