import { describe, expect, it } from "vitest";
import { razonesSocialesDeOdoo } from "./razonSocial";

const odoo = [
  { nombre: "GIACOMASSO MIGUEL ANGEL", cuit: "20-12345678-9" },
  { nombre: "HIERCONS S.R.L", cuit: "30711111119" },
];

describe("la razón social que se guarda", () => {
  /*
   * El caso que justifica todo esto: el padrón usa el nombre de fantasía y
   * Odoo el legal. Son dos datos distintos y el padrón ahora guarda los dos.
   */
  it("sale del CUIT y no del nombre, porque el nombre es justo lo que no coincide", () => {
    const r = razonesSocialesDeOdoo(
      [{ id: "1", nombre: "Distribuidora Pueyrredon", cuit: "20123456789" }],
      odoo
    );
    expect(r.razones).toEqual([
      { proveedorId: "1", nombre: "Distribuidora Pueyrredon", razonSocial: "GIACOMASSO MIGUEL ANGEL" },
    ]);
  });

  it("y no le importa cómo esté escrito el CUIT de cada lado", () => {
    const r = razonesSocialesDeOdoo([{ id: "1", nombre: "Hierros González", cuit: "30-71111111-9" }], odoo);
    expect(r.razones[0].razonSocial).toBe("HIERCONS S.R.L");
  });
});

describe("lo que se deja en null", () => {
  it("un proveedor sin CUIT no se puede cruzar", () => {
    expect(razonesSocialesDeOdoo([{ id: "1", nombre: "Sin CUIT", cuit: null }], odoo).razones).toHaveLength(0);
  });

  it("un CUIT que no está en Odoo", () => {
    expect(
      razonesSocialesDeOdoo([{ id: "1", nombre: "Otro", cuit: "30999999993" }], odoo).razones
    ).toHaveLength(0);
  });

  /*
   * Son 31 proveedores, y casi siempre es el mismo partner duplicado una vez
   * por empresa con el nombre escrito distinto. Elegir uno al azar pondría en
   * un documento formal un nombre que nadie confirmó.
   */
  it("un CUIT con dos nombres en Odoo: no se elige, se informa", () => {
    const dos = [
      { nombre: "ALE - WEI SOCIEDAD ANONIMA", cuit: "30708611154" },
      { nombre: "ALE - WEI SOCIEDAD ANONIMA 2", cuit: "30708611154" },
    ];
    const r = razonesSocialesDeOdoo([{ id: "1", nombre: "Ale Wei", cuit: "30708611154" }], dos);
    expect(r.razones).toHaveLength(0);
    expect(r.conDosNombres).toHaveLength(1);
    expect(r.conDosNombres[0].enOdoo).toHaveLength(2);
  });

  /*
   * El mismo nombre repetido en dos partners no es una ambigüedad: es el mismo
   * proveedor una vez por empresa.
   */
  it("pero el mismo nombre en dos partners sí se propone", () => {
    const dos = [
      { nombre: "HIERCONS S.R.L", cuit: "30711111119" },
      { nombre: "HIERCONS S.R.L", cuit: "30-71111111-9" },
    ];
    expect(razonesSocialesDeOdoo([{ id: "1", nombre: "Hierros", cuit: "30711111119" }], dos).razones)
      .toHaveLength(1);
  });

  /** Reescribir lo mismo ensucia el `updated_at` y simula haber hecho algo. */
  it("y no se propone si ya la tiene guardada", () => {
    const r = razonesSocialesDeOdoo(
      [{ id: "1", nombre: "Hierros", cuit: "30711111119", razonSocial: "HIERCONS S.R.L" }],
      odoo
    );
    expect(r.razones).toHaveLength(0);
  });

  it("pero sí si la que tiene es otra", () => {
    const r = razonesSocialesDeOdoo(
      [{ id: "1", nombre: "Hierros", cuit: "30711111119", razonSocial: "VIEJA S.A." }],
      odoo
    );
    expect(r.razones).toHaveLength(1);
  });

  it("un partner de Odoo sin nombre no aporta nada", () => {
    expect(
      razonesSocialesDeOdoo([{ id: "1", nombre: "X", cuit: "30711111119" }], [{ nombre: "  ", cuit: "30711111119" }])
        .razones
    ).toHaveLength(0);
  });
});
