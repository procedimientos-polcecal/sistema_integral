import { describe, expect, it } from "vitest";
import {
  TABLAS_QUE_APUNTAN,
  camposQueSeMudan,
  problemaParaFusionar,
  type FilaDelPadron,
} from "./fusionDeProveedores";

const fila = (p: Partial<FilaDelPadron>): FilaDelPadron => ({
  id: "a",
  nombre: "FUNDICIONES NAVARRO",
  cuit: null,
  razon_social: null,
  ...p,
});

describe("qué se lleva la fila que queda", () => {
  /*
   * El caso que justifica toda la pantalla: la fila que usa la planilla no
   * tiene CUIT y su gemela sí. Fusionar es cómo el CUIT llega a la fila que
   * recibe los pedidos.
   */
  it("el CUIT y la razón social de la que se va", () => {
    const cambios = camposQueSeMudan(
      fila({ id: "a", nombre: "FUNDICIONES NAVARRO" }),
      fila({ id: "b", nombre: "Fundición Navarro", cuit: "30710597363", razon_social: "FUNDICION ELECTRICA NAVARRO S.A." })
    );
    expect(cambios).toEqual({ cuit: "30710597363", razon_social: "FUNDICION ELECTRICA NAVARRO S.A." });
  });

  /** Un dato que alguien escribió gana sobre el de la fila que se está yendo. */
  it("pero no pisa lo que la que queda ya tiene cargado", () => {
    const cambios = camposQueSeMudan(
      fila({ id: "a", telefono: "2284-111111" }),
      fila({ id: "b", telefono: "2284-999999", email: "ventas@ejemplo.com" })
    );
    expect(cambios).toEqual({ email: "ventas@ejemplo.com" });
  });

  it("una cadena en blanco cuenta como vacía", () => {
    expect(camposQueSeMudan(fila({ contacto: "   " }), fila({ id: "b", contacto: "Marta" })))
      .toEqual({ contacto: "Marta" });
  });

  /*
   * El `nombre` es con lo que la sincronización de Compras reconoce al
   * proveedor. Mudarlo mientras se borra la otra fila dejaría a la planilla sin
   * a quién apuntar por las dos puntas.
   */
  it("el nombre no se muda nunca", () => {
    const cambios = camposQueSeMudan(fila({ id: "a", nombre: "RANDAZZO" }), fila({ id: "b", nombre: "Ferretería Randazzo" }));
    expect(cambios).not.toHaveProperty("nombre");
  });

  it("si alguna de las dos era contratista, la fusionada lo es", () => {
    expect(camposQueSeMudan(fila({ es_contratista: false }), fila({ id: "b", es_contratista: true })))
      .toEqual({ es_contratista: true });
  });

  /** Un booleano en false no es «vacío»: no se copia al revés. */
  it("y una bandera apagada en la que se va no apaga la de la que queda", () => {
    expect(camposQueSeMudan(fila({ activo: true }), fila({ id: "b", activo: false }))).toEqual({});
  });

  it("sin nada que mudar devuelve vacío, para no ensuciar el updated_at", () => {
    expect(camposQueSeMudan(fila({ cuit: "30710597363" }), fila({ id: "b", cuit: "30710597363" }))).toEqual({});
  });
});

describe("cuándo no se puede fusionar", () => {
  /*
   * Dos CUITs válidos y distintos no son un duplicado: son dos empresas.
   * Fusionarlas mandaría las facturas de una a la cuenta de la otra.
   */
  it("dos CUITs distintos frenan la fusión", () => {
    const problema = problemaParaFusionar(
      fila({ id: "a", nombre: "SINGLA", cuit: "30666555097" }),
      fila({ id: "b", nombre: "FASE 3", cuit: "30711482306" })
    );
    expect(problema).toContain("dos empresas distintas");
  });

  it("escrito distinto es el mismo CUIT y no frena", () => {
    expect(
      problemaParaFusionar(fila({ cuit: "30-71059736-3" }), fila({ id: "b", cuit: "30710597363" }))
    ).toBeNull();
  });

  it("uno con CUIT y el otro sin, que es el caso normal, no frena", () => {
    expect(problemaParaFusionar(fila({ cuit: null }), fila({ id: "b", cuit: "30710597363" }))).toBeNull();
  });

  it("la misma fila consigo misma", () => {
    expect(problemaParaFusionar(fila({ id: "a" }), fila({ id: "a" }))).toBe("Es la misma fila.");
  });
});

describe("las tablas que hay que re-apuntar", () => {
  /*
   * Son las 19 de `node scripts/que-cuelga-de.mjs proveedores`. El número está
   * fijado acá para que agregar una tabla que apunte a `proveedores` y
   * olvidarse de esta lista rompa un test en vez de dejar filas huérfanas
   * apuntando a un id borrado.
   */
  it("son 19 y no se repiten", () => {
    expect(TABLAS_QUE_APUNTAN).toHaveLength(19);
    expect(new Set(TABLAS_QUE_APUNTAN.map((t) => t.tabla)).size).toBe(19);
  });

  it("las que pueden chocar dicen qué hacer", () => {
    const conChoque = TABLAS_QUE_APUNTAN.filter((t) => t.choque);
    expect(conChoque.map((t) => t.tabla).sort()).toEqual([
      "cantera_contratistas",
      "compras_requerimiento_proveedores",
      "despacho_recepcion_proveedores",
      "proveedores_odoo",
    ]);
  });

  /** Donde `proveedor_id` es la clave primaria, la fila lleva datos propios. */
  it("las que frenan son las dos donde proveedor_id es la clave entera", () => {
    const frenan = TABLAS_QUE_APUNTAN.filter((t) => t.choque?.que === "frenar");
    expect(frenan.map((t) => t.tabla).sort()).toEqual(["cantera_contratistas", "despacho_recepcion_proveedores"]);
    expect(frenan.every((t) => t.choque?.columna === null)).toBe(true);
  });
});
