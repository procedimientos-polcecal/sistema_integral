import { describe, it, expect } from "vitest";
import { modulosVisibles, nivelEnModulo, MODULOS_ORDEN } from "./access";
import { NAV, type NavItem } from "./nav";
import type { Modulo, Rol, UsuarioModulo } from "./types";

/** Misma función que usa components/Sidebar.tsx para filtrar. */
function visible(item: NavItem, modulos: Set<Modulo>, esAdminGlobal: boolean, adminModulos: Set<Modulo>): boolean {
  if (item.soloAdminGlobal) return esAdminGlobal;
  if (item.soloAdmin) return item.modulo ? adminModulos.has(item.modulo) : esAdminGlobal;
  if (!item.modulo) return true;
  return modulos.has(item.modulo);
}

/** Reproduce lo que arma app/(app)/layout.tsx y renderiza el Sidebar. */
function etiquetasDelSidebar(rol: Rol, grants: UsuarioModulo[]): string[] {
  const modulos = new Set(modulosVisibles(rol, grants));
  const modulosAdmin = new Set(MODULOS_ORDEN.filter((m) => nivelEnModulo(rol, grants, m) === "admin"));
  const esAdminGlobal = rol === "admin_sistema" || rol === "admin";
  return NAV.filter((i) => visible(i, modulos, esAdminGlobal, modulosAdmin)).map((i) => i.label);
}

const grant = (modulo: Modulo, nivel: UsuarioModulo["nivel"]): UsuarioModulo =>
  ({ id: modulo, usuario_id: "u", modulo, nivel });

describe("visibilidad del módulo Compras en el sidebar", () => {
  it("admin_sistema lo ve aunque no tenga ningún grant", () => {
    expect(etiquetasDelSidebar("admin_sistema", [])).toContain("Compras");
  });

  it("admin_sistema lo ve con grants de otros módulos", () => {
    const grants = [grant("rrhh", "admin"), grant("remises", "admin"), grant("mantenimiento", "admin")];
    expect(etiquetasDelSidebar("admin_sistema", grants)).toContain("Compras");
  });

  it("un operario con grant de compras lo ve", () => {
    expect(etiquetasDelSidebar("operario", [grant("compras", "lectura")])).toContain("Compras");
  });

  it("un operario sin grant de compras no lo ve", () => {
    expect(etiquetasDelSidebar("operario", [grant("rrhh", "admin")])).not.toContain("Compras");
  });

  it("«Mis pedidos» lo ve cualquiera, tenga o no el módulo", () => {
    expect(etiquetasDelSidebar("operario", [])).toContain("Mis pedidos");
  });
});
