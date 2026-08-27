import { describe, it, expect } from "vitest";
import { SINCRONIZACIONES } from "./sincronizar";

/**
 * Los nombres de recurso son un contrato con afuera: van escritos en la
 * propiedad RECURSO del Apps Script de cada planilla y en la vista que dice
 * cuándo se actualizó cada cosa. Renombrar uno acá deja de funcionar allá, en
 * silencio y sin error.
 */
describe("los recursos que se sincronizan", () => {
  it("son los cuatro, con los nombres que espera el Apps Script", () => {
    expect(SINCRONIZACIONES.map((s) => s.recurso)).toEqual([
      "avisos",
      "ordenes",
      "ordenes-servicio",
      "comparativas",
    ]);
  });

  it("las órdenes de servicio van antes que sus comparativas", () => {
    // Una cotización que apunta a una OS que todavía no existe queda colgada.
    const recursos = SINCRONIZACIONES.map((s) => s.recurso);
    expect(recursos.indexOf("ordenes-servicio")).toBeLessThan(recursos.indexOf("comparativas"));
  });

  it("cada una sabe correr", () => {
    for (const s of SINCRONIZACIONES) expect(typeof s.correr).toBe("function");
  });
});
