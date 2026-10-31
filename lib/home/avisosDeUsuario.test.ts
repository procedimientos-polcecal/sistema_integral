import { describe, it, expect } from "vitest";
import { sinLoQueNoPuedeAtender } from "./avisosDeUsuario";
import type { Notificacion } from "./notificaciones";

const avisos: Notificacion[] = [
  { id: "compras-por-aprobar", titulo: "Requerimientos esperando aprobación", cantidad: 11, href: "/a" },
  { id: "mant-atrasadas", titulo: "Órdenes de trabajo atrasadas", cantidad: 23, href: "/b" },
];

/** Quien no está en ninguna de las dos listas. */
const EN_NINGUNA = { apruebaCompras: false, contestaConsultas: false };

describe("sinLoQueNoPuedeAtender", () => {
  /*
   * Medido el 18/10/2026: "Requerimientos esperando aprobacion" le llegaba a 6
   * personas y 3 no estaban en `compras_aprobadores`. Pedirle a alguien algo
   * que no puede hacer enseña que un aviso tuyo puede no ser tuyo.
   */
  it("quien no aprueba no recibe el aviso de aprobacion", () => {
    expect(
      sinLoQueNoPuedeAtender(avisos, EN_NINGUNA).map((a) => a.id)
    ).toEqual(["mant-atrasadas"]);
  });

  it("quien aprueba lo recibe", () => {
    expect(
      sinLoQueNoPuedeAtender(avisos, { ...EN_NINGUNA, apruebaCompras: true }).map((a) => a.id)
    ).toEqual(["compras-por-aprobar", "mant-atrasadas"]);
  });

  /*
   * Las consultas de repuestos van a `compras_consultados` y no a todo el que
   * vea Compras, por lo mismo que la aprobacion va a los aprobadores: el aviso
   * sale por los dos lados —campana y push—, asi que pedirle a seis personas
   * algo que contesta una es una notificacion en el telefono de cinco que no
   * pueden hacer nada. Medido el 26/10/2026, `compras_aprobadores` tiene cuatro
   * y solo una es quien contesta.
   *
   * Y son listas **distintas**: estar en una no pone en la otra.
   */
  const consultas: Notificacion[] = [
    { id: "compras-consultas-repuestos", titulo: "Consultas de repuestos sin responder", cantidad: 3, href: "/c" },
    { id: "mant-atrasadas", titulo: "Órdenes de trabajo atrasadas", cantidad: 23, href: "/b" },
  ];

  it("a quien no contesta consultas no le llega la de los repuestos", () => {
    expect(
      sinLoQueNoPuedeAtender(consultas, EN_NINGUNA).map((a) => a.id)
    ).toEqual(["mant-atrasadas"]);
  });

  it("a quien contesta consultas si", () => {
    expect(
      sinLoQueNoPuedeAtender(consultas, { ...EN_NINGUNA, contestaConsultas: true }).map((a) => a.id)
    ).toEqual(["compras-consultas-repuestos", "mant-atrasadas"]);
  });

  it("aprobar no es contestar: cada lista reparte lo suyo", () => {
    const todo = [...avisos, ...consultas.slice(0, 1)];

    expect(
      sinLoQueNoPuedeAtender(todo, { apruebaCompras: true, contestaConsultas: false }).map((a) => a.id)
    ).toEqual(["compras-por-aprobar", "mant-atrasadas"]);
    expect(
      sinLoQueNoPuedeAtender(todo, { apruebaCompras: false, contestaConsultas: true }).map((a) => a.id)
    ).toEqual(["mant-atrasadas", "compras-consultas-repuestos"]);
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
    expect(sinLoQueNoPuedeAtender(otros, EN_NINGUNA)).toEqual(otros);
  });

  it("sin avisos no devuelve nada y no rompe", () => {
    expect(sinLoQueNoPuedeAtender([], { apruebaCompras: true, contestaConsultas: true })).toEqual([]);
  });
});
