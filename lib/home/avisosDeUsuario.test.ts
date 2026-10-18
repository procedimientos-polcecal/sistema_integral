import { describe, it, expect } from "vitest";
import { sinLoQueNoPuedeAtender } from "./avisosDeUsuario";
import type { Notificacion } from "./notificaciones";

const avisos: Notificacion[] = [
  { id: "compras-por-aprobar", titulo: "Requerimientos esperando aprobación", cantidad: 11, href: "/a" },
  { id: "mant-atrasadas", titulo: "Órdenes de trabajo atrasadas", cantidad: 23, href: "/b" },
];

describe("sinLoQueNoPuedeAtender", () => {
  /*
   * Medido el 18/10/2026: "Requerimientos esperando aprobacion" le llegaba a 6
   * personas y 3 no estaban en `compras_aprobadores`. Pedirle a alguien algo
   * que no puede hacer enseña que un aviso tuyo puede no ser tuyo.
   */
  it("quien no aprueba no recibe el aviso de aprobacion", () => {
    expect(
      sinLoQueNoPuedeAtender(avisos, { apruebaCompras: false }).map((a) => a.id)
    ).toEqual(["mant-atrasadas"]);
  });

  it("quien aprueba lo recibe", () => {
    expect(
      sinLoQueNoPuedeAtender(avisos, { apruebaCompras: true }).map((a) => a.id)
    ).toEqual(["compras-por-aprobar", "mant-atrasadas"]);
  });

  /*
   * El filtro mira la LISTA, no el rol ni el nivel. Los administradores siguen
   * recibiendo todo lo demas, decidido a pedido el 18/10/2026: esto no es
   * repartir por permiso, es respetar una lista de responsables que ya existe.
   */
  it("no toca ningun otro aviso", () => {
    const otros: Notificacion[] = [
      { id: "ritmo-remises", titulo: "Remises: hace 82 días que no se carga", cantidad: 1, href: "/c" },
      { id: "taller-vial-sin-service", titulo: "Equipos sin ningún service registrado", cantidad: 15, href: "/d" },
    ];
    expect(sinLoQueNoPuedeAtender(otros, { apruebaCompras: false })).toEqual(otros);
  });

  it("sin avisos no devuelve nada y no rompe", () => {
    expect(sinLoQueNoPuedeAtender([], { apruebaCompras: true })).toEqual([]);
  });
});
