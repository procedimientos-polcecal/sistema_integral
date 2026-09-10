import { describe, it, expect } from "vitest";
import { modulosVisibles, nivelEnModulo, esAdminDelNucleo } from "./access";
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
      "produccion",
      "despacho",
    ]);
  });

  it("un rol no-admin ve solo los módulos concedidos, en orden canónico", () => {
    const grants = [grant("remises"), grant("rrhh")];
    expect(modulosVisibles("operario", grants)).toEqual(["rrhh", "remises"]);
  });

  it("sin grants y sin ser admin_sistema, no ve ningún módulo", () => {
    expect(modulosVisibles("encargado", [])).toEqual([]);
  });

  // Decisión: "admin" es admin del núcleo (usuarios, empresas, sectores —
  // ver lib/core/route-utils.ts y las pantallas de /administracion), no un
  // bypass de módulo. Sin grant en usuario_modulos no ve ningún módulo, igual
  // que encargado u operario. Sólo admin_sistema ve todo sin grants.
  it("admin no es admin_sistema: sin grants no ve ningún módulo", () => {
    expect(modulosVisibles("admin", [])).toEqual([]);
  });

  it("admin ve los módulos que tenga concedidos, igual que cualquier otro rol", () => {
    const grants = [grant("mantenimiento")];
    expect(modulosVisibles("admin", grants)).toEqual(["mantenimiento"]);
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

  // Misma decisión que en modulosVisibles: admin no bypassa el nivel de un
  // módulo por rol. Esto es lo que 20260908083338_admin_es_del_nucleo_no_del_modulo
  // alinea del lado de la base (es_admin_sistema() en vez de es_admin() en
  // tiene_acceso_<modulo>/puede_editar_<modulo>/es_admin_<modulo>) — hasta
  // esa migración, RLS le daba "admin" en todos los módulos a un usuario con
  // rol admin aunque acá devolviera null.
  it("admin sin grant en el módulo no tiene acceso (no es un bypass de admin_sistema)", () => {
    expect(nivelEnModulo("admin", [], "compras")).toBeNull();
  });

  it("admin con grant en el módulo usa ese nivel, igual que cualquier otro rol", () => {
    const grants = [grant("mantenimiento")];
    expect(nivelEnModulo("admin", grants, "mantenimiento")).toBe("lectura");
  });
});

describe("esAdminDelNucleo", () => {
  it("admin_sistema administra el núcleo", () => {
    expect(esAdminDelNucleo("admin_sistema")).toBe(true);
  });

  /**
   * El cambio del 10/09/2026. Un usuario con rol `admin` —hoy una cuenta de
   * soporte externa que entró por Mantenimiento— podía abrir
   * /administracion/usuarios, crear usuarios y concederse cualquier módulo.
   * Los grants de módulo nunca le dieron nada por rol (los dos describe de
   * arriba), así que la pestaña era el único lugar donde `admin` mandaba, y
   * era justo el que le dejaba ampliarse el resto.
   */
  it("admin ya no: la pestaña Administración es sólo de admin_sistema", () => {
    expect(esAdminDelNucleo("admin")).toBe(false);
  });

  it("encargado y operario tampoco", () => {
    expect(esAdminDelNucleo("encargado")).toBe(false);
    expect(esAdminDelNucleo("operario")).toBe(false);
  });

  /** Las pantallas pasan `usuario?.rol`, y el cliente de Supabase no está tipado. */
  it("sin rol no pasa", () => {
    expect(esAdminDelNucleo(null)).toBe(false);
    expect(esAdminDelNucleo(undefined)).toBe(false);
  });
});
