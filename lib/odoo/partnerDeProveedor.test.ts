import { describe, it, expect } from "vitest";
import { dominioPorCuit, candidatosDelCuit } from "./partnerDeProveedor";
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
