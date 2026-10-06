import { describe, expect, it } from "vitest";
import { validarMuestra } from "./cuerpoDeLaMuestra";

const BASE = { fecha: "2026-10-06", producto_id: "p1" };

function ok(r: ReturnType<typeof validarMuestra>) {
  if ("problema" in r) throw new Error(`esperaba que validara, y dijo: ${r.problema}`);
  return r;
}

describe("validarMuestra", () => {
  it("pide la fecha y el producto", () => {
    expect(validarMuestra({ producto_id: "p1" })).toEqual({ problema: "Falta la fecha de la muestra." });
    expect(validarMuestra({ fecha: "6/10/2026", producto_id: "p1" })).toEqual({
      problema: "Falta la fecha de la muestra.",
    });
    expect(validarMuestra({ fecha: "2026-10-06" })).toEqual({ problema: "Falta el producto." });
  });

  /**
   * Una muestra vacía deja una fila que en el listado se lee como "ese día se
   * ensayó y no dio nada" — justo la confusión que el módulo existe para evitar.
   */
  it("rechaza una muestra sin ninguna determinación", () => {
    expect(validarMuestra({ ...BASE })).toEqual({
      problema: "La muestra no tiene ninguna determinación cargada.",
    });
    expect(validarMuestra({ ...BASE, observaciones: "retorno" })).toEqual({
      problema: "La muestra no tiene ninguna determinación cargada.",
    });
  });

  it("alcanza con una sola determinación", () => {
    const r = ok(validarMuestra({ ...BASE, humedad_p_inicial: 500 }));
    expect(r.muestra.humedad_p_inicial).toBe(500);
    expect(r.muestra.humedad_p_final).toBeNull();
  });

  /** Vacío es "no se midió", no cero: es la distinción que el Excel perdía. */
  it("un campo vacío queda en null y no en cero", () => {
    const r = ok(validarMuestra({ ...BASE, peso_vol_gramos: 300, peso_vol_volumen_cc: "" }));
    expect(r.muestra.peso_vol_volumen_cc).toBeNull();
  });

  it("acepta números escritos como texto, que es como llegan del formulario", () => {
    const r = ok(validarMuestra({ ...BASE, peso_vol_gramos: "299.668" }));
    expect(r.muestra.peso_vol_gramos).toBe(299.668);
  });

  it("una observación en blanco queda en null", () => {
    const r = ok(validarMuestra({ ...BASE, observaciones: "   ", humedad_p_inicial: 500 }));
    expect(r.muestra.observaciones).toBeNull();
  });

  it("toma los retenidos y los deja listos para insertar", () => {
    const r = ok(
      validarMuestra({
        ...BASE,
        granulometria_peso_muestra_g: 20,
        retenidos: [
          { malla: 100, retenido_g: 2.5 },
          { malla: "50", retenido_g: "0" },
        ],
      })
    );
    expect(r.retenidos).toEqual([
      { malla: 100, retenido_g: 2.5 },
      { malla: 50, retenido_g: 0 },
    ]);
  });

  /** La pantalla de carga agrega renglones vacíos: no son un error. */
  it("descarta los renglones de granulometría que quedaron en blanco", () => {
    const r = ok(
      validarMuestra({
        ...BASE,
        granulometria_peso_muestra_g: 20,
        retenidos: [{ malla: 50, retenido_g: 1 }, { malla: "", retenido_g: "" }],
      })
    );
    expect(r.retenidos).toHaveLength(1);
  });

  it("una malla sin retenido es un dato a medias, y lo dice con la malla", () => {
    const r = validarMuestra({
      ...BASE,
      granulometria_peso_muestra_g: 20,
      retenidos: [{ malla: 50, retenido_g: "" }],
    });
    expect(r).toEqual({ problema: "Falta el retenido de la malla #50." });
  });

  it("un retenido sin malla no se puede ubicar", () => {
    const r = validarMuestra({
      ...BASE,
      granulometria_peso_muestra_g: 20,
      retenidos: [{ malla: "", retenido_g: 3 }],
    });
    expect(r).toEqual({ problema: "Hay un renglón de granulometría sin número de malla." });
  });

  /** El unique de la base lo frenaría igual, pero con un mensaje que nadie entiende. */
  it("una malla repetida se rechaza acá, no en el insert", () => {
    const r = validarMuestra({
      ...BASE,
      granulometria_peso_muestra_g: 20,
      retenidos: [
        { malla: 50, retenido_g: 1 },
        { malla: 50, retenido_g: 2 },
      ],
    });
    expect(r).toEqual({ problema: "La malla #50 está dos veces." });
  });

  it("una granulometría sola alcanza como determinación", () => {
    const r = ok(
      validarMuestra({
        ...BASE,
        granulometria_peso_muestra_g: 20,
        retenidos: [{ malla: 50, retenido_g: 1 }],
      })
    );
    expect(r.retenidos).toHaveLength(1);
  });
});
