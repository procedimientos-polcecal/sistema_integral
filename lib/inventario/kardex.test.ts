import { describe, it, expect } from "vitest";
import { descripcionDelArticulo } from "./kardex";

describe("la descripcion del articulo embebido", () => {
  it("lee la forma que devuelve hoy PostgREST: un objeto", () => {
    expect(descripcionDelArticulo({ articulo: { descripcion: "CINTA AISLADORA" } }))
      .toBe("CINTA AISLADORA");
  });

  it("lee tambien la forma de arreglo, que es la que infiere el tipo", () => {
    // Si alguna vez el embed cambia de forma, la columna «Artículo» no se
    // queda sin nombre: ése es todo el motivo por el que esto es una función.
    expect(descripcionDelArticulo({ articulo: [{ descripcion: "CINTA AISLADORA" }] }))
      .toBe("CINTA AISLADORA");
  });

  it("sin articulo devuelve null, y la pantalla decide que dibujar", () => {
    expect(descripcionDelArticulo({ articulo: null })).toBeNull();
    expect(descripcionDelArticulo({ articulo: [] })).toBeNull();
    expect(descripcionDelArticulo({})).toBeNull();
    expect(descripcionDelArticulo(null)).toBeNull();
    expect(descripcionDelArticulo(undefined)).toBeNull();
  });

  it("una descripcion vacia o en blanco es lo mismo que no tenerla", () => {
    // Un `""` pintaría un renglón vacío abajo del código y la fila mediría dos
    // líneas para no decir nada.
    expect(descripcionDelArticulo({ articulo: { descripcion: "" } })).toBeNull();
    expect(descripcionDelArticulo({ articulo: { descripcion: "   " } })).toBeNull();
    expect(descripcionDelArticulo({ articulo: { descripcion: null } })).toBeNull();
  });

  it("recorta los espacios, que la planilla trae de a ratos", () => {
    expect(descripcionDelArticulo({ articulo: { descripcion: "  CORREA B-142  " } }))
      .toBe("CORREA B-142");
  });
});
