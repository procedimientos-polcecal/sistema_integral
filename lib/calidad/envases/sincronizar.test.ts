import { describe, it, expect } from "vitest";
import { enlazarProveedor } from "./sincronizar";

// "Torraco Pablo Javier" en la pestaña de envases es "Flexi Rigs" en las
// facturas: por nombre no se lo reconoce, por CUIT sí.
const POR_CUIT = new Map([["23214811839", "id-flexi"]]);
const POR_NOMBRE = new Map([["flexi rigs", "id-flexi"], ["bralbol", "id-bralbol"]]);

describe("enlazarProveedor", () => {
  it("gana el CUIT, aunque el nombre no se parezca en nada", () => {
    expect(enlazarProveedor(POR_CUIT, POR_NOMBRE, {
      nombre: "Torraco Pablo Javier", cuit: "23214811839",
    })).toBe("id-flexi");
  });

  it("sin CUIT, cae al nombre", () => {
    expect(enlazarProveedor(POR_CUIT, POR_NOMBRE, {
      nombre: "Bralbol", cuit: null,
    })).toBe("id-bralbol");
  });

  it("con un CUIT que no está, igual prueba el nombre", () => {
    expect(enlazarProveedor(POR_CUIT, POR_NOMBRE, {
      nombre: "Bralbol", cuit: "30715153528",
    })).toBe("id-bralbol");
  });

  it("si no lo reconoce, null: no enlaza al que se le parece", () => {
    expect(enlazarProveedor(POR_CUIT, POR_NOMBRE, {
      nombre: "Pro bags", cuit: null,
    })).toBeNull();
  });
});
