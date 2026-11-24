import { describe, it, expect } from "vitest";
import {
  validarAlta, parecidosEnElPadron, empresasDelRequerimiento, destinoDelAlta, empresaParaGuardar,
  type ProveedorDelPadron,
} from "./altaDeProveedor";

const padron: ProveedorDelPadron[] = [
  { id: "a", nombre: "Matelec", cuit: "30-70801757-0" },
  { id: "b", nombre: "TODO RULEMAN, EQUIPARTES", cuit: null },
];

describe("validarAlta", () => {
  it("el nombre vacío es un problema", () => {
    expect(
      validarAlta({ nombre: "  ", cuit: "30-71182027-9" }, padron).some((p) => p.campo === "nombre")
    ).toBe(true);
  });

  /*
   * «Falta» y «está mal escrito» mandan a hacer cosas distintas: al que se
   * comió un dígito decirle que el campo es obligatorio es falso —lo llenó— y
   * lo deja mirando un campo lleno que el sistema dice que está vacío.
   */
  it("un CUIT de diez dígitos dice que está mal escrito, no que falte", () => {
    const p = validarAlta({ nombre: "Nuevo", cuit: "3070801757" }, padron)
      .find((x) => x.campo === "cuit");
    expect(p?.mensaje).toContain("once dígitos");
    expect(p?.mensaje).not.toContain("obligatorio");
  });

  it("el CUIT es obligatorio", () => {
    expect(validarAlta({ nombre: "Nuevo", cuit: "" }, padron).map((p) => p.campo)).toContain("cuit");
  });

  it("un CUIT inválido se rechaza", () => {
    expect(
      validarAlta({ nombre: "Nuevo", cuit: "30708017571" }, padron).map((p) => p.campo)
    ).toContain("cuit");
  });

  /*
   * El freno duro. Dos filas con el mismo CUIT es el caso que
   * `cruzarProveedores()` informa y NO enlaza: crear la segunda deja a las dos
   * sin poder llegar a una orden de compra.
   */
  it("un CUIT que ya está en el padrón nombra al que lo tiene", () => {
    const [p] = validarAlta({ nombre: "Matelec SRL", cuit: "30708017570" }, padron);
    expect(p.campo).toBe("cuit");
    expect(p.proveedorExistente).toEqual({ id: "a", nombre: "Matelec" });
  });

  it("compara el CUIT normalizado: con guiones y sin guiones son el mismo", () => {
    expect(
      validarAlta({ nombre: "Otro", cuit: "30-708017570" }, padron)
        .some((p) => p.proveedorExistente?.id === "a")
    ).toBe(true);
  });

  it("un alta limpia no tiene problemas", () => {
    expect(validarAlta({ nombre: "Nuevo", cuit: "30-71182027-9" }, padron)).toEqual([]);
  });
});

describe("parecidosEnElPadron", () => {
  // Avisa, no frena: por eso va aparte de validarAlta.
  it("encuentra el parecido aunque cambie mayúsculas y acentos", () => {
    expect(parecidosEnElPadron("MATELEC", padron).map((p) => p.id)).toEqual(["a"]);
  });

  it("un nombre que no se parece a nada devuelve vacío", () => {
    expect(parecidosEnElPadron("Ferretería Zulema", padron)).toEqual([]);
  });
});

describe("empresasDelRequerimiento", () => {
  const empresas = [
    { id: "pol", odoo_company_id: 1 },
    { id: "pys", odoo_company_id: 2 },
  ];

  it("un RI de una empresa da una", () => {
    expect(empresasDelRequerimiento({ empresa_id: "pol", paga_ambas: false }, empresas))
      .toEqual([{ id: "pol", odooCompanyId: 1 }]);
  });

  it("AMBAS da las dos", () => {
    expect(empresasDelRequerimiento({ empresa_id: null, paga_ambas: true }, empresas))
      .toHaveLength(2);
  });

  // 17 de 1.024 RI están así. No hay empresa contra la cual buscar ni crear.
  it("sin empresa y sin paga_ambas no da ninguna", () => {
    expect(empresasDelRequerimiento({ empresa_id: null, paga_ambas: false }, empresas))
      .toEqual([]);
  });

  it("una empresa sin odoo_company_id queda afuera", () => {
    expect(
      empresasDelRequerimiento({ empresa_id: "x", paga_ambas: false }, [{ id: "x", odoo_company_id: null }])
    ).toEqual([]);
  });
});

/*
 * En Odoo funcionan dos perfiles —POLCECAL (`res.company` 1) y POLYSAN (2)— y
 * el padrón del SdG es uno solo. Hasta el 24/11/2026 a qué perfil iba el
 * proveedor nuevo lo decidía el pedido que lo estaba cotizando y nadie más;
 * desde que el alta lo pregunta, lo que la persona elige manda, y el pedido
 * queda de respaldo para cuando no eligió.
 */
describe("destinoDelAlta", () => {
  const empresas = [
    { id: "pol", odoo_company_id: 1 },
    { id: "pys", odoo_company_id: 2 },
  ];
  const sinElegir = { empresaId: null, ambas: false };

  it("lo que se eligió manda sobre lo que dice el pedido", () => {
    expect(
      destinoDelAlta(
        { empresaId: "pys", ambas: false },
        { empresa_id: "pol", paga_ambas: false },
        empresas
      )
    ).toEqual([{ id: "pys", odooCompanyId: 2 }]);
  });

  it("elegir las dos da las dos aunque el pedido diga una", () => {
    expect(
      destinoDelAlta({ empresaId: null, ambas: true }, { empresa_id: "pol", paga_ambas: false }, empresas)
    ).toHaveLength(2);
  });

  it("sin elegir, manda el pedido", () => {
    expect(destinoDelAlta(sinElegir, { empresa_id: "pol", paga_ambas: false }, empresas))
      .toEqual([{ id: "pol", odooCompanyId: 1 }]);
  });

  /*
   * Sin pedido no hay nada que mande, y enlazar no crea nada en Odoo: el
   * partner ya existe allá. Se mira en las dos en vez de no mirar.
   */
  it("sin elegir y sin pedido, se miran las dos", () => {
    expect(destinoDelAlta(sinElegir, null, empresas)).toHaveLength(2);
  });

  // 17 de 1.024 RI no dicen empresa ni AMBAS: ahí no hay dónde buscar, y la
  // ruta lo dice en vez de inventar una.
  it("sin elegir y con un pedido que no dice nada, no hay destino", () => {
    expect(destinoDelAlta(sinElegir, { empresa_id: null, paga_ambas: false }, empresas)).toEqual([]);
  });
});

/*
 * Las dos columnas son excluyentes por un check de la base
 * (`proveedores_empresa_o_ambas`). Si llegaran las dos cargadas, Postgres
 * contesta un 23514 crudo que nadie entiende; es más barato que ninguna ruta
 * pueda mandarlas así.
 */
describe("empresaParaGuardar", () => {
  it("con las dos marcadas, gana «las dos» y la empresa viaja en null", () => {
    expect(empresaParaGuardar({ empresa_id: "pol", trabaja_con_ambas: true }))
      .toEqual({ empresa_id: null, trabaja_con_ambas: true });
  });

  it("una empresa sola viaja tal cual", () => {
    expect(empresaParaGuardar({ empresa_id: "pol", trabaja_con_ambas: false }))
      .toEqual({ empresa_id: "pol", trabaja_con_ambas: false });
  });

  it("sin nada es «no se sabe», que es un estado válido", () => {
    expect(empresaParaGuardar({})).toEqual({ empresa_id: null, trabaja_con_ambas: false });
  });

  // Una cadena vacía es lo que manda un desplegable sin elegir, y no es un id.
  it("la cadena vacía del desplegable no es una empresa", () => {
    expect(empresaParaGuardar({ empresa_id: "" }))
      .toEqual({ empresa_id: null, trabaja_con_ambas: false });
  });
});
