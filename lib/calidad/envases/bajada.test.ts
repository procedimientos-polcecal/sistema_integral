import { describe, it, expect } from "vitest";
import {
  BLOQUES,
  PRIMERA_FILA,
  bloquesDeLaBajada,
  filasAVaciar,
  ordenarParaLaBajada,
  ultimaFilaConDatos,
  type MovimientoParaBajar,
} from "./bajada";
import { COL } from "./espejo";

/**
 * Lo que se fija acá es qué columnas toca la bajada y en qué orden salen las
 * filas. Es todo lo que puede estar mal sin que nada avise: escribir una
 * columna de fórmula de más rompe el stock del módulo entero, y un orden
 * distinto cambia todos los saldos intermedios sin cambiar los totales.
 */

const mov = (p: Partial<MovimientoParaBajar> = {}): MovimientoParaBajar => ({
  codigo: "00014",
  entrada: 0,
  salida: 0,
  rotura: 0,
  despacho: 0,
  fecha: "2026-09-16",
  observacion: null,
  proveedor: null,
  sheets_fila: null,
  created_at: "2026-09-16T12:00:00Z",
  ...p,
});

describe("BLOQUES", () => {
  /*
   * El kardex tiene la B (descripción), la G (stock) y la K (grupo) como
   * fórmulas, intercaladas entre las literales. Si un bloque las incluyera, la
   * bajada las pisaría y con la G se va el stock de todo el módulo. Por eso el
   * test no mira "que estén las que van" sino **que no esté ninguna de las
   * otras**.
   */
  it("no tocan ninguna columna de fórmula", () => {
    const FORMULA = { B: 1, G: 6, K: 10 };
    const tocadas = new Set<number>();
    for (const { desde, hasta } of BLOQUES) {
      for (let c = desde; c <= hasta; c++) tocadas.add(c);
    }
    for (const [letra, col] of Object.entries(FORMULA)) {
      expect(tocadas.has(col), `la bajada no puede escribir la columna ${letra}`).toBe(false);
    }
  });

  it("cubren exactamente las literales que el espejo escribe", () => {
    const tocadas = new Set<number>();
    for (const { desde, hasta } of BLOQUES) {
      for (let c = desde; c <= hasta; c++) tocadas.add(c);
    }
    expect([...tocadas].sort((a, b) => a - b)).toEqual(
      [COL.codigo, COL.entrada, COL.salida, COL.rotura, COL.despacho, COL.fecha, COL.observacion, COL.proveedor]
        .sort((a, b) => a - b)
    );
  });

  it("son contiguos, que es lo que permite escribirlos de a un PUT", () => {
    for (const { desde, hasta } of BLOQUES) expect(hasta).toBeGreaterThanOrEqual(desde);
  });
});

describe("ordenarParaLaBajada", () => {
  // Preservar el orden actual es lo que hace que la primera bajada sea casi un
  // no-op sobre un sistema sano. Si reordenara, todos los saldos intermedios
  // de la planilla cambiarían de golpe y no habría forma de distinguir eso de
  // una divergencia real.
  it("respeta el orden que ya tienen en la planilla", () => {
    const r = ordenarParaLaBajada([
      mov({ codigo: "c", sheets_fila: 9 }),
      mov({ codigo: "a", sheets_fila: 2 }),
      mov({ codigo: "b", sheets_fila: 5 }),
    ]);
    expect(r.map((m) => m.codigo)).toEqual(["a", "b", "c"]);
  });

  it("manda al final a los que nacieron en la app, por antigüedad", () => {
    const r = ordenarParaLaBajada([
      mov({ codigo: "nuevo2", sheets_fila: null, created_at: "2026-10-02T00:00:00Z" }),
      mov({ codigo: "viejo", sheets_fila: 7 }),
      mov({ codigo: "nuevo1", sheets_fila: null, created_at: "2026-10-01T00:00:00Z" }),
    ]);
    expect(r.map((m) => m.codigo)).toEqual(["viejo", "nuevo1", "nuevo2"]);
  });

  it("no modifica el arreglo que recibe", () => {
    const original = [mov({ codigo: "b", sheets_fila: 5 }), mov({ codigo: "a", sheets_fila: 2 })];
    ordenarParaLaBajada(original);
    expect(original.map((m) => m.codigo)).toEqual(["b", "a"]);
  });
});

describe("bloquesDeLaBajada", () => {
  const bloques = (ms: MovimientoParaBajar[]) => bloquesDeLaBajada(ms, "Entradas  Salidas");

  it("arranca en la fila 2, porque la 1 es el encabezado", () => {
    expect(PRIMERA_FILA).toBe(2);
  });

  it("da una fila por movimiento en cada bloque", () => {
    const r = bloques([mov(), mov(), mov()]);
    expect(r).toHaveLength(3);
    for (const b of r) expect(b.filas).toHaveLength(3);
  });

  /*
   * Los valores salen de `celdasDelMovimiento`, que ya está probada. Lo que se
   * comprueba acá es que al reacomodarlos no se corran de columna — que es el
   * error que dejaría el proveedor en la observación sin que nada falle.
   */
  it("pone cada valor en su columna", () => {
    const [a, cf, hj] = bloques([
      mov({
        codigo: "00014",
        entrada: 5,
        salida: 2,
        rotura: 1,
        despacho: 3,
        fecha: "2026-09-16",
        observacion: "una nota",
        proveedor: "ACME",
      }),
    ]);
    // El código va forzado a texto: `00014` sin la comilla quedaría en 14.
    expect(a.filas[0]).toEqual(["'00014"]);
    expect(cf.filas[0]).toEqual(["5", "2", "1", "3"]);
    // La fecha va en ISO y no como serial: un serial borra el formato de la
    // celda y se ve `46281`. Está medido en el encabezado de `espejo.ts`.
    expect(hj.filas[0]).toEqual(["2026-09-16", "una nota", "ACME"]);
  });

  it("el cero va vacío, no '0'", () => {
    const [, cf] = bloques([mov({ entrada: 0, salida: 4, rotura: 0, despacho: 0 })]);
    expect(cf.filas[0]).toEqual(["", "4", "", ""]);
  });

  it("un movimiento sin fecha deja la celda vacía en vez de inventar una", () => {
    const [, , hj] = bloques([mov({ fecha: null })]);
    expect(hj.filas[0][0]).toBe("");
  });

  it("sin movimientos no devuelve filas", () => {
    for (const b of bloques([])) expect(b.filas).toHaveLength(0);
  });
});

describe("filasAVaciar", () => {
  /*
   * Sin esto, borrar un movimiento en el SdG no lo saca de la planilla: queda
   * la cola vieja abajo y la fórmula del stock la sigue sumando.
   */
  it("vacía lo que sobra cuando la bajada quedó más corta", () => {
    // 3 movimientos ocupan las filas 2, 3 y 4; antes había datos hasta la 7.
    expect(filasAVaciar(3, 7)).toEqual([5, 6, 7]);
  });

  it("no vacía nada cuando creció", () => {
    expect(filasAVaciar(10, 4)).toEqual([]);
  });

  it("no vacía nada cuando quedó igual", () => {
    expect(filasAVaciar(3, 4)).toEqual([]);
  });

  it("vacía todo si la bajada quedó sin movimientos", () => {
    expect(filasAVaciar(0, 4)).toEqual([2, 3, 4]);
  });
});

describe("ultimaFilaConDatos", () => {
  it("devuelve la última con algo, aunque haya huecos antes", () => {
    expect(ultimaFilaConDatos([["CODIGO"], ["00014"], [""], ["00018"]])).toBe(4);
  });

  // La columna llega con celdas vacías de las fórmulas arrastradas: si contara
  // filas leídas en vez de buscar la última con contenido, escribiría mil
  // ochocientas filas debajo de donde alguien lo puede ver.
  it("ignora la cola de celdas vacías", () => {
    expect(ultimaFilaConDatos([["CODIGO"], ["00014"], [""], [""], [" "], []])).toBe(2);
  });

  it("devuelve 0 si no hay nada", () => {
    expect(ultimaFilaConDatos([])).toBe(0);
  });
});
