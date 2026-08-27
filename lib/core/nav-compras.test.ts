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
  it("va en el orden del trabajo, con el tablero primero", () => {
    // El tablero es la entrada del modulo: dice de un vistazo cuanto hay en
    // cada etapa. Queda fijado para que no se de vuelta sin querer, igual que
    // el orden del circuito.
    expect(itemsDeCompras().map((i) => i.label)).toEqual([
      "Tablero",
      "Requerimientos",
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
