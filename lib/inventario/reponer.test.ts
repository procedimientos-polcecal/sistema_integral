import { describe, it, expect } from "vitest";
import { clasificarParaReponer, estaAbierto, DIAS_DE_CONSUMO } from "./reponer";
import type { ArticuloConFaltante, MovimientoDelConsumo, RequerimientoConCodigo } from "./reponer";

const HOY = "2026-10-02";

const art = (p: Partial<ArticuloConFaltante> = {}): ArticuloConFaltante => ({
  id: "a1",
  codigo: "00018",
  descripcion: "AIRE COMPRIMIDO AEROSOL",
  stock_actual: 0,
  stock_seguridad: 2,
  faltante: 2,
  activo: true,
  ...p,
});

const salida = (codigo: string, fecha: string): MovimientoDelConsumo =>
  ({ codigo, tipo: "salida", fecha });

const ri = (p: Partial<RequerimientoConCodigo> = {}): RequerimientoConCodigo => ({
  id: "r1",
  nro_ri: 2015,
  codigo: "00018",
  fecha: "2026-09-22",
  estado_aprobacion: "APROBADA",
  estado_compra: "PEDIDO",
  ...p,
});

describe("que RI esta abierto", () => {
  it("un pedido en curso esta abierto", () => {
    expect(estaAbierto(ri({ estado_compra: "PEDIDO" }))).toBe(true);
    expect(estaAbierto(ri({ estado_compra: "SIN_INICIAR" }))).toBe(true);
    expect(estaAbierto(ri({ estado_compra: "PARA_COMPRAR" }))).toBe(true);
  });

  it("recibido y denegado lo cierran", () => {
    expect(estaAbierto(ri({ estado_compra: "RECIBIDO" }))).toBe(false);
    expect(estaAbierto(ri({ estado_compra: "DENEGADO" }))).toBe(false);
  });

  it("una aprobacion denegada lo cierra aunque la compra no diga nada", () => {
    expect(estaAbierto(ri({ estado_aprobacion: "DENEGADA", estado_compra: null }))).toBe(false);
  });

  /** Sin estado de compra es un pedido que recien entra, no uno cerrado. */
  it("sin estado de compra sigue abierto", () => {
    expect(estaAbierto(ri({ estado_compra: null }))).toBe(true);
  });
});

describe("que entra en para reponer", () => {
  it("faltante y consumo reciente entra", () => {
    const r = clasificarParaReponer([art()], [salida("00018", "2026-09-20")], [], HOY);
    expect(r.paraPedir.map((c) => c.articulo.codigo)).toEqual(["00018"]);
    expect(r.yaPedidos).toEqual([]);
  });

  it("sin faltante no entra, aunque se haya usado ayer", () => {
    const r = clasificarParaReponer(
      [art({ faltante: 0, stock_actual: 5 })],
      [salida("00018", "2026-10-01")],
      [],
      HOY
    );
    expect(r.paraPedir).toEqual([]);
    expect(r.yaPedidos).toEqual([]);
  });

  /**
   * El caso de los 402: con faltante, en cero, y sin moverse en seis meses.
   * Es el ruido que esta pantalla existe para no mostrar.
   */
  it("con faltante pero sin salidas en la ventana no entra, aunque este en cero", () => {
    const r = clasificarParaReponer([art()], [salida("00018", "2026-03-01")], [], HOY);
    expect(r.paraPedir).toEqual([]);
  });

  it("un articulo sin ningun movimiento no entra", () => {
    const r = clasificarParaReponer([art()], [], [], HOY);
    expect(r.paraPedir).toEqual([]);
  });

  it("una salida de hace exactamente 90 dias entra; una de 91 no", () => {
    const justo = clasificarParaReponer([art()], [salida("00018", "2026-07-04")], [], HOY);
    expect(justo.paraPedir).toHaveLength(1);

    const tarde = clasificarParaReponer([art()], [salida("00018", "2026-07-03")], [], HOY);
    expect(tarde.paraPedir).toEqual([]);
  });

  /** Una entrada repone, no consume: no puede justificar que haya que pedir mas. */
  it("una entrada no cuenta como consumo", () => {
    const r = clasificarParaReponer(
      [art()],
      [{ codigo: "00018", tipo: "entrada", fecha: "2026-09-20" }],
      [],
      HOY
    );
    expect(r.paraPedir).toEqual([]);
  });

  it("un ajuste tampoco cuenta", () => {
    const r = clasificarParaReponer(
      [art()],
      [{ codigo: "00018", tipo: "ajuste", fecha: "2026-09-20" }],
      [],
      HOY
    );
    expect(r.paraPedir).toEqual([]);
  });

  it("un articulo inactivo no entra en ninguno de los dos", () => {
    const r = clasificarParaReponer(
      [art({ activo: false })],
      [salida("00018", "2026-09-20")],
      [ri()],
      HOY
    );
    expect(r.paraPedir).toEqual([]);
    expect(r.yaPedidos).toEqual([]);
  });

  it("una salida con fecha en el futuro no cuenta", () => {
    const r = clasificarParaReponer([art()], [salida("00018", "2026-10-20")], [], HOY);
    expect(r.paraPedir).toEqual([]);
  });

  it("una salida sin fecha no rompe ni cuenta", () => {
    const r = clasificarParaReponer(
      [art()],
      [{ codigo: "00018", tipo: "salida", fecha: null }],
      [],
      HOY
    );
    expect(r.paraPedir).toEqual([]);
  });

  it("cuenta las salidas y dice hace cuanto fue la ultima", () => {
    const r = clasificarParaReponer(
      [art()],
      [salida("00018", "2026-09-20"), salida("00018", "2026-09-30"), salida("00018", "2026-08-01")],
      [],
      HOY
    );
    expect(r.paraPedir[0].salidas).toBe(3);
    expect(r.paraPedir[0].diasDesdeLaUltima).toBe(2);
  });
});

describe("lo que ya esta pedido", () => {
  it("con un RI abierto va a yaPedidos y no a paraPedir", () => {
    const r = clasificarParaReponer([art()], [salida("00018", "2026-09-20")], [ri()], HOY);
    expect(r.paraPedir).toEqual([]);
    expect(r.yaPedidos).toHaveLength(1);
    expect(r.yaPedidos[0].ri.nro_ri).toBe(2015);
    expect(r.yaPedidos[0].cuantosAbiertos).toBe(1);
    expect(r.yaPedidos[0].diasDelRi).toBe(10);
  });

  /**
   * Como llega de PostgREST: `fecha` es timestamptz, no date. El `slice(0,10)`
   * es lo que hace andar la produccion y ningun test lo tocaba.
   */
  it("una fecha en forma de timestamp se lee igual", () => {
    const r = clasificarParaReponer(
      [art()],
      [salida("00018", "2026-09-20")],
      [ri({ fecha: "2026-09-22T00:00:00+00:00" })],
      HOY
    );
    expect(r.yaPedidos[0].diasDelRi).toBe(10);
  });

  /**
   * Un RI cargado a las 21:30 de Argentina cae en el dia UTC siguiente. Sin el
   * clamp la pantalla diria "hace -1 dias".
   */
  it("un pedido cargado de noche no da una antiguedad negativa", () => {
    const r = clasificarParaReponer(
      [art()],
      [salida("00018", "2026-09-20")],
      [ri({ fecha: "2026-10-03T00:30:00+00:00" })],
      HOY
    );
    expect(r.yaPedidos[0].diasDelRi).toBe(0);
  });

  it("si su unico RI esta recibido vuelve a paraPedir", () => {
    const r = clasificarParaReponer(
      [art()],
      [salida("00018", "2026-09-20")],
      [ri({ estado_compra: "RECIBIDO" })],
      HOY
    );
    expect(r.paraPedir).toHaveLength(1);
    expect(r.yaPedidos).toEqual([]);
  });

  it("si su unico RI esta denegado vuelve a paraPedir", () => {
    const r = clasificarParaReponer(
      [art()],
      [salida("00018", "2026-09-20")],
      [ri({ estado_aprobacion: "DENEGADA" })],
      HOY
    );
    expect(r.paraPedir).toHaveLength(1);
  });

  /**
   * El caso del 00666, que tiene tres abiertos: el 1956 de hace 22 dias y los
   * 983/984 de hace 175. Se informa el mas nuevo y cuantos hay.
   */
  it("con varios RI abiertos informa el mas nuevo y cuantos son", () => {
    const r = clasificarParaReponer(
      [art({ codigo: "00666" })],
      [salida("00666", "2026-09-20")],
      [
        ri({ id: "viejo", nro_ri: 983, codigo: "00666", fecha: "2026-04-10" }),
        ri({ id: "nuevo", nro_ri: 1956, codigo: "00666", fecha: "2026-09-10" }),
        ri({ id: "otro", nro_ri: 984, codigo: "00666", fecha: "2026-04-10" }),
      ],
      HOY
    );
    expect(r.yaPedidos[0].ri.nro_ri).toBe(1956);
    expect(r.yaPedidos[0].cuantosAbiertos).toBe(3);
  });

  it("un RI de otro codigo no lo afecta", () => {
    const r = clasificarParaReponer(
      [art()],
      [salida("00018", "2026-09-20")],
      [ri({ codigo: "99999" })],
      HOY
    );
    expect(r.paraPedir).toHaveLength(1);
  });

  it("un RI sin codigo no lo afecta", () => {
    const r = clasificarParaReponer(
      [art()],
      [salida("00018", "2026-09-20")],
      [ri({ codigo: null })],
      HOY
    );
    expect(r.paraPedir).toHaveLength(1);
  });

  it("el codigo se compara sin espacios de sobra", () => {
    const r = clasificarParaReponer(
      [art({ codigo: " 00018 " })],
      [salida("00018", "2026-09-20")],
      [ri({ codigo: "00018 " })],
      HOY
    );
    expect(r.yaPedidos).toHaveLength(1);
  });
});

describe("el orden", () => {
  it("paraPedir va por cantidad de salidas, de mayor a menor", () => {
    const r = clasificarParaReponer(
      [art({ id: "a", codigo: "A" }), art({ id: "b", codigo: "B" }), art({ id: "c", codigo: "C" })],
      [
        salida("A", "2026-09-20"),
        salida("B", "2026-09-20"), salida("B", "2026-09-21"), salida("B", "2026-09-22"),
        salida("C", "2026-09-20"), salida("C", "2026-09-21"),
      ],
      [],
      HOY
    );
    expect(r.paraPedir.map((c) => c.articulo.codigo)).toEqual(["B", "C", "A"]);
  });

  /** Empatados en salidas, primero el que se uso hace menos. */
  it("a igual cantidad de salidas, primero el mas reciente", () => {
    const r = clasificarParaReponer(
      [art({ id: "a", codigo: "A" }), art({ id: "b", codigo: "B" })],
      [salida("A", "2026-08-01"), salida("B", "2026-09-30")],
      [],
      HOY
    );
    expect(r.paraPedir.map((c) => c.articulo.codigo)).toEqual(["B", "A"]);
  });

  it("empatados en todo, por codigo, para que el orden no dependa de la consulta", () => {
    const r = clasificarParaReponer(
      [art({ id: "b", codigo: "B" }), art({ id: "a", codigo: "A" })],
      [salida("A", "2026-09-20"), salida("B", "2026-09-20")],
      [],
      HOY
    );
    expect(r.paraPedir.map((c) => c.articulo.codigo)).toEqual(["A", "B"]);
  });

  it("yaPedidos usa el mismo orden", () => {
    const r = clasificarParaReponer(
      [art({ id: "a", codigo: "A" }), art({ id: "b", codigo: "B" })],
      [salida("A", "2026-09-20"), salida("B", "2026-09-20"), salida("B", "2026-09-21")],
      [ri({ id: "ra", codigo: "A" }), ri({ id: "rb", codigo: "B" })],
      HOY
    );
    expect(r.yaPedidos.map((c) => c.articulo.codigo)).toEqual(["B", "A"]);
  });
});

describe("la ventana", () => {
  it("son 90 dias", () => {
    expect(DIAS_DE_CONSUMO).toBe(90);
  });
});
