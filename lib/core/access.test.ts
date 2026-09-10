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

  // Acá vivían dos tests con el rol `admin`, que probaban que no era un bypass
  // de módulo: sin grant no veía nada, con grant veía lo concedido — o sea,
  // exactamente lo que hacen los dos tests de arriba con encargado y operario.
  // Eso es lo que llevó a unificarlo con `encargado` el 10/09/2026 (ver `Rol`
  // en ./types.ts): un rol cuyos tests son indistinguibles de otro es el mismo
  // rol con dos nombres.
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

  // El nivel no lo da el rol: lo da el grant. Eso es lo que
  // 20260908083338_admin_es_del_nucleo_no_del_modulo alineó del lado de la base
  // (es_admin_sistema() en vez de es_admin() en tiene_acceso_<modulo>/
  // puede_editar_<modulo>/es_admin_<modulo>) — hasta esa migración, RLS le daba
  // "admin" en todos los módulos a un usuario con rol `admin` aunque acá
  // devolviera null. Con `admin` ya unificado en `encargado`, el único rol que
  // significa algo es admin_sistema, y es el primer test de este describe.
  it("un encargado con grant usa ese nivel y sin grant no tiene acceso", () => {
    expect(nivelEnModulo("encargado", [grant("mantenimiento")], "mantenimiento")).toBe("lectura");
    expect(nivelEnModulo("encargado", [], "compras")).toBeNull();
  });
});

describe("esAdminDelNucleo", () => {
  it("admin_sistema administra el núcleo", () => {
    expect(esAdminDelNucleo("admin_sistema")).toBe(true);
  });

  /**
   * El cambio del 10/09/2026. Un usuario con rol `admin` —una cuenta de soporte
   * externa que entró por Mantenimiento— podía abrir /administracion/usuarios,
   * crear usuarios y concederse cualquier módulo. Los grants nunca le dieron
   * nada por rol, así que la pestaña era el único lugar donde `admin` mandaba,
   * y era justo el que le dejaba ampliarse el resto. Cerrada la pestaña, el rol
   * no se distinguía de `encargado` y se unificaron: ya no se puede pasar
   * "admin" acá porque no está en el tipo `Rol`.
   */
  it("ningún otro rol administra el núcleo", () => {
    expect(esAdminDelNucleo("encargado")).toBe(false);
    expect(esAdminDelNucleo("operario")).toBe(false);
  });

  /** Las pantallas pasan `usuario?.rol`, y el cliente de Supabase no está tipado. */
  it("sin rol no pasa", () => {
    expect(esAdminDelNucleo(null)).toBe(false);
    expect(esAdminDelNucleo(undefined)).toBe(false);
  });
});
