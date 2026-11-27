import { describe, expect, it } from "vitest";
import { fichasCompuestas, gruposDeDuplicados } from "./duplicadosDeProveedor";

const NAVARRO = "30710597363";
const MARFRA = "30714412333";

describe("los grupos por CUIT", () => {
  /** El mismo CUIT es un hecho: identifica a la empresa en AFIP y en Odoo. */
  it("dos filas con el mismo CUIT son un grupo", () => {
    const grupos = gruposDeDuplicados([
      { id: "a", nombre: "Todo Ruleman", cuit: "30590139072" },
      { id: "b", nombre: "Diego Guarrochena", cuit: "30-59013907-2" },
    ]);
    expect(grupos).toEqual([{ motivo: "mismo cuit", clave: "30590139072", ids: ["a", "b"] }]);
  });

  it("una sola fila con ese CUIT no es un duplicado", () => {
    expect(gruposDeDuplicados([{ id: "a", nombre: "Marfra", cuit: MARFRA }])).toHaveLength(0);
  });

  /*
   * Una fila no puede estar en dos grupos: fusionar uno cambiaría el otro
   * mientras alguien lo tiene en pantalla.
   */
  it("una fila que ya entró por CUIT no vuelve a entrar por nombre", () => {
    const grupos = gruposDeDuplicados([
      { id: "a", nombre: "Marfra", cuit: MARFRA },
      { id: "b", nombre: "Ferretería Marfra", cuit: MARFRA },
      { id: "c", nombre: "Marfra", cuit: null },
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].ids).toEqual(["a", "b"]);
  });
});

describe("los grupos por nombre", () => {
  it("un nombre contenido en el otro, con uno de los dos con CUIT", () => {
    const grupos = gruposDeDuplicados([
      { id: "a", nombre: "CANDIA", cuit: null },
      { id: "b", nombre: "Candia Rubén Horacio", cuit: "23121776839" },
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].motivo).toBe("nombre parecido");
    expect(grupos[0].ids.sort()).toEqual(["a", "b"]);
  });

  /*
   * Si ninguna tiene CUIT, fusionarlas no destraba nada: ninguna se iba a
   * conectar con Odoo igual. Son datos a ordenar, no un circuito frenado.
   */
  it("sin ningún CUIT en el grupo, no se propone", () => {
    expect(
      gruposDeDuplicados([
        { id: "a", nombre: "METAL SUPPLY", cuit: null },
        { id: "b", nombre: "Metal Supply SRL", cuit: null },
      ])
    ).toHaveLength(0);
  });

  /** Compartir el rubro no es ser el mismo proveedor. */
  it("dos nombres que sólo comparten la palabra del rubro no se juntan", () => {
    expect(
      gruposDeDuplicados([
        { id: "a", nombre: "Metalurgica Fonavi", cuit: NAVARRO },
        { id: "b", nombre: "Metalúrgica Mario", cuit: null },
      ])
    ).toHaveLength(0);
  });

  /*
   * `nombresParecidos` descarta los nombres sin ninguna palabra «propia» —de
   * cuatro letras o más y que no sea del rubro—, así que dos filas llamadas
   * igual podían quedar afuera. El mismo nombre dos veces es el duplicado más
   * obvio que hay.
   */
  it("el mismo nombre exacto en dos filas siempre es un grupo", () => {
    const grupos = gruposDeDuplicados([
      { id: "a", nombre: "SAAG", cuit: null },
      { id: "b", nombre: "SAAG", cuit: MARFRA },
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].ids.sort()).toEqual(["a", "b"]);
  });
});

describe("el orden", () => {
  /*
   * La pantalla numera los grupos: un orden que cambia entre dos lecturas
   * haría que «el grupo 7» no sea el mismo grupo que uno acaba de mirar.
   */
  it("los de CUIT van primero y ordenados, que es de más cierto a menos", () => {
    const grupos = gruposDeDuplicados([
      { id: "a", nombre: "CANDIA", cuit: null },
      { id: "b", nombre: "Candia Rubén Horacio", cuit: "23121776839" },
      { id: "c", nombre: "Todo Ruleman", cuit: "30590139072" },
      { id: "d", nombre: "Diego Guarrochena", cuit: "30590139072" },
      { id: "e", nombre: "Marfra", cuit: MARFRA },
      { id: "f", nombre: "Ferretería Marfra", cuit: MARFRA },
    ]);
    expect(grupos.map((g) => g.motivo)).toEqual(["mismo cuit", "mismo cuit", "nombre parecido"]);
    expect(grupos.slice(0, 2).map((g) => g.clave)).toEqual(["30590139072", MARFRA]);
  });
});

describe("la celda con varios proveedores adentro", () => {
  /*
   * El caso real: a un pedido se le compró a cuatro, quien llenó la planilla
   * puso los cuatro en la columna PROVEEDOR, y `asegurarProveedores()` tomó la
   * celda entera como el nombre de uno nuevo.
   */
  const padron = [
    { id: "compuesta", nombre: "PLATINO, ZMG, TRACK MAR, EQUIPARTES", cuit: null },
    { id: "guion", nombre: "TRACK MAR - EQUIPARTES", cuit: null },
    { id: "platino", nombre: "PLATINO", cuit: null },
    { id: "platino2", nombre: "Platino", cuit: "20439821540" },
    { id: "zmg", nombre: "ZMG", cuit: null },
    { id: "track", nombre: "TRACK MAR", cuit: null },
    { id: "equi", nombre: "EQUIPARTES", cuit: null },
  ];

  it("la reconoce por coma y por guion", () => {
    expect(fichasCompuestas(padron).map((f) => f.id).sort()).toEqual(["compuesta", "guion"]);
  });

  it("dice qué proveedores nombra", () => {
    const f = fichasCompuestas(padron).find((x) => x.id === "compuesta")!;
    expect(f.partes).toEqual(["PLATINO", "ZMG", "TRACK MAR", "EQUIPARTES"]);
  });

  /*
   * El reconocimiento es conservador: si un pedazo no es un proveedor que ya
   * existe, la coma es parte del nombre y no un separador.
   */
  it("una coma que no separa proveedores no la convierte en compuesta", () => {
    expect(
      fichasCompuestas([
        { id: "a", nombre: "Pagano, Kopaitich y asociados", cuit: null },
        { id: "b", nombre: "Pagano", cuit: null },
      ])
    ).toEqual([]);
  });

  /*
   * Es la razón de ser de todo esto: sin apartarla, la compuesta arrastra a
   * los tres proveedores de verdad a un grupo donde ya no se ve que el único
   * duplicado era «PLATINO» contra «Platino».
   */
  it("no entra a ningún grupo, y el duplicado real queda a la vista", () => {
    const grupos = gruposDeDuplicados(padron);
    expect(grupos.flatMap((g) => g.ids)).not.toContain("compuesta");
    expect(grupos.flatMap((g) => g.ids)).not.toContain("guion");
    expect(grupos).toHaveLength(1);
    expect(grupos[0].ids.sort()).toEqual(["platino", "platino2"]);
  });
});
