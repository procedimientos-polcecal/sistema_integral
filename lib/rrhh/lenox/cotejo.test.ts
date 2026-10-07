import { describe, it, expect } from "vitest";
import { cotejarPadron, type EmpleadoDelPadron } from "./cotejo";
import type { EmpleadoLenox } from "./tipos";

function enSdG(legajo: string | null, activo = true, nombre = "Ana", apellido = "Pérez"): EmpleadoDelPadron {
  return { legajo, nombre, apellido, activo };
}

function enLenox(legajo: string, fechaBaja: string | null = null, nombre = "Beto", apellido = "Gómez"): EmpleadoLenox {
  return { nombre, apellido, legajo, sector: null, sucursal: null, fechaIngreso: null, fechaBaja };
}

const NADA = { errores: [], pendientes: [] };

describe("cotejarPadron", () => {
  it("sin diferencias no avisa nada", () => {
    expect(cotejarPadron([enSdG("PC_204"), enSdG("PC_205")], [enLenox("PC_204"), enLenox("PC_205")])).toEqual(NADA);
  });

  it("un alta que Lenox tiene y el SdG no es un ERROR, con nombre y apellido: sus marcaciones no se cargaron", () => {
    const r = cotejarPadron([enSdG("PC_204")], [enLenox("PC_204"), enLenox("PC_241", null, "Carla", "Díaz")]);
    expect(r).toEqual({
      errores: ["Alta sin cargar: PC_241 — Carla Díaz está en Lenox y no en el SdG"],
      pendientes: [],
    });
  });

  it("una baja de Lenox que el SdG ni tiene no avisa: no hay nada que cargar", () => {
    expect(cotejarPadron([], [enLenox("PC_300", "2026-08-01")])).toEqual(NADA);
  });

  it("una baja de Lenox con el empleado activo en el SdG es un PENDIENTE: no se perdió nada", () => {
    const r = cotejarPadron([enSdG("PC_204", true, "Ana", "Pérez")], [enLenox("PC_204", "2026-09-15")]);
    expect(r).toEqual({
      errores: [],
      pendientes: ["Baja sin cargar: PC_204 — Ana Pérez figura de baja en Lenox el 2026-09-15 y activo en el SdG"],
    });
  });

  it("una baja que el SdG ya tiene como inactivo no avisa", () => {
    expect(cotejarPadron([enSdG("PC_204", false)], [enLenox("PC_204", "2026-09-15")])).toEqual(NADA);
  });

  it("un activo del SdG que no existe en Lenox es un PENDIENTE: probablemente sea permanente y legítimo", () => {
    const r = cotejarPadron([enSdG("PC_204"), enSdG("PC_999", true, "Dora", "Ruiz")], [enLenox("PC_204")]);
    expect(r).toEqual({
      errores: [],
      pendientes: ["Sin reloj: PC_999 — Dora Ruiz está activo en el SdG y no existe en Lenox"],
    });
  });

  it("un inactivo del SdG que no está en Lenox no avisa", () => {
    expect(cotejarPadron([enSdG("PC_999", false)], [])).toEqual(NADA);
  });

  it("un legajo con espacios al borde, de cualquiera de los dos lados, no es un falso positivo", () => {
    // Si el cotejo dijera "falta" donde el enlace de las marcaciones dice
    // "está" —o al revés—, un aviso contradiría al otro.
    expect(cotejarPadron([enSdG(" PC_204 ")], [enLenox("PC_204")])).toEqual(NADA);
    expect(cotejarPadron([enSdG("PC_204")], [enLenox("PC_204  ")])).toEqual(NADA);
    const conBaja = cotejarPadron([enSdG("PC_204\t")], [enLenox(" PC_204", "2026-09-15")]);
    expect(conBaja.errores).toEqual([]);
    expect(conBaja.pendientes).toHaveLength(1); // la baja sí se ve
  });

  it("no iguala mayúsculas con minúsculas: es la misma regla que el enlace de las marcaciones", () => {
    const r = cotejarPadron([enSdG("pc_204")], [enLenox("PC_204")]);
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0]).toMatch(/^Alta sin cargar: PC_204/);
    expect(r.pendientes).toHaveLength(1);
    expect(r.pendientes[0]).toMatch(/^Sin reloj: pc_204/);
  });

  it("un fechaBaja en blanco no es una baja", () => {
    expect(cotejarPadron([enSdG("PC_204")], [enLenox("PC_204", "  ")])).toEqual(NADA);
    expect(cotejarPadron([], [enLenox("PC_241", "")]).errores).toHaveLength(1); // sigue siendo un alta
  });

  it("un legajo vacío de Lenox se ignora", () => {
    expect(cotejarPadron([enSdG("PC_204")], [enLenox("PC_204"), enLenox("   ")])).toEqual(NADA);
  });

  it("un activo del SdG sin legajo avisa como pendiente, y dice que no tiene", () => {
    expect(cotejarPadron([enSdG(null)], [enLenox("PC_204")]).pendientes.filter((a) => a.startsWith("Sin reloj"))).toEqual([
      "Sin reloj: (sin legajo) — Ana Pérez está activo en el SdG y no existe en Lenox",
    ]);
  });

  it("las tres diferencias juntas caen cada una en su lista", () => {
    const r = cotejarPadron(
      [enSdG("A1"), enSdG("B2", true, "Bea", "Luna"), enSdG("C3", true, "Cris", "Mar")],
      [enLenox("A1", "2026-09-01"), enLenox("D4"), enLenox("B2")]
    );
    expect(r.errores.map((a) => a.split(":")[0])).toEqual(["Alta sin cargar"]);
    expect(r.pendientes.map((a) => a.split(":")[0])).toEqual(["Baja sin cargar", "Sin reloj"]);
  });
});
