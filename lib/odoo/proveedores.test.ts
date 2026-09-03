import { describe, it, expect } from "vitest";
import { cruzarProveedores, cuitEsValido, normalizarCuit } from "./proveedores";
import type { PartnerDeOdoo, ProveedorSdG } from "./proveedores";

/**
 * Los CUITs de los fixtures son reales, sacados de los dos padrones el
 * 03/09/2026. No es cosmética: si el dígito verificador que calculamos no
 * coincidiera con los CUITs que la gente usa todos los días, el algoritmo
 * estaría mal, no los datos.
 */
const CUITS_REALES_DE_ODOO = [
  "30708699574",
  "27375566112",
  "30708499796",
  "30501107065",
  "33693450239",
  "30717473546",
  "27200059471",
];

const CUITS_REALES_DEL_SDG = ["20-36215654-9", "30-71097635-6", "23-25825469-4", "30-71148230-6"];

function partner(id: number, name: string, vat: string | false, empresa: number | false) {
  return {
    id,
    name,
    vat,
    company_id: empresa === false ? false : ([empresa, `Empresa ${empresa}`] as [number, string]),
  } satisfies PartnerDeOdoo;
}

function proveedor(id: string, nombre: string, cuit: string | null): ProveedorSdG {
  return { id, nombre, cuit };
}

describe("normalizar el CUIT", () => {
  it("los dos formatos que existen de verdad terminan iguales", () => {
    // Odoo sin guiones, el SdG con guiones: el mismo proveedor.
    expect(normalizarCuit("30708699574")).toBe("30708699574");
    expect(normalizarCuit("30-70869957-4")).toBe("30708699574");
  });

  it("saca puntos y espacios además de guiones", () => {
    expect(normalizarCuit("30.708.699.574")).toBe("30708699574");
    expect(normalizarCuit(" 30 708699574 ")).toBe("30708699574");
  });

  it("lo que no tiene once dígitos no es un CUIT", () => {
    expect(normalizarCuit("123")).toBeNull();
    expect(normalizarCuit("307086995741234")).toBeNull();
    expect(normalizarCuit("sin datos")).toBeNull();
  });

  it("aguanta null, undefined y el false de Odoo", () => {
    expect(normalizarCuit(null)).toBeNull();
    expect(normalizarCuit(undefined)).toBeNull();
    expect(normalizarCuit(false)).toBeNull();
    expect(normalizarCuit("")).toBeNull();
  });
});

describe("dígito verificador", () => {
  it("los CUITs reales de Odoo pasan", () => {
    for (const cuit of CUITS_REALES_DE_ODOO) {
      expect(cuitEsValido(cuit), cuit).toBe(true);
    }
  });

  it("los CUITs reales del SdG pasan, con guiones y todo", () => {
    for (const cuit of CUITS_REALES_DEL_SDG) {
      expect(cuitEsValido(cuit), cuit).toBe(true);
    }
  });

  it("un dígito cambiado no pasa", () => {
    expect(cuitEsValido("30708699575")).toBe(false);
    expect(cuitEsValido("20-36215654-1")).toBe(false);
  });
});

describe("cruzar los dos padrones", () => {
  it("un proveedor que está en las dos empresas enlaza a los dos partners", () => {
    const r = cruzarProveedores(
      [proveedor("p1", "ABADIE GATTI MARIAN GINETTE", "27-37556611-2")],
      [
        partner(501, "ABADIE GATTI MARIAN GINETTE", "27375566112", 2),
        partner(500, "ABADIE GATTI MARIAN GINETTE", "27375566112", 1),
      ]
    );

    expect(r.enlaces).toHaveLength(1);
    // Ordenados por empresa, no por cómo los devolvió Odoo.
    expect(r.enlaces[0].partners.map((p) => [p.empresa, p.odooId])).toEqual([
      [1, 500],
      [2, 501],
    ]);
    expect(r.sinEnlazar).toHaveLength(0);
  });

  it("cruza aunque los formatos de CUIT no coincidan", () => {
    // Ésta es la falla que habría dado cero enlaces sin ningún error.
    const r = cruzarProveedores(
      [proveedor("p1", "Casa Camino", "30-71097635-6")],
      [partner(1, "CASA CAMINO SRL", "30710976356", 1)]
    );

    expect(r.enlaces).toHaveLength(1);
    expect(r.enlaces[0].partners[0].odooId).toBe(1);
  });

  it("un partner compartido por las dos empresas queda con empresa null", () => {
    const r = cruzarProveedores(
      [proveedor("p1", "AFIP", "33-69345023-9")],
      [partner(9, "AGENCIA DE RECAUDACION", "33693450239", false)]
    );

    expect(r.enlaces[0].partners[0].empresa).toBeNull();
  });

  it("sin CUIT no se enlaza, y se dice por qué", () => {
    const r = cruzarProveedores(
      [proveedor("p1", "ACERO RINCON", null), proveedor("p2", "MERCADO LIBRE", null)],
      [partner(1, "ACERO RINCON SA", "30708699574", 1)]
    );

    // Lo que NO tiene que pasar: enlazar "ACERO RINCON" con "ACERO RINCON SA"
    // porque el nombre se parece. Un enlace equivocado no se nota nunca.
    expect(r.enlaces).toHaveLength(0);
    expect(r.sinEnlazar.map((s) => s.motivo)).toEqual(["sin cuit", "sin cuit"]);
  });

  it("distingue un CUIT mal tipeado de uno que no está en Odoo", () => {
    const r = cruzarProveedores(
      [
        proveedor("p1", "Con CUIT roto", "30-70869957-5"),
        proveedor("p2", "Nuevo en el SdG", "30-71747354-6"),
      ],
      []
    );

    const motivos = Object.fromEntries(r.sinEnlazar.map((s) => [s.nombre, s.motivo]));
    // Uno se corrige en el SdG; el otro se da de alta en Odoo. No es lo mismo.
    expect(motivos["Con CUIT roto"]).toBe("cuit invalido");
    expect(motivos["Nuevo en el SdG"]).toBe("no esta en odoo");
  });

  it("dos proveedores del SdG con el mismo CUIT no se enlazan: se informan", () => {
    const r = cruzarProveedores(
      [
        proveedor("p1", "Fase 3", "30-71148230-6"),
        proveedor("p2", "FASE 3 SRL", "30711482306"),
      ],
      [partner(7, "FASE 3", "30711482306", 1)]
    );

    expect(r.enlaces).toHaveLength(0);
    expect(r.cuitRepetidoEnSdG).toHaveLength(1);
    expect(r.cuitRepetidoEnSdG[0].proveedores.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("cuenta los partners de Odoo que nadie reclamó", () => {
    const r = cruzarProveedores(
      [proveedor("p1", "Casa Camino", "30-71097635-6")],
      [
        partner(1, "CASA CAMINO", "30710976356", 1),
        partner(2, "OTRO PROVEEDOR", "30708499796", 1),
        partner(3, "OTRO PROVEEDOR", "30708499796", 2),
        partner(4, "SIN CUIT EN ODOO", false, 1),
      ]
    );

    // Un CUIT huérfano, no dos: los dos registros son el mismo proveedor.
    expect(r.partnersHuerfanos).toBe(1);
  });

  it("no explota con los padrones vacíos", () => {
    const r = cruzarProveedores([], []);
    expect(r).toEqual({
      enlaces: [],
      sinEnlazar: [],
      cuitRepetidoEnSdG: [],
      partnersHuerfanos: 0,
    });
  });
});
