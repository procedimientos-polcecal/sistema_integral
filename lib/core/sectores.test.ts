import { describe, it, expect } from "vitest";
import {
  claveDeSector, yaExisteElNombre, loMantieneLaImportacion, agruparSectores,
  type SectorAdmin,
} from "./sectores";

const sector = (s: Partial<SectorAdmin> & { id: string; nombre: string }): SectorAdmin => ({
  activo: true, transversal: false, es_de_planta: false,
  codigo: null, empresa_id: null, empresa: null, usos: 0, ...s,
});

const EMPRESAS = [
  { id: "e-polcecal", nombre: "POLCECAL" },
  { id: "e-polysan", nombre: "POLYSAN" },
];

/**
 * El catálogo se ensució con nombres que para una persona son el mismo y para
 * la base no: "Producción - Hidratacion" convivió meses al lado de
 * "Hidratación". La pantalla avisa antes que la base.
 */
describe("cuando dos nombres son el mismo", () => {
  it("no distingue tildes ni mayusculas ni espacios de mas", () => {
    expect(claveDeSector("Hidratación")).toBe(claveDeSector("hidratacion"));
    expect(claveDeSector("  Compras   y  Pañol ")).toBe(claveDeSector("compras y panol"));
  });

  it("encuentra el que ya existe", () => {
    const hay = [sector({ id: "a", nombre: "Administración" })];
    expect(yaExisteElNombre(hay, "administracion")?.id).toBe("a");
    expect(yaExisteElNombre(hay, "Calidad")).toBeNull();
  });

  // Un nombre repetido con una fila dada de baja hace el mismo daño: las
  // busquedas por nombre se quedan con una sola de las dos y no avisan.
  it("cuenta tambien los inactivos", () => {
    const hay = [sector({ id: "a", nombre: "Planta", activo: false })];
    expect(yaExisteElNombre(hay, "planta")?.id).toBe("a");
  });

  it("al renombrar, uno no choca consigo mismo", () => {
    const hay = [sector({ id: "a", nombre: "Calidad" })];
    expect(yaExisteElNombre(hay, "Calidad", "a")).toBeNull();
  });

  it("un nombre vacio no choca con nada", () => {
    expect(yaExisteElNombre([sector({ id: "a", nombre: "Calidad" })], "   ")).toBeNull();
  });
});

/**
 * Los de planta los pisa la importación del libro BD Equipos en cada corrida.
 * Dejar renombrarlos acá sería un cambio que parece guardado y se pierde solo.
 */
describe("quien manda sobre cada sector", () => {
  it("los de planta los mantiene la importacion", () => {
    expect(loMantieneLaImportacion(sector({ id: "a", nombre: "Filler 2", es_de_planta: true }))).toBe(true);
    expect(loMantieneLaImportacion(sector({ id: "b", nombre: "Tesorería" }))).toBe(false);
  });
});

describe("como se agrupa el catalogo", () => {
  const sectores = [
    sector({ id: "t1", nombre: "Tesorería", transversal: true }),
    sector({ id: "t2", nombre: "Administración", transversal: true }),
    sector({ id: "p1", nombre: "Calidad vieja", empresa_id: "e-polcecal", empresa: "POLCECAL" }),
    sector({ id: "f2", nombre: "Filler 2", es_de_planta: true, codigo: "PY-B1" }),
    sector({ id: "f1", nombre: "Trituración 1", es_de_planta: true, codigo: "PO-A1" }),
  ];

  it("primero los transversales, despues cada empresa, y los de planta al final", () => {
    expect(agruparSectores(sectores, EMPRESAS).map((g) => g.clave))
      .toEqual(["transversal", "e-polcecal", "e-polysan", "planta"]);
  });

  it("los organizativos van por nombre y los de planta por codigo", () => {
    const [transversales, , , planta] = agruparSectores(sectores, EMPRESAS);
    expect(transversales.sectores.map((s) => s.nombre)).toEqual(["Administración", "Tesorería"]);
    expect(planta.sectores.map((s) => s.codigo)).toEqual(["PO-A1", "PY-B1"]);
  });

  // Antes la pantalla los leía embebidos desde `empresas`, así que los
  // transversales no aparecían: mostraba 20 de 39 y nadie sabía dónde estaban.
  it("no se pierde ninguno", () => {
    const grupos = agruparSectores(sectores, EMPRESAS);
    expect(grupos.flatMap((g) => g.sectores).length).toBe(sectores.length);
  });

  it("una empresa sin sectores propios igual aparece", () => {
    const polysan = agruparSectores(sectores, EMPRESAS).find((g) => g.clave === "e-polysan");
    expect(polysan?.sectores).toEqual([]);
  });

  it("un sector de planta con empresa no se cuenta dos veces", () => {
    const conEmpresa = [sector({
      id: "f3", nombre: "Calcinación", es_de_planta: true, codigo: "PO-B1",
      empresa_id: "e-polcecal", empresa: "POLCECAL",
    })];
    const grupos = agruparSectores(conEmpresa, EMPRESAS);
    expect(grupos.find((g) => g.clave === "e-polcecal")?.sectores).toEqual([]);
    expect(grupos.find((g) => g.clave === "planta")?.sectores.length).toBe(1);
  });
});
