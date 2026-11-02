import { describe, expect, it } from "vitest";
import { engancharRenglon, type EquipoDelCatalogo, type LugarAprendido, type SectorDelCatalogo } from "./cuadernoEnganche";
import { normalizarLugar } from "./partesDeContratista";

const TRITURACION_1 = "sec-tr1";
const TRITURACION_3 = "sec-tr3";
const CALCINACION = "sec-b1";
const CANTERA = "sec-cantera";
const FILLER_1 = "sec-filler1";

const sectores: SectorDelCatalogo[] = [
  { id: TRITURACION_1, codigo: "PO-A1" },
  { id: TRITURACION_3, codigo: "PO-A3" },
  { id: CALCINACION, codigo: "PO-B1" },
  { id: CANTERA, codigo: "CANT" },
  { id: FILLER_1, codigo: "PY-A1" },
];

const CINTA_9_DE_TRITURACION_1 = "eq-cinta9-tr1";
const CINTA_9_DE_TRITURACION_3 = "eq-cinta9-tr3";
const CINTA_4_DE_TRITURACION_3 = "eq-cinta4-tr3";
const D6 = "eq-d6";

const equipos: EquipoDelCatalogo[] = [
  { id: CINTA_9_DE_TRITURACION_1, code: "PO-A1-15", name: "Cinta transportadora 9", sector_id: TRITURACION_1 },
  { id: CINTA_9_DE_TRITURACION_3, code: "PO-A3-09", name: "Cinta transportadora 9", sector_id: TRITURACION_3 },
  { id: CINTA_4_DE_TRITURACION_3, code: "PO-A3-04", name: "Cinta transportadora 4", sector_id: TRITURACION_3 },
  { id: D6, code: "D6", name: "Topadora D6", sector_id: CANTERA },
];

const vacio = new Map<string, LugarAprendido>();

describe("engancharRenglon", () => {
  it("el catalogo aprendido gana sobre el interprete", () => {
    // El intérprete no conoce «Horno 4 Rastro»: alguien lo enseñó mirando el papel.
    const catalogo = new Map<string, LugarAprendido>([
      [normalizarLugar("Horno 4 Rastro"), { sector_id: CALCINACION, equipo_id: null }],
    ]);
    const r = engancharRenglon("Horno 4 Rastro", catalogo, sectores, equipos);
    expect(r).toEqual({ sector_id: CALCINACION, equipo_id: null, sector_propuesto: false });
  });

  it("el catalogo aprendido gana aunque el interprete lea otra cosa", () => {
    const catalogo = new Map<string, LugarAprendido>([
      [normalizarLugar("Reparar cinta 9 P/Trit N°3"), { sector_id: TRITURACION_1, equipo_id: CINTA_9_DE_TRITURACION_1 }],
    ]);
    const r = engancharRenglon("Reparar cinta 9 P/Trit N°3", catalogo, sectores, equipos);
    expect(r.sector_id).toBe(TRITURACION_1);
    expect(r.equipo_id).toBe(CINTA_9_DE_TRITURACION_1);
    expect(r.sector_propuesto).toBe(false);
  });

  it("el catalogo se busca con la misma normalizacion con que se guarda", () => {
    const catalogo = new Map<string, LugarAprendido>([
      [normalizarLugar("Horno 4 Rastro"), { sector_id: CALCINACION, equipo_id: null }],
    ]);
    const r = engancharRenglon("  HORNO   4 rástro ", catalogo, sectores, equipos);
    expect(r.sector_id).toBe(CALCINACION);
  });

  it("el interprete resuelve sector y equipo juntos", () => {
    const r = engancharRenglon("Reparar rodillos 2/cinta 9 P/Trit N°3", vacio, sectores, equipos);
    expect(r.sector_id).toBe(TRITURACION_3);
    expect(r.equipo_id).toBe(CINTA_9_DE_TRITURACION_3);
    expect(r.sector_propuesto).toBe(false);
  });

  it("la cinta 9 de una planta no es la cinta 9 de otra", () => {
    const en1 = engancharRenglon("Cinta 9 P/Trit N°1", vacio, sectores, equipos);
    const en3 = engancharRenglon("Cinta 9 P/Trit N°3", vacio, sectores, equipos);
    expect(en1.equipo_id).toBe(CINTA_9_DE_TRITURACION_1);
    expect(en3.equipo_id).toBe(CINTA_9_DE_TRITURACION_3);
  });

  it("una cinta sin sector no se adivina entre las plantas", () => {
    const r = engancharRenglon("Reparar cinta 9", vacio, sectores, equipos);
    expect(r.equipo_id).toBeNull();
    expect(r.sector_id).toBeNull();
  });

  it("una cinta que la planta no tiene queda sin equipo y conserva el sector", () => {
    const r = engancharRenglon("Cinta 77 P/Trit N°3", vacio, sectores, equipos);
    expect(r.sector_id).toBe(TRITURACION_3);
    expect(r.equipo_id).toBeNull();
    expect(r.sector_propuesto).toBe(false);
  });

  it("con equipo y sin sector, el sector sale del equipo y queda propuesto", () => {
    const r = engancharRenglon("Tranqueras D6", vacio, sectores, equipos);
    expect(r.sector_id).toBe(CANTERA);
    expect(r.equipo_id).toBe(D6);
    // Es una deduccion, no algo que el papel diga: quien carga tiene que verla.
    expect(r.sector_propuesto).toBe(true);
  });

  it("un equipo que contradice el sector del papel no se enlaza", () => {
    // El papel dice Trituracion 3 y el D6 es de Cantera: elegir uno es adivinar.
    const r = engancharRenglon("Tranqueras D6 P/Trit N°3", vacio, sectores, equipos);
    expect(r.sector_id).toBe(TRITURACION_3);
    expect(r.equipo_id).toBeNull();
    expect(r.sector_propuesto).toBe(false);
  });

  it("sin sector ni equipo no inventa nada", () => {
    const r = engancharRenglon("Hormigonar Dep 05", vacio, sectores, equipos);
    expect(r.sector_id).toBeNull();
    expect(r.equipo_id).toBeNull();
    expect(r.sector_propuesto).toBe(false);
  });

  it("un sector que el catalogo no tiene no se enlaza al que se le parece", () => {
    // «Filer 3» es PY-D1, que en este catalogo no existe: no cae en otro filler.
    const r = engancharRenglon("Filer 3 cambiar rodamiento", vacio, sectores, equipos);
    expect(r.sector_id).toBeNull();
    expect(r.equipo_id).toBeNull();
  });

  it("un codigo de equipo que aparece dentro de otra palabra no cuenta", () => {
    const r = engancharRenglon("Revisar ad6a de la rampa", vacio, sectores, equipos);
    expect(r.equipo_id).toBeNull();
  });

  it("dos equipos con el mismo codigo no se resuelven por el primero", () => {
    const repetidos: EquipoDelCatalogo[] = [
      { id: "a", code: "D6", name: "Topadora D6", sector_id: CANTERA },
      { id: "b", code: "D6", name: "Otra D6", sector_id: TRITURACION_1 },
    ];
    const r = engancharRenglon("Tranqueras D6", vacio, sectores, repetidos);
    expect(r.equipo_id).toBeNull();
    expect(r.sector_id).toBeNull();
  });

  it("un equipo sin sector no propone ninguno", () => {
    const sinSector: EquipoDelCatalogo[] = [{ id: "z", code: "D6", name: "Topadora D6", sector_id: null }];
    const r = engancharRenglon("Tranqueras D6", vacio, sectores, sinSector);
    expect(r.equipo_id).toBe("z");
    expect(r.sector_id).toBeNull();
    expect(r.sector_propuesto).toBe(false);
  });

  it("un aprendido con equipo y sin sector propone el del equipo", () => {
    const catalogo = new Map<string, LugarAprendido>([
      [normalizarLugar("Tranqueras"), { sector_id: null, equipo_id: D6 }],
    ]);
    const r = engancharRenglon("Tranqueras", catalogo, sectores, equipos);
    expect(r.equipo_id).toBe(D6);
    expect(r.sector_id).toBe(CANTERA);
    expect(r.sector_propuesto).toBe(true);
  });

  it("un renglon vacio queda sin nada", () => {
    expect(engancharRenglon("", vacio, sectores, equipos)).toEqual({
      sector_id: null,
      equipo_id: null,
      sector_propuesto: false,
    });
  });
});
