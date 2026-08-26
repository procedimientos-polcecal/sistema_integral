import { describe, it, expect } from "vitest";
import { textoAprobacion, aliasSegunLoEscrito } from "./sheets";

// Las opciones reales del desplegable de la planilla.
const OPCIONES = ["APROBADA (NICO)", "DENEGADA", "EN REVISIÓN", "APROBADA (MAXI)"];

describe("textoAprobacion", () => {
  it("usa el alias, no el nombre de la persona", () => {
    // Antes escribía "APROBADA (Maximiliano Lenzetti)", fuera de la lista.
    expect(textoAprobacion("APROBADA", "MAXI", OPCIONES).valor).toBe("APROBADA (MAXI)");
  });

  it("acepta el alias escrito en minúsculas o con espacios", () => {
    expect(textoAprobacion("APROBADA", " nico ", OPCIONES).valor).toBe("APROBADA (NICO)");
  });

  it("no escribe nada si falta el alias, y dice por qué", () => {
    const r = textoAprobacion("APROBADA", null, OPCIONES);
    expect(r.valor).toBeNull();
    expect(r.motivo).toMatch(/alias/);
  });

  it("no inventa una opción que la planilla no tiene", () => {
    const r = textoAprobacion("APROBADA", "PEPE", OPCIONES);
    expect(r.valor).toBeNull();
    expect(r.motivo).toMatch(/APROBADA \(PEPE\)/);
  });

  it("denegar y en revisión van sin sufijo", () => {
    // Con el formato viejo salía "DENEGADA (Nombre)", también inválido.
    expect(textoAprobacion("DENEGADA", "MAXI", OPCIONES).valor).toBe("DENEGADA");
    expect(textoAprobacion("EN_REVISION", null, OPCIONES).valor).toBe("EN REVISIÓN");
  });

  it("pendiente no escribe nada", () => {
    expect(textoAprobacion("PENDIENTE", "MAXI", OPCIONES).valor).toBeNull();
  });

  it("se adapta si la planilla suma un aprobador", () => {
    const conTercero = [...OPCIONES, "APROBADA (JUAN)"];
    expect(textoAprobacion("APROBADA", "JUAN", conTercero).valor).toBe("APROBADA (JUAN)");
  });
});

import { empresaParaPlanilla } from "./sheets";

describe("empresaParaPlanilla", () => {
  // La base las guarda en mayúsculas; el desplegable de la planilla las espera
  // capitalizadas. Escribir "POLCECAL" dejaría la celda fuera de la validación.
  it("capitaliza como espera la planilla", () => {
    expect(empresaParaPlanilla("POLCECAL")).toBe("Polcecal");
    expect(empresaParaPlanilla("POLYSAN")).toBe("Polysan");
  });

  it("«Ambas» sólo cuando se decidió que la pagan las dos", () => {
    expect(empresaParaPlanilla(null, true)).toBe("Ambas");
  });

  it("sin decidir se escribe vacío, no «Ambas»", () => {
    // Antes la ausencia de decisión se escribía como una decisión.
    expect(empresaParaPlanilla(null)).toBe("");
    expect(empresaParaPlanilla(null, false)).toBe("");
    expect(empresaParaPlanilla(undefined)).toBe("");
  });

  it("tolera que ya venga capitalizada", () => {
    expect(empresaParaPlanilla("Polcecal")).toBe("Polcecal");
  });
});

/**
 * Quien aprobo, reconocido por el texto que quedo guardado en el RI.
 *
 * Los 1810 RI que vienen de la planilla guardaron el ALIAS —"NICO"—, no el
 * nombre. Buscar solo por nombre no acertaba con ninguno y la sincronizacion
 * informaba que faltaba un alias que estaba cargado.
 */
describe("aliasSegunLoEscrito", () => {
  const candidatos = [
    { alias_planilla: "NICO", usuarios: { nombre: "Nicolas", apellido: "Lenzetti" } },
    { alias_planilla: "MAXI", usuarios: { nombre: "Maximiliano", apellido: "Lenzetti" } },
    { alias_planilla: null, usuarios: { nombre: "Admin", apellido: "SdG" } },
  ];

  it("reconoce el alias, que es lo que escribe la planilla", () => {
    expect(aliasSegunLoEscrito(candidatos, "NICO")).toBe("NICO");
    expect(aliasSegunLoEscrito(candidatos, "MAXI")).toBe("MAXI");
  });

  it("sigue reconociendo el nombre, que es lo que guardaba la app", () => {
    expect(aliasSegunLoEscrito(candidatos, "Maximiliano Lenzetti")).toBe("MAXI");
  });

  it("no le molestan mayusculas ni espacios de mas", () => {
    expect(aliasSegunLoEscrito(candidatos, " nico ")).toBe("NICO");
  });

  it("quien esta en la lista pero sin alias sigue sin alias", () => {
    // No es lo mismo "no lo reconozco" que "no tiene con que figurar en la
    // planilla": el segundo caso es real y hay que seguir avisandolo.
    expect(aliasSegunLoEscrito(candidatos, "Admin SdG")).toBeNull();
  });

  it("un desconocido no se confunde con nadie", () => {
    expect(aliasSegunLoEscrito(candidatos, "PEPE")).toBeNull();
    expect(aliasSegunLoEscrito(candidatos, null)).toBeNull();
  });
});
