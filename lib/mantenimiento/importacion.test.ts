import { describe, it, expect } from "vitest";
import { detectarFormato, buscarHoja, porQueNoSePuede } from "./importacion";

describe("buscarHoja", () => {
  it("encuentra la hoja sin importar acentos ni mayúsculas", () => {
    expect(buscarHoja(["LISTAS", "Tipo_Equipo", "EQUIPOS"], "TIPO_EQUIPO")).toBe("Tipo_Equipo");
    expect(buscarHoja(["equipos"], "EQUIPOS")).toBe("equipos");
  });

  it("devuelve null si no está", () => {
    expect(buscarHoja(["LISTAS"], "EQUIPOS")).toBeNull();
  });
});

describe("detectarFormato", () => {
  it("reconoce el libro BD Equipos", () => {
    // Verificado contra el archivo de verdad: nueve hojas y equipo_id.
    expect(detectarFormato(
      ["LISTAS", "PLANTAS", "SECTORES", "TIPO_EQUIPO", "EQUIPOS", "COMPONENTES"],
      ["equipo_id", "tipo_id", "sector_id", "nombre_equipo"]
    )).toBe("libro");
  });

  it("reconoce una planilla plana en castellano", () => {
    expect(detectarFormato(
      ["Hoja 1"],
      ["Código", "Nombre", "Empresa", "Sector", "Estado"]
    )).toBe("planilla");
  });

  it("no toma por libro a una planilla que se llama EQUIPOS", () => {
    // El nombre de la hoja no alcanza: lo que decide es el idioma de las
    // columnas.
    expect(detectarFormato(["EQUIPOS"], ["Código", "Nombre"])).toBe("planilla");
  });

  it("no reconoce un archivo sin código ni nombre", () => {
    expect(detectarFormato(["Hoja 1"], ["Marca", "Modelo"])).toBe("desconocido");
    expect(detectarFormato([], [])).toBe("desconocido");
  });
});

describe("porQueNoSePuede", () => {
  it("dice qué hojas tiene el archivo cuando no encuentra la de equipos", () => {
    const m = porQueNoSePuede(["Ventas", "Resumen"], []);
    expect(m).toContain("Ventas, Resumen");
  });

  it("dice qué columnas hacen falta cuando la hoja está pero no se entiende", () => {
    const m = porQueNoSePuede(["EQUIPOS"], ["Marca", "Modelo"]);
    expect(m).toContain("Marca, Modelo");
    expect(m).toContain("equipo_id");
  });
});
