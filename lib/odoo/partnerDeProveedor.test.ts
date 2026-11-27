import { describe, it, expect } from "vitest";
import {
  dominioPorCuit, candidatosDelCuit, valsDelPartner, hayQueCrearlo,
} from "./partnerDeProveedor";
import type { PartnerCandidato } from "./proveedores";

const candidato = (id: number, extra: Partial<PartnerCandidato> = {}): PartnerCandidato => ({
  id, nombre: `Partner ${id}`, empresa: 1, activo: true, esContactoDeOtro: false, usos: 0, ...extra,
});

describe("dominioPorCuit", () => {
  /*
   * Medido el 23/11/2026 contra Odoo: de 1.639 partners con `vat`, 1.636 son
   * dígitos puros y DOS están guardados con guiones (`30-689471524`,
   * `33-655088429`). Un dominio `["vat","in",[11 dígitos]]` no los encuentra,
   * la pantalla diría «todavía no está en Odoo» y la generación de la orden
   * crearía el partner que ya existía — el anti-objetivo número uno del spec.
   */
  it("busca el CUIT exacto Y por los últimos seis dígitos", () => {
    const d = JSON.stringify(dominioPorCuit("30-689471524"));
    expect(d).toContain("30689471524");
    expect(d).toContain("471524");
  });
});

describe("candidatosDelCuit", () => {
  it("acepta el partner guardado con guiones", () => {
    const vats = new Map<number, string | false>([[7, "30-689471524"]]);
    expect(candidatosDelCuit([candidato(7, { usos: 3 })], "30689471524", vats).map((c) => c.id))
      .toEqual([7]);
  });

  // El ilike de los seis dígitos puede traer a otro: se descarta en JS.
  it("descarta al que sólo comparte los últimos seis dígitos", () => {
    const vats = new Map<number, string | false>([[8, "27689471524"]]);
    expect(candidatosDelCuit([candidato(8)], "30689471524", vats)).toEqual([]);
  });

  it("descarta al que no tiene CUIT", () => {
    const vats = new Map<number, string | false>([[9, false]]);
    expect(candidatosDelCuit([candidato(9)], "30689471524", vats)).toEqual([]);
  });
});

describe("valsDelPartner", () => {
  /*
   * Medido el 23/11/2026 sobre los 658 partners con supplier_rank > 0: 627
   * tienen `partner_document_type_id` = CUIT y 656 `income_wh_registration` = "1".
   */
  it("lleva el CUIT sin guiones, el nombre y los dos campos de contabilidad", () => {
    const v = valsDelPartner({
      nombre: "X", cuit: "30-71182027-9", tipoDocumentoId: 25, regimenGanancias: "1",
    });
    expect(v.vat).toBe("30711820279");
    expect(v.name).toBe("X");
    expect(v.partner_document_type_id).toBe(25);
    expect(v.income_wh_registration).toBe("1");
  });

  /*
   * `supplier_rank` es lo que el cruce masivo de /api/odoo/proveedores/enlazar
   * usa para encontrarlo después: busca [["supplier_rank", ">", 0]]. Sin esto
   * el partner queda invisible y volvería a aparecer como «no está en Odoo».
   */
  it("supplier_rank nunca es cero", () => {
    expect(
      valsDelPartner({ nombre: "X", cuit: "30711820279", tipoDocumentoId: null, regimenGanancias: "1" })
        .supplier_rank
    ).toBe(1);
  });

  // No es `required` en Odoo: si el catálogo no tiene «CUIT», se crea sin él
  // en vez de inventar un id.
  it("sin tipo de documento el campo no viaja", () => {
    expect(
      "partner_document_type_id" in
        valsDelPartner({ nombre: "X", cuit: "30711820279", tipoDocumentoId: null, regimenGanancias: "1" })
    ).toBe(false);
  });

  // `income_wh_registration` sí es required: si default_get no lo dio, que no
  // viaje en null — que falle Odoo con su mensaje, no el SdG con un vacío.
  it("sin régimen el campo no viaja", () => {
    expect(
      "income_wh_registration" in
        valsDelPartner({ nombre: "X", cuit: "30711820279", tipoDocumentoId: 25, regimenGanancias: null })
    ).toBe(false);
  });
});

/**
 * Evalúa un dominio de Odoo que es un OR de términos simples: saltea los `|`
 * de la notación polaca y pregunta si alguno de los términos matchea.
 */
function matchea(dominio: unknown[], vat: string): boolean {
  return dominio
    .filter((t): t is [string, string, string] => Array.isArray(t))
    .some(([, op, valor]) =>
      op === "="
        ? vat === String(valor)
        : vat.toLowerCase().includes(String(valor).replaceAll("%", "").toLowerCase())
    );
}

describe("dominioPorCuit", () => {
  it("encuentra el CUIT guardado sin guiones", () => {
    expect(matchea(dominioPorCuit("30689471524"), "30689471524")).toBe(true);
  });

  it("encuentra el CUIT guardado con un guion, que es lo que hay en Odoo hoy", () => {
    expect(matchea(dominioPorCuit("30689471524"), "30-689471524")).toBe(true);
  });

  /*
   * El canónico argentino `XX-XXXXXXXX-X` parte los últimos seis dígitos en
   * dos, así que un `ilike` de seis contiguos no lo ve. Hoy no hay ninguno así
   * en Odoo, pero es la forma en que una persona tipea un CUIT: el día que
   * alguien cargue uno a mano, no encontrarlo significa crear el duplicado que
   * toda esta búsqueda existe para evitar.
   */
  it("encuentra el CUIT escrito con los dos guiones", () => {
    expect(matchea(dominioPorCuit("30689471524"), "30-68947152-4")).toBe(true);
  });
});

describe("hayQueCrearlo", () => {
  const candidato = (campos: Partial<PartnerCandidato>): PartnerCandidato => ({
    id: 1, nombre: "X", empresa: null, activo: true, esContactoDeOtro: false, usos: 0, ...campos,
  });

  it("sin ningún partner con ese CUIT hay que crearlo", () => {
    expect(hayQueCrearlo([], 1)).toBe(true);
  });

  it("con el partner de esta empresa no se crea nada", () => {
    expect(hayQueCrearlo([candidato({ empresa: 1 })], 1)).toBe(false);
  });

  it("un partner compartido sirve para esta empresa", () => {
    expect(hayQueCrearlo([candidato({ empresa: null })], 1)).toBe(false);
  });

  /*
   * El caso que trababa al 40% de los RI: con AMBAS, la segunda vuelta del
   * loop encuentra el partner que acaba de crear la primera y, si se mira el
   * CUIT entero en vez de esta empresa, decide que ya está y no crea nada.
   */
  it("si el único está en la otra empresa, hay que crearlo acá", () => {
    expect(hayQueCrearlo([candidato({ empresa: 2 })], 1)).toBe(true);
  });

  it("un archivado de esta empresa frena la creación", () => {
    expect(hayQueCrearlo([candidato({ empresa: 1, activo: false })], 1)).toBe(false);
  });

  it("un empate en esta empresa no se resuelve creando un tercero", () => {
    expect(
      hayQueCrearlo(
        [candidato({ id: 1, empresa: 1, usos: 5 }), candidato({ id: 2, empresa: 1, usos: 4 })],
        1
      )
    ).toBe(false);
  });
});
