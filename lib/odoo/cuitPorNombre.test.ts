import { describe, expect, it } from "vitest";
import { normalizarNombre, proponerCuitPorNombre } from "./cuitPorNombre";

const odoo = [
  { nombre: "ZITO Y PRIOLA S.R.L.", cuit: "30-71182027-9" },
  { nombre: "RAS SA", cuit: "30620743336" },
  { nombre: "FERRETERIA MARFRA", cuit: "30714412333" },
];

describe("lo que se normaliza, porque no cambia quién es", () => {
  it("la forma societaria", () => {
    expect(normalizarNombre("ZITO Y PRIOLA S.R.L.")).toBe(normalizarNombre("Zito y Priola"));
    expect(normalizarNombre("RAS SA")).toBe(normalizarNombre("RAS"));
  });

  it("los acentos, las mayúsculas y los espacios de más", () => {
    expect(normalizarNombre("  Ferretería   MARFRA ")).toBe("FERRETERIA MARFRA");
  });

  /*
   * Con bordes de palabra: sin ellos «SAS» se comería el final de CASAS y dos
   * proveedores distintos quedarían con el mismo nombre normalizado.
   */
  it("pero no se come una palabra que termina igual", () => {
    expect(normalizarNombre("CASAS HERMANOS")).toBe("CASAS HERMANOS");
    expect(normalizarNombre("CASAS HERMANOS")).not.toBe(normalizarNombre("CASA HERMANOS"));
  });
});

describe("lo que se propone", () => {
  it("el nombre que coincide con un único CUIT", () => {
    const r = proponerCuitPorNombre([{ id: "1", nombre: "Zito y Priola" }], odoo).cuits;
    expect(r).toHaveLength(1);
    expect(r[0].cuit).toBe("30711820279");
    // El nombre de Odoo viaja para poder mirar los dos uno al lado del otro.
    expect(r[0].nombreEnOdoo).toBe("ZITO Y PRIOLA S.R.L.");
  });

  it("y el CUIT sale sin guiones", () => {
    expect(proponerCuitPorNombre([{ id: "1", nombre: "ZITO Y PRIOLA" }], odoo).cuits[0].cuit).toBe(
      "30711820279"
    );
  });
});

describe("lo que NO se propone, que es lo que importa", () => {
  /*
   * La regla de diseño del sistema: enlazar al que se le parece es peor que
   * dejar en null. Acá muerde más que en otros lados — un CUIT equivocado en el
   * padrón hace que las facturas de otro proveedor se enganchen solas con éste.
   */
  it("un nombre parecido pero no idéntico", () => {
    expect(proponerCuitPorNombre([{ id: "1", nombre: "Zito Priola" }], odoo).cuits).toHaveLength(0);
    expect(proponerCuitPorNombre([{ id: "1", nombre: "Ferreteria Marfra 2" }], odoo).cuits).toHaveLength(0);
  });

  it("un nombre que en Odoo cae en dos CUIT distintos", () => {
    const dos = [
      { nombre: "HERMANOS LOPEZ", cuit: "30111111119" },
      { nombre: "Hermanos Lopez S.A.", cuit: "30222222228" },
    ];
    expect(proponerCuitPorNombre([{ id: "1", nombre: "HERMANOS LOPEZ" }], dos).cuits).toHaveLength(0);
  });

  /*
   * El mismo proveedor existe una vez por empresa en Odoo, y eso no es una
   * ambigüedad: los dos partners traen el mismo CUIT.
   */
  it("pero el mismo CUIT en dos partners sí se propone", () => {
    const dos = [
      { nombre: "EXPRESO 7400", cuit: "30-70793304-4" },
      { nombre: "EXPRESO 7400 S.R.L.", cuit: "30707933044" },
    ];
    expect(proponerCuitPorNombre([{ id: "1", nombre: "Expreso 7400" }], dos).cuits).toHaveLength(1);
  });

  it("un nombre que no está en Odoo", () => {
    expect(proponerCuitPorNombre([{ id: "1", nombre: "NO EXISTE" }], odoo).cuits).toHaveLength(0);
  });

  /** Un proveedor llamado «S.A.» no es nadie, y normalizado queda vacío. */
  it("un nombre que al normalizar queda vacío", () => {
    expect(proponerCuitPorNombre([{ id: "1", nombre: "S.A." }], odoo).cuits).toHaveLength(0);
    expect(proponerCuitPorNombre([{ id: "1", nombre: "  " }], odoo).cuits).toHaveLength(0);
  });

  it("y un partner de Odoo sin CUIT no aporta nada", () => {
    expect(proponerCuitPorNombre([{ id: "1", nombre: "VACIO" }], [{ nombre: "VACIO", cuit: "" }]).cuits)
      .toHaveLength(0);
  });
});

/*
 * Apareció en el primer ensayo contra los datos reales, no pensándolo: el
 * padrón tiene la misma empresa cargada dos veces con nombres que normalizan
 * igual. Ponerles el CUIT a las dos deja un duplicado que el cruce por CUIT se
 * niega a enlazar — o sea, trabajo que no sirve y más difícil de deshacer.
 */
describe("dos filas del padrón que son la misma empresa", () => {
  const pagano = [{ nombre: "Pagano y Kopaitich SRL", cuit: "30673989515" }];

  it("no se les escribe a ninguna, y se informan juntas", () => {
    const r = proponerCuitPorNombre(
      [
        { id: "1", nombre: "Pagano y Kopaitich SRL" },
        { id: "2", nombre: "Pagano y kopaitich" },
      ],
      pagano
    );
    expect(r.cuits).toHaveLength(0);
    expect(r.repetidos).toHaveLength(1);
    expect(r.repetidos[0].proveedores.map((p) => p.id).sort()).toEqual(["1", "2"]);
  });

  /*
   * El mismo duplicado, pero más difícil de ver: el CUIT ya está en otra fila
   * del padrón que sí lo tenía.
   */
  it("tampoco si el CUIT ya lo usa otro proveedor del padrón", () => {
    const r = proponerCuitPorNombre(
      [{ id: "1", nombre: "Pagano y kopaitich" }],
      pagano,
      ["30-67398951-5"]
    );
    expect(r.cuits).toHaveLength(0);
    expect(r.repetidos).toHaveLength(1);
  });

  it("y una sola fila con un CUIT libre sí se escribe", () => {
    const r = proponerCuitPorNombre([{ id: "1", nombre: "Pagano y kopaitich" }], pagano, ["30111111119"]);
    expect(r.cuits).toHaveLength(1);
    expect(r.repetidos).toHaveLength(0);
  });
});
