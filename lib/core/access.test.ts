import { describe, it, expect } from "vitest";
import { modulosVisibles, nivelEnModulo } from "./access";
import type { UsuarioModulo } from "./types";

const grant = (modulo: UsuarioModulo["modulo"]): UsuarioModulo => ({
  id: "x",
  usuario_id: "u",
  modulo,
  nivel: "lectura",
});

describe("modulosVisibles", () => {
  it("admin_sistema ve todos los módulos sin importar los grants", () => {
    expect(modulosVisibles("admin_sistema", [])).toEqual([
      "rrhh",
      "mantenimiento",
      "remises",
      "compras",
      "inventario",
    ]);
  });

  it("un rol no-admin ve solo los módulos concedidos, en orden canónico", () => {
    const grants = [grant("remises"), grant("rrhh")];
    expect(modulosVisibles("operario", grants)).toEqual(["rrhh", "remises"]);
  });

  it("sin grants y sin ser admin_sistema, no ve ningún módulo", () => {
    expect(modulosVisibles("encargado", [])).toEqual([]);
  });
});

describe("nivelEnModulo", () => {
  it("admin_sistema tiene nivel admin en cualquier módulo, tenga grant o no", () => {
    expect(nivelEnModulo("admin_sistema", [], "mantenimiento")).toBe("admin");
  });

  it("devuelve el nivel concedido si el usuario tiene grant en ese módulo", () => {
    const grants = [grant("mantenimiento")];
    expect(nivelEnModulo("operario", grants, "mantenimiento")).toBe("lectura");
  });

  it("devuelve null si el usuario no tiene grant en ese módulo", () => {
    expect(nivelEnModulo("operario", [], "mantenimiento")).toBeNull();
  });
});
