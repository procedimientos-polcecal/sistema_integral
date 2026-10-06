import { describe, expect, it } from "vitest";
import { cantidadDelAviso, estaAtrasado, ritmoPorModulo, umbralDeRitmo } from "./ritmo";

describe("umbralDeRitmo", () => {
  it("es el hueco más largo más uno", () => {
    expect(umbralDeRitmo(3)).toBe(4);
    expect(umbralDeRitmo(10)).toBe(11);
    expect(umbralDeRitmo(22)).toBe(23);
  });

  // Sin piso, un módulo con dos días de historia tiene hueco 0, umbral 1, y
  // grita cada fin de semana.
  it("nunca baja de 3", () => {
    expect(umbralDeRitmo(0)).toBe(3);
    expect(umbralDeRitmo(1)).toBe(3);
    expect(umbralDeRitmo(2)).toBe(3);
  });

  // Sin tope, un parate largo le sube el umbral y lo deja mudo 180 días.
  it("nunca pasa de 30", () => {
    expect(umbralDeRitmo(45)).toBe(30);
    expect(umbralDeRitmo(180)).toBe(30);
  });

  /*
   * Los doce casos que se pueden escribir como fila, medidos contra producción
   * el 06/10/2026. El decimotercero de la tabla del spec es Producción, que
   * nunca se cargó y no tiene hueco ni días que poner en la tupla: se prueba
   * aparte, en `estaAtrasado` y en `ritmoPorModulo`. Si esta tabla deja de
   * pasar, cambió la regla, no el dato: los huecos son históricos.
   */
  it("reproduce la tabla de validación del spec", () => {
    const casos: [string, number, number, number, boolean][] = [
      // módulo, huecoMax, diasSinCargar, umbral esperado, ¿avisa?
      ["mantenimiento", 5, 1, 6, false],
      ["compras", 5, 1, 6, false],
      ["inventario", 4, 1, 5, false],
      ["cantera", 6, 5, 7, false],
      ["facturacion", 22, 4, 23, false],
      ["rrhh", 1, 6, 3, true],
      ["despacho", 3, 5, 4, true],
      ["taller_vial", 3, 8, 4, true],
      ["calidad", 3, 20, 4, true],
      ["calidad_envases", 3, 23, 4, true],
      ["trituracion", 3, 36, 4, true],
      ["remises", 10, 70, 11, true],
    ];
    for (const [modulo, huecoMax, dias, umbral, avisa] of casos) {
      expect(umbralDeRitmo(huecoMax), modulo).toBe(umbral);
      expect(estaAtrasado(dias, umbral), modulo).toBe(avisa);
    }
  });
});

describe("estaAtrasado", () => {
  it("avisa cuando llega justo al umbral", () => {
    expect(estaAtrasado(4, 4)).toBe(true);
    expect(estaAtrasado(3, 4)).toBe(false);
  });

  // Producción tiene 0 filas desde que existe. Un módulo que nunca se cargó no
  // está al día: si se tratara como "sin datos", la tarjeta diría que todo bien.
  it("un módulo que nunca se cargó está atrasado", () => {
    expect(estaAtrasado(null, 3)).toBe(true);
  });
});

describe("cantidadDelAviso", () => {
  /*
   * `filtrarDescartadas` vuelve a mostrar un aviso cuando su cantidad superó a
   * la que tenía al descartarlo. Si la cantidad fueran los días sin cargar,
   * descartarlo hoy lo traería mañana: el número crece solo todas las noches.
   */
  it("no crece de un día para el otro", () => {
    expect(cantidadDelAviso(36, 4)).toBe(9);
    expect(cantidadDelAviso(37, 4)).toBe(9);
    expect(cantidadDelAviso(38, 4)).toBe(9);
    expect(cantidadDelAviso(39, 4)).toBe(9);
  });

  it("crece recién al pasar otro umbral entero", () => {
    expect(cantidadDelAviso(40, 4)).toBe(10);
  });

  // "Producción nunca se cargó" no es novedad todos los días: descartarlo lo
  // calla para siempre.
  it("un módulo que nunca se cargó manda siempre 1", () => {
    expect(cantidadDelAviso(null, 3)).toBe(1);
  });
});

describe("ritmoPorModulo", () => {
  const fila = (modulo: string, dias: number | null, huecoMax: number) => ({
    modulo,
    ultima_fecha: dias === null ? null : "2026-09-30",
    dias_sin_cargar: dias,
    hueco_max: huecoMax,
  });

  it("arma el ritmo de cada módulo a partir de su fila", () => {
    const r = ritmoPorModulo([fila("despacho", 5, 3)]);
    expect(r.despacho).toEqual({
      ultimaFecha: "2026-09-30",
      diasSinCargar: 5,
      umbral: 4,
      atrasado: true,
    });
  });

  // Calidad se carga en dos mitades por separado —carbonilla y envases— y la
  // tarjeta es una sola: muestra la que está peor.
  it("Calidad se queda con la peor de sus dos mitades", () => {
    const r = ritmoPorModulo([fila("calidad", 20, 3), fila("calidad_envases", 23, 3)]);
    expect(r.calidad?.diasSinCargar).toBe(23);
  });

  it("Calidad prefiere la mitad que nunca se cargó", () => {
    const r = ritmoPorModulo([fila("calidad", 20, 3), fila("calidad_envases", null, 0)]);
    expect(r.calidad?.diasSinCargar).toBeNull();
    expect(r.calidad?.atrasado).toBe(true);
  });

  it("un módulo sin fila en la vista queda sin ritmo, no en cero", () => {
    const r = ritmoPorModulo([fila("despacho", 1, 3)]);
    expect(r.compras).toBeUndefined();
  });
});
