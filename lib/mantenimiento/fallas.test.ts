import { describe, it, expect } from "vitest";
import {
  MODOS_DE_FALLA, CAUSAS_DE_FALLA, esModoDeFalla, esCausaDeFalla,
  etiquetaDeModo, etiquetaDeCausa, esquemaFalla, rankingDeFallas,
  type OtConFalla,
} from "@/lib/mantenimiento/fallas";

/** Una OT con falla, con lo mínimo y lo que cada test quiera cambiar. */
const ot = (cambios: Partial<OtConFalla> = {}): OtConFalla => ({
  ot_number: 1,
  fecha_ejecucion: "2026-05-01",
  falla_modo: "ROTURA",
  falla_causa: "FRICCION",
  falla_detalle: null,
  ...cambios,
});

describe("el vocabulario", () => {
  it("tiene ocho y ocho, y ninguna clave lleva ñ", () => {
    expect(MODOS_DE_FALLA).toHaveLength(8);
    expect(CAUSAS_DE_FALLA).toHaveLength(8);
    // norm() descompone la ñ: una clave con ñ no matchea contra su propia
    // forma normalizada.
    for (const { clave } of [...MODOS_DE_FALLA, ...CAUSAS_DE_FALLA]) {
      expect(clave).toMatch(/^[A-Z_]+$/);
    }
    expect(CAUSAS_DE_FALLA.map((c) => c.clave)).toContain("MATERIAL_EXTRANO");
  });

  it("no tiene 'Otro' en ninguna de las dos", () => {
    const claves = [...MODOS_DE_FALLA, ...CAUSAS_DE_FALLA].map((o) => o.clave);
    expect(claves).not.toContain("OTRO");
  });

  it("reconoce lo que está y rechaza lo que no", () => {
    expect(esModoDeFalla("ROTURA")).toBe(true);
    expect(esModoDeFalla("rotura")).toBe(false);   // la clave es la clave
    expect(esModoDeFalla("SE ROMPIO")).toBe(false);
    expect(esCausaDeFalla("FRICCION")).toBe(true);
    expect(esCausaDeFalla("ROTURA")).toBe(false);  // no se cruzan las listas
  });

  it("traduce la clave a lo que se lee en pantalla", () => {
    expect(etiquetaDeModo("ROTURA")).toBe("Rotura / quebradura");
    expect(etiquetaDeCausa("MATERIAL_EXTRANO")).toBe("Material extraño");
    expect(etiquetaDeModo(null)).toBeNull();
    expect(etiquetaDeModo("NO_EXISTE")).toBeNull();
  });
});

describe("esquemaFalla", () => {
  // Es lo único que separa dos listas cortas de un campo de texto libre: si la
  // ruta acepta cualquier cosa, el conteo se muere en silencio.
  it("rechaza un modo que no está en la lista", () => {
    expect(esquemaFalla.safeParse({ falla_modo: "SE ROMPIO TODO" }).success).toBe(false);
  });

  it("rechaza una causa que no está en la lista", () => {
    expect(esquemaFalla.safeParse({ falla_causa: "PORQUE SI" }).success).toBe(false);
  });

  it("acepta que no venga ninguno, y que vengan nulos", () => {
    expect(esquemaFalla.safeParse({}).success).toBe(true);
    expect(esquemaFalla.safeParse({ falla_modo: null, falla_causa: null, falla_detalle: null }).success).toBe(true);
  });

  it("el detalle se recorta, y vacío es null", () => {
    expect(esquemaFalla.parse({ falla_detalle: "  eje lado motor  " }).falla_detalle).toBe("eje lado motor");
    expect(esquemaFalla.parse({ falla_detalle: "   " }).falla_detalle).toBeNull();
  });
});

describe("rankingDeFallas", () => {
  it("agrupa por modo + causa y ordena por veces", () => {
    const r = rankingDeFallas([
      ot({ ot_number: 1 }),
      ot({ ot_number: 2 }),
      ot({ ot_number: 3, falla_modo: "DESGASTE", falla_causa: "LUBRICACION" }),
    ]);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ veces: 2, titulo: "Rotura por fricción" });
    expect(r[0].ots.map((o) => o.numero)).toEqual([1, 2]);
    expect(r[1].veces).toBe(1);
  });

  it("la misma causa con distinto modo no es la misma falla", () => {
    const r = rankingDeFallas([
      ot({ ot_number: 1, falla_modo: "ROTURA", falla_causa: "GOLPE" }),
      ot({ ot_number: 2, falla_modo: "FLOJEDAD", falla_causa: "GOLPE" }),
    ]);
    expect(r).toHaveLength(2);
    expect(r.map((f) => f.veces)).toEqual([1, 1]);
  });

  it("cuenta la falla a medias, con la mitad vacía", () => {
    // Exigir las dos tiraría lo que alguien se tomó el trabajo de anotar.
    const r = rankingDeFallas([ot({ falla_modo: "ROTURA", falla_causa: null })]);
    expect(r[0].titulo).toBe("Rotura / quebradura");
  });

  it("la que sólo tiene detalle entra como «Sin clasificar»", () => {
    const r = rankingDeFallas([ot({ falla_modo: null, falla_causa: null, falla_detalle: "se salió la tapa" })]);
    expect(r[0].titulo).toBe("Sin clasificar");
    expect(r[0].ots[0].detalle).toBe("se salió la tapa");
  });

  it("la OT sin nada no entra", () => {
    expect(rankingDeFallas([ot({ falla_modo: null, falla_causa: null, falla_detalle: null })])).toEqual([]);
  });

  it("la última fecha es la mayor, y una fecha nula no la rompe", () => {
    const r = rankingDeFallas([
      ot({ ot_number: 1, fecha_ejecucion: "2026-03-01" }),
      ot({ ot_number: 2, fecha_ejecucion: null }),
      ot({ ot_number: 3, fecha_ejecucion: "2026-09-12" }),
    ]);
    expect(r[0].veces).toBe(3);
    expect(r[0].ultimaFecha).toBe("2026-09-12");
  });

  it("empatadas en veces, primero la más reciente", () => {
    const r = rankingDeFallas([
      ot({ ot_number: 1, falla_modo: "ROTURA", falla_causa: "GOLPE", fecha_ejecucion: "2026-01-10" }),
      ot({ ot_number: 2, falla_modo: "FUGA", falla_causa: "CORROSION", fecha_ejecucion: "2026-08-20" }),
    ]);
    expect(r.map((f) => f.ots[0].numero)).toEqual([2, 1]);
  });

  it("una falla sin ninguna fecha no rompe el orden", () => {
    const r = rankingDeFallas([
      ot({ ot_number: 1, falla_modo: "ROTURA", falla_causa: "GOLPE", fecha_ejecucion: null }),
      ot({ ot_number: 2, falla_modo: "FUGA", falla_causa: "CORROSION", fecha_ejecucion: "2026-08-20" }),
    ]);
    expect(r).toHaveLength(2);
    expect(r[0].ots[0].numero).toBe(2);
    expect(r[1].ultimaFecha).toBeNull();
  });
});
