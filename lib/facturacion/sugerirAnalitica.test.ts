import { describe, it, expect } from "vitest";
import { analiticaDelEquipo, type AnaliticaDeOdoo } from "./analiticaDelEquipo";
import { sugerirAnalitica } from "./sugerirAnalitica";

/*
 * Los nombres son los de Odoo: el código del equipo va adelante y el nombre
 * atrás. Están las tres trampas reales: `EM1` contra `EM10`, la misma analítica
 * en las dos empresas, y `C1` de cantera contra `C1 - COMPRESOR 1`.
 */
const ANALITICAS: AnaliticaDeOdoo[] = [
  { id: 146, nombre: "EM1 - CATERPILLAR 320 B", empresa: 1 },
  { id: 246, nombre: "EM1 - CATERPILLAR 320 B", empresa: 2 },
  { id: 153, nombre: "EM10 - AUTOELEVADOR TOYOTA 1", empresa: 1 },
  { id: 152, nombre: "EM6 - CATERPILLAR 950 G", empresa: 1 },
  { id: 99, nombre: "C1", empresa: 1 },
  { id: 300, nombre: "C1 - COMPRESOR 1", empresa: 1 },
  { id: 400, nombre: "PO-A1-01 - ACARREADOR DE PLACAS", empresa: 1 },
  { id: 500, nombre: "COMPARTIDA - TALLER", empresa: null },
];

describe("la analítica que le corresponde a un equipo", () => {
  it("empareja por código, que está de los dos lados", () => {
    const r = analiticaDelEquipo("PO-A1-01", ANALITICAS, 1);
    expect(r.analitica?.id).toBe(400);
  });

  /*
   * La trampa que apareció escribiendo esto: sin exigir el borde, el equipo EM1
   * se llevaba EM10, EM11, EM12… dieciséis analíticas por delante.
   */
  it("EM1 no matchea EM10", () => {
    const r = analiticaDelEquipo("EM1", ANALITICAS, 1);
    expect(r.analitica?.id).toBe(146);
    expect(r.analitica?.nombre).toContain("320 B");
  });

  it("la empresa manda: el mismo equipo tiene una analítica por cada una", () => {
    expect(analiticaDelEquipo("EM1", ANALITICAS, 1).analitica?.id).toBe(146);
    expect(analiticaDelEquipo("EM1", ANALITICAS, 2).analitica?.id).toBe(246);
  });

  it("una compartida sirve cuando no hay propia", () => {
    const r = analiticaDelEquipo("COMPARTIDA", ANALITICAS, 2);
    expect(r.analitica?.id).toBe(500);
  });

  /*
   * Los tres ambiguos que hay de verdad: en Odoo conviven `C1` del plan CANTERA
   * y `C1 - COMPRESOR 1` del plan COMPRESORES. Con el código solo no se sabe.
   */
  it("con dos que empiezan igual no elige ninguna", () => {
    const r = analiticaDelEquipo("C1", ANALITICAS, 1);
    expect(r.analitica).toBeNull();
    expect(r.motivo).toContain("2 cuentas analíticas");
  });

  it("si sólo existe en la otra empresa lo dice", () => {
    const r = analiticaDelEquipo("EM1", ANALITICAS, 3);
    expect(r.analitica).toBeNull();
    expect(r.motivo).toContain("otra empresa");
  });

  it("un equipo sin código no tiene con qué buscarse", () => {
    expect(analiticaDelEquipo(null, ANALITICAS, 1).analitica).toBeNull();
    expect(analiticaDelEquipo("  ", ANALITICAS, 1).motivo).toContain("no tiene código");
  });

  it("un código que Odoo no conoce lo dice con esas palabras", () => {
    expect(analiticaDelEquipo("ZZ-99", ANALITICAS, 1).motivo).toContain("no tiene ninguna");
  });
});

const NOMBRES = new Map([
  [152, "EM6 - CATERPILLAR 950 G"],
  [254, "D1"],
  [137, "TALLER DE MANTENIMIENTO"],
]);

describe("la distribución que se propone para una línea", () => {
  it("el equipo del requerimiento gana, y sin umbral: no es una probabilidad", () => {
    const s = sugerirAnalitica(6835, {
      delEquipo: { id: 152, nombre: "EM6 - CATERPILLAR 950 G", nroRi: 1933 },
      historial: { porProducto: { "6835": { '{"254":100}': 50 } }, delProveedor: {} },
      nombres: NOMBRES,
    });

    expect(s?.analitica).toEqual({ "152": 100 });
    expect(s?.segun).toBe("el equipo del requerimiento");
    expect(s?.porque).toBe("el RI 1933 se pidió para ese equipo");
  });

  it("sin equipo, lo que este proveedor repartió para ese producto", () => {
    const s = sugerirAnalitica(6835, {
      historial: { porProducto: { "6835": { '{"254":100}': 8, '{"137":100}': 1 } }, delProveedor: {} },
      nombres: NOMBRES,
    });

    expect(s?.analitica).toEqual({ "254": 100 });
    expect(s?.segun).toBe("este proveedor y este producto");
    expect(s?.porque).toContain("8 de 9 veces");
  });

  it("el reparto entre varios se propone entero, no cuenta por cuenta", () => {
    const s = sugerirAnalitica(1, {
      historial: { porProducto: { "1": { '{"137":50,"152":50}': 5 } }, delProveedor: {} },
      nombres: NOMBRES,
    });

    expect(s?.analitica).toEqual({ "137": 50, "152": 50 });
    expect(s?.detalle).toContain("TALLER DE MANTENIMIENTO 50%");
  });

  it("sin historia del producto, cae a lo que hace el proveedor", () => {
    const s = sugerirAnalitica(999, {
      historial: { porProducto: {}, delProveedor: { '{"254":100}': 12 } },
      nombres: NOMBRES,
    });
    expect(s?.segun).toBe("este proveedor");
  });

  /*
   * Es el punto flojo y hay que respetarlo: a qué equipo fue un repuesto depende
   * de qué se rompió esa semana. Si el proveedor reparte parejo, no hay costumbre
   * que copiar.
   */
  it("si el proveedor reparte parejo no propone nada", () => {
    const s = sugerirAnalitica(1, {
      historial: { porProducto: { "1": { '{"254":100}': 5, '{"137":100}': 4 } }, delProveedor: {} },
      nombres: NOMBRES,
    });
    expect(s).toBeNull();
  });

  it("con un solo antecedente tampoco", () => {
    const s = sugerirAnalitica(1, {
      historial: { porProducto: { "1": { '{"254":100}': 1 } }, delProveedor: {} },
      nombres: NOMBRES,
    });
    expect(s).toBeNull();
  });

  it("sin equipo y sin historial, nada", () => {
    expect(sugerirAnalitica(1, { nombres: NOMBRES })).toBeNull();
  });

  it("una analítica que ya no está en el catálogo se muestra por su id", () => {
    const s = sugerirAnalitica(1, {
      historial: { porProducto: { "1": { '{"9999":100}': 4 } }, delProveedor: {} },
      nombres: NOMBRES,
    });
    expect(s?.detalle).toBe("#9999 100%");
  });
});
