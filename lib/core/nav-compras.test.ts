import { describe, it, expect } from "vitest";
import { NAV, puedeVerItem, type NavItem, type ContextoNav } from "./nav";
import type { Modulo } from "./types";

const itemsDeCompras = (): NavItem[] => {
  const grupo = NAV.find((n) => n.label === "Compras");
  if (!grupo?.children) throw new Error("falta el grupo Compras");
  return grupo.children;
};

const ctx = (over: Partial<ContextoNav> = {}): ContextoNav => ({
  modulos: new Set<Modulo>(["compras"]),
  adminModulos: new Set<Modulo>(),
  esAdminGlobal: false,
  esAprobadorCompras: false,
  ...over,
});

const visibles = (c: ContextoNav) =>
  itemsDeCompras().filter((i) => puedeVerItem(i, c)).map((i) => i.label);

describe("menu de Compras", () => {
  it("va en el orden del trabajo: primero los resumenes", () => {
    // Dashboard y Tablero arriba, y despues el dia a dia. Queda fijado para
    // que no se de vuelta sin querer, igual que el orden del circuito.
    expect(itemsDeCompras().map((i) => i.label)).toEqual([
      "Dashboard",
      "Tablero",
      "Requerimientos",
      // Al lado de Requerimientos porque es el mismo trabajo: se piden
      // presupuestos y se baja una comparativa, sobre un servicio en vez de un
      // material.
      "Órdenes de servicio",
      "Aprobaciones",
      "Para aprobar",
      "Proveedores",
      "Ubicaciones",
      "Configuración",
    ]);
  });

  it("quien tiene el modulo ve el trabajo del dia a dia", () => {
    const v = visibles(ctx());
    expect(v).toContain("Tablero");
    expect(v).toContain("Requerimientos");
  });

  /**
   * Aprobar dejo de depender del nivel: administrar el modulo y autorizar un
   * gasto son cosas distintas y las hacen personas distintas.
   */
  it("sin estar en la lista no se ven las pantallas de aprobar, ni siendo admin", () => {
    const v = visibles(ctx({ adminModulos: new Set<Modulo>(["compras"]), esAdminGlobal: true }));
    expect(v).not.toContain("Aprobaciones");
    expect(v).not.toContain("Para aprobar");
    // Administrar si, que es lo suyo.
    expect(v).toContain("Configuración");
  });

  it("quien esta en la lista ve las dos, sin ser admin", () => {
    const v = visibles(ctx({ esAprobadorCompras: true }));
    expect(v).toContain("Aprobaciones");
    expect(v).toContain("Para aprobar");
    expect(v).not.toContain("Configuración");
  });

  it("quien no tiene el modulo no ve nada de Compras", () => {
    const ajeno = ctx({ modulos: new Set<Modulo>(), esAprobadorCompras: true });
    expect(visibles(ajeno)).toHaveLength(0);
  });
});

/**
 * Las ordenes de servicio se van a gestionar desde Compras, y por ahora el menu
 * las alcanza con un atajo a la pantalla que ya existe en Mantenimiento. No es
 * una copia: duplicarla dejaria dos pantallas diciendo cosas distintas de la
 * misma OS.
 *
 * Al vivir en el menu de Compras pero apuntar a una ruta de Mantenimiento, el
 * atajo necesita las dos cosas. El grupo Compras aporta una y el item la otra.
 */
describe("el atajo a ordenes de servicio", () => {
  const atajo = () => {
    const i = itemsDeCompras().find((x) => x.label === "Órdenes de servicio");
    if (!i) throw new Error("falta el atajo a ordenes de servicio");
    return i;
  };

  /**
   * Como lo filtra el Sidebar: primero el grupo, y sus hijos solo si el grupo
   * quedo. `visibles()` de arriba mira nada mas los hijos, asi que por si solo
   * no puede decir nada sobre el atajo —que necesita las dos mitades—.
   */
  const enElMenu = (c: ContextoNav): string[] => {
    const grupo = NAV.find((n) => n.label === "Compras")!;
    if (!puedeVerItem(grupo, c)) return [];
    return (grupo.children ?? []).filter((i) => puedeVerItem(i, c)).map((i) => i.label);
  };

  it("apunta a la pantalla de Mantenimiento y no a una copia bajo compras", () => {
    expect(atajo().href).toBe("/mantenimiento/ordenes-servicio");
  });

  it("no se le muestra a quien no puede abrirlo", () => {
    // El layout de Mantenimiento manda a "/" a quien no tenga el modulo: un
    // item que rebota es peor que un item que no esta.
    expect(enElMenu(ctx())).not.toContain("Órdenes de servicio");
  });

  it("se ve con los dos accesos, que es lo que hace falta para usarlo", () => {
    const v = enElMenu(ctx({ modulos: new Set<Modulo>(["compras", "mantenimiento"]) }));
    expect(v).toContain("Órdenes de servicio");
  });

  it("sin Compras no aparece, aunque se tenga Mantenimiento", () => {
    // Ahi se entra por el menu de Mantenimiento, que es donde vivio siempre:
    // el grupo Compras no se dibuja y con el se van todos sus hijos.
    expect(enElMenu(ctx({ modulos: new Set<Modulo>(["mantenimiento"]) }))).toHaveLength(0);
  });
});
