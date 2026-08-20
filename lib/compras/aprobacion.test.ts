import { describe, it, expect } from "vitest";
import { nivelEnModulo } from "../core/access";
import type { Rol, UsuarioModulo } from "../core/types";

/**
 * La regla de aprobación vive en dos lados que tienen que decir lo mismo:
 * puede_aprobar_compras() en la base (020) y puedeAprobarCompras() en la app.
 * Este test fija la parte que se puede ejecutar sin base y, sobre todo, deja
 * asentada la diferencia con el resto de los permisos.
 */
const grant = (modulo: "compras" | "rrhh", nivel: UsuarioModulo["nivel"]): UsuarioModulo =>
  ({ id: modulo, usuario_id: "u", modulo, nivel });

/** Copia de la regla estricta: sólo el grant explícito, sin es_admin(). */
function puedeAprobar(grants: UsuarioModulo[]): boolean {
  return grants.some((g) => g.modulo === "compras" && g.nivel === "admin");
}

describe("quién puede aprobar en Compras", () => {
  it("un admin del sistema SIN el permiso no puede aprobar", () => {
    const rol: Rol = "admin_sistema";
    // Para todo lo demás, admin_sistema tiene nivel admin en el módulo...
    expect(nivelEnModulo(rol, [], "compras")).toBe("admin");
    // ...pero aprobar exige estar en la lista, igual que en la planilla.
    expect(puedeAprobar([])).toBe(false);
  });

  it("con el permiso explícito sí puede", () => {
    expect(puedeAprobar([grant("compras", "admin")])).toBe(true);
  });

  it("nivel edicion gestiona la compra pero no aprueba", () => {
    expect(puedeAprobar([grant("compras", "edicion")])).toBe(false);
  });

  it("tener admin en otro módulo no habilita a aprobar compras", () => {
    expect(puedeAprobar([grant("rrhh", "admin")])).toBe(false);
  });
});
