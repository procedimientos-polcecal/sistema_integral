import { describe, expect, it } from "vitest";
import { filtrarDescartadas } from "./notificaciones";

describe("filtrarDescartadas", () => {
  it("deja pasar una notificación sin descarte previo", () => {
    const resultado = filtrarDescartadas(
      [{ id: "rrhh-sin-clasificar", titulo: "x", cantidad: 3, href: "/x" }],
      []
    );
    expect(resultado).toHaveLength(1);
  });

  it("saca una notificación descartada si la cantidad no creció", () => {
    const resultado = filtrarDescartadas(
      [{ id: "rrhh-sin-clasificar", titulo: "x", cantidad: 3, href: "/x" }],
      [{ notificacion_id: "rrhh-sin-clasificar", cantidad_vista: 3 }]
    );
    expect(resultado).toHaveLength(0);
  });

  it("saca una notificación descartada aunque la cantidad haya bajado", () => {
    const resultado = filtrarDescartadas(
      [{ id: "rrhh-sin-clasificar", titulo: "x", cantidad: 1, href: "/x" }],
      [{ notificacion_id: "rrhh-sin-clasificar", cantidad_vista: 3 }]
    );
    expect(resultado).toHaveLength(0);
  });

  it("vuelve a mostrar la notificación si la cantidad creció desde el descarte", () => {
    const resultado = filtrarDescartadas(
      [{ id: "rrhh-sin-clasificar", titulo: "x", cantidad: 5, href: "/x" }],
      [{ notificacion_id: "rrhh-sin-clasificar", cantidad_vista: 3 }]
    );
    expect(resultado).toHaveLength(1);
    expect(resultado[0].cantidad).toBe(5);
  });

  it("no toca las notificaciones que no tienen descarte, aunque otras sí", () => {
    const resultado = filtrarDescartadas(
      [
        { id: "a", titulo: "a", cantidad: 2, href: "/a" },
        { id: "b", titulo: "b", cantidad: 2, href: "/b" },
      ],
      [{ notificacion_id: "a", cantidad_vista: 2 }]
    );
    expect(resultado.map((n) => n.id)).toEqual(["b"]);
  });
});
