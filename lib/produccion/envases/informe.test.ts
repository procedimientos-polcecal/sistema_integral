import { describe, it, expect } from "vitest";
import { resumirPorGrupo } from "./informe";

const ARTICULOS = [
  { id: "a", codigo: "00014", grupo: "BOLSONES 1,20 + 1,40", stock_actual: 746 },
  { id: "b", codigo: "00024", grupo: "BOLSONES 1,20 NUEVOS", stock_actual: 0 },
  { id: "c", codigo: "00025", grupo: "BOLSONES 1,20 NUEVOS", stock_actual: 600 },
  // Sin movimientos nunca, así que la K no le dio grupo. En la planilla real
  // son tres: el 00011 y los dos restos del almacén (00966 y 00967).
  { id: "d", codigo: "00011", grupo: null, stock_actual: 15 },
];

const MOVS = [
  { articulo_id: "a", fecha: "2026-09-01", entrada: 0, salida: 100, rotura: 2, despacho: 90 },
  { articulo_id: "b", fecha: "2026-09-02", entrada: 0, salida: 40, rotura: 0, despacho: 0 },
  { articulo_id: "a", fecha: "2026-08-01", entrada: 500, salida: 0, rotura: 0, despacho: 0 },
];

const SEPTIEMBRE = { desde: "2026-09-01", hasta: "2026-09-30" };

describe("resumirPorGrupo", () => {
  it("no cuenta los bolsones nuevos en dos grupos, como sí hace la planilla", () => {
    const r = resumirPorGrupo(ARTICULOS, MOVS, SEPTIEMBRE);

    const mixto = r.find((g) => g.grupo === "BOLSONES 1,20 + 1,40")!;
    const nuevos = r.find((g) => g.grupo === "BOLSONES 1,20 NUEVOS")!;

    // Los 40 del 00024 están en "NUEVOS" y NO en "1,20 + 1,40". La planilla los
    // pone en los dos, porque "BOLSONES NUEVOS TORRACO (1,20 P 02)" matchea
    // tanto "*1,20*" como "*NUEVOS*".
    expect(mixto.egresos).toBe(100);
    expect(nuevos.egresos).toBe(40);
  });

  it("deja afuera lo que no cae en el rango", () => {
    const r = resumirPorGrupo(ARTICULOS, MOVS, SEPTIEMBRE);
    // La entrada de 500 es del 1/8: fuera del rango.
    expect(r.find((g) => g.grupo === "BOLSONES 1,20 + 1,40")!.ingresos).toBe(0);
  });

  it("incluye los dos extremos del rango", () => {
    const r = resumirPorGrupo(ARTICULOS, MOVS, { desde: "2026-09-02", hasta: "2026-09-02" });
    expect(r.find((g) => g.grupo === "BOLSONES 1,20 NUEVOS")!.egresos).toBe(40);
  });

  it("lleva rotura y despacho, que la planilla no resume", () => {
    const mixto = resumirPorGrupo(ARTICULOS, MOVS, SEPTIEMBRE)
      .find((g) => g.grupo === "BOLSONES 1,20 + 1,40")!;
    expect(mixto.rotura).toBe(2);
    expect(mixto.despacho).toBe(90);
  });

  it("el stock es el de todos los artículos del grupo, tengan o no movimientos", () => {
    const r = resumirPorGrupo(ARTICULOS, MOVS, SEPTIEMBRE);
    // 00024 (0) + 00025 (600). La planilla deja afuera a los que nunca se
    // movieron; acá el 00025 entra igual.
    expect(r.find((g) => g.grupo === "BOLSONES 1,20 NUEVOS")!.stock).toBe(600);
  });

  it("un movimiento sin fecha no se cuenta ni se supone", () => {
    const r = resumirPorGrupo(
      ARTICULOS,
      [{ articulo_id: "a", fecha: null, entrada: 999, salida: 0, rotura: 0, despacho: 0 }],
      SEPTIEMBRE
    );
    expect(r.find((g) => g.grupo === "BOLSONES 1,20 + 1,40")!.ingresos).toBe(0);
  });

  it("los artículos sin grupo no desaparecen: van al final, en 'Sin grupo'", () => {
    const r = resumirPorGrupo(ARTICULOS, MOVS, SEPTIEMBRE);
    const ultimo = r[r.length - 1];
    expect(ultimo.grupo).toBeNull();
    expect(ultimo.stock).toBe(15);
    expect(ultimo.articulos).toBe(1);
  });

  it("ordena los grupos por nombre, para que la tabla no baile entre corridas", () => {
    const r = resumirPorGrupo(ARTICULOS, MOVS, SEPTIEMBRE);
    expect(r.map((g) => g.grupo)).toEqual([
      "BOLSONES 1,20 + 1,40", "BOLSONES 1,20 NUEVOS", null,
    ]);
  });
});
