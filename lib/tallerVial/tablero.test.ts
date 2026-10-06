import { describe, it, expect } from "vitest";
import {
  alertasDeFlota, barraDeConsumo, disponibilidadMensualDeLaFlota, diasEntre, fechaPlausible, revisarCargas, tarjetasDeFlota,
  type TarjetaDeEquipo,
} from "./tablero";
import type { CargaConTrabajo } from "./combustible";
import type { EstadoPlano } from "./estados";

const HOY = "2026-10-06";

const estado = (p: Partial<EstadoPlano>): EstadoPlano => ({ equipoId: "EM3", fecha: "2026-10-01", estado: "OPERATIVO", ...p });

describe("diasEntre", () => {
  it("cuenta días de calendario, también cruzando de mes", () => {
    expect(diasEntre("2026-09-28", "2026-10-06")).toBe(8);
    expect(diasEntre("2026-10-06", "2026-10-06")).toBe(0);
  });
});

describe("tarjetasDeFlota", () => {
  it("la racha del estado llega hasta el primer día con otro estado", () => {
    const [t] = tarjetasDeFlota(
      ["EM3"],
      [
        estado({ fecha: "2026-09-29", estado: "OPERATIVO" }),
        estado({ fecha: "2026-10-01", estado: "FUERA_DE_SERVICIO" }),
        estado({ fecha: "2026-10-02", estado: "FUERA_DE_SERVICIO" }),
        estado({ fecha: "2026-10-05", estado: "FUERA_DE_SERVICIO" }),
      ],
      [],
      HOY
    );
    expect(t.estado).toBe("FUERA_DE_SERVICIO");
    expect(t.desde).toBe("2026-10-01");
    // 01/10 a 06/10 inclusive: seis días.
    expect(t.diasEnEstado).toBe(6);
  });

  it("un día sin registro no corta la racha", () => {
    const [t] = tarjetasDeFlota(
      ["EM3"],
      [estado({ fecha: "2026-10-01" }), estado({ fecha: "2026-10-04" })],
      [],
      HOY
    );
    expect(t.desde).toBe("2026-10-01");
  });

  it("un equipo sin ningún estado queda con todo en null, no en cero", () => {
    const [t] = tarjetasDeFlota(["EM9"], [estado({})], [], HOY);
    expect(t.estado).toBeNull();
    expect(t.diasEnEstado).toBeNull();
  });

  it("el horómetro es la última lectura CON lectura, aunque la carga más nueva no la traiga", () => {
    const [t] = tarjetasDeFlota(
      ["EM3"],
      [],
      [
        { equipoId: "EM3", fecha: "2026-09-20", lectura: 7900 },
        { equipoId: "EM3", fecha: "2026-09-28", lectura: 7995 },
        { equipoId: "EM3", fecha: "2026-10-02", lectura: null },
      ],
      HOY
    );
    expect(t.horometro).toBe(7995);
    expect(t.ultimaCarga).toBe("2026-10-02");
    expect(t.diasSinCarga).toBe(4);
  });
});

describe("tarjetasDeFlota — lecturas en cero", () => {
  it("una lectura 0 de relleno no es el horómetro: queda sin dato", () => {
    const [t] = tarjetasDeFlota(["EM8"], [], [{ equipoId: "EM8", fecha: "2026-07-03", lectura: 0 }], HOY);
    expect(t.horometro).toBeNull();
    expect(t.ultimaCarga).toBe("2026-07-03");
  });
});

function tarjeta(p: Partial<TarjetaDeEquipo>): TarjetaDeEquipo {
  return { equipoId: "EM3", estado: "OPERATIVO", desde: "2026-10-01", diasEnEstado: 6, horometro: 100, ultimaCarga: "2026-10-05", diasSinCarga: 1, ...p };
}

function cargaT(p: Partial<CargaConTrabajo>): CargaConTrabajo {
  return { id: "x", equipoId: "EM3", fecha: "2026-08-01", litros: 150, lectura: 0, trabajado: 10, consumoPorUnidad: 15, ...p };
}

const base = { services: [], unidadDe: () => "hs", hoy: HOY, cargasConTrabajo: [] as CargaConTrabajo[] };

describe("alertasDeFlota", () => {
  it("fuera de servicio pocos días no alerta; desde tres, sí y en crítico", () => {
    expect(alertasDeFlota({ ...base, tarjetas: [tarjeta({ estado: "FUERA_DE_SERVICIO", diasEnEstado: 2 })] })).toEqual([]);
    const [a] = alertasDeFlota({ ...base, tarjetas: [tarjeta({ estado: "FUERA_DE_SERVICIO", diasEnEstado: 5, desde: "2026-10-02" })] });
    expect(a.tipo).toBe("FUERA_DE_SERVICIO");
    expect(a.nivel).toBe("critica");
    expect(a.texto).toContain("5 días");
    expect(a.texto).toContain("02/10");
  });

  it("sin carga: usa la costumbre del propio equipo, con un piso de 7 días", () => {
    // Carga cada 2 días: a los 8 sin cargar ya pasó el piso (7) y 3× su costumbre (6).
    const frecuente = Array.from({ length: 6 }, (_, i) => cargaT({ id: `f${i}`, fecha: `2026-09-${String(10 + i * 2).padStart(2, "0")}`, consumoPorUnidad: null, trabajado: null }));
    const otro = tarjeta({ equipoId: "EM9", diasSinCarga: 1, ultimaCarga: "2026-10-05" }); // para que no sea "nadie cargó"
    const t = tarjeta({ diasSinCarga: 8, ultimaCarga: "2026-09-28" });
    const alertas = alertasDeFlota({ ...base, tarjetas: [t, otro], cargasConTrabajo: frecuente });
    expect(alertas.map((a) => a.tipo)).toEqual(["SIN_CARGA"]);
    expect(alertas[0].texto).toContain("suele cargar cada 2");

    // Carga cada 10 días: a los 8 sin cargar es lo normal para él, no avisa.
    const lento = Array.from({ length: 6 }, (_, i) => cargaT({ id: `l${i}`, fecha: `2026-07-${String(1 + i * 5).padStart(2, "0")}`, consumoPorUnidad: null, trabajado: null }));
    const lento10 = lento.map((c, i) => ({ ...c, fecha: new Date(Date.UTC(2026, 6, 1 + i * 10)).toISOString().slice(0, 10) }));
    expect(alertasDeFlota({ ...base, tarjetas: [t, otro], cargasConTrabajo: lento10 })).toEqual([]);
  });

  it("sin carga: no avisa de un equipo parado hace meses, ni del fuera de servicio, ni si casi no tiene historial", () => {
    const historial = Array.from({ length: 6 }, (_, i) => cargaT({ id: `f${i}`, fecha: `2026-09-${String(10 + i * 2).padStart(2, "0")}`, consumoPorUnidad: null, trabajado: null }));
    const otro = tarjeta({ equipoId: "EM9", diasSinCarga: 1, ultimaCarga: "2026-10-05" });
    const con = (t: Partial<TarjetaDeEquipo>, cargas = historial) => alertasDeFlota({ ...base, tarjetas: [tarjeta(t), otro], cargasConTrabajo: cargas });
    expect(con({ diasSinCarga: 95, ultimaCarga: "2026-07-03" })).toEqual([]);
    expect(con({ diasSinCarga: 10, estado: "FUERA_DE_SERVICIO", diasEnEstado: 1 })).toEqual([]);
    expect(con({ diasSinCarga: 10, ultimaCarga: "2026-09-26" }, historial.slice(0, 3))).toEqual([]);
  });

  it("si ningún equipo cargó en días, avisa una sola vez y no equipo por equipo", () => {
    const historial = Array.from({ length: 6 }, (_, i) => cargaT({ id: `f${i}`, fecha: `2026-09-${String(10 + i * 2).padStart(2, "0")}`, consumoPorUnidad: null, trabajado: null }));
    const alertas = alertasDeFlota({
      ...base,
      tarjetas: [tarjeta({ diasSinCarga: 8, ultimaCarga: "2026-09-28" }), tarjeta({ equipoId: "EM4", diasSinCarga: 9, ultimaCarga: "2026-09-27" })],
      cargasConTrabajo: historial,
    });
    expect(alertas.map((a) => a.tipo)).toEqual(["FLOTA_SIN_CARGAS"]);
    expect(alertas[0].equipoId).toBeNull();
    expect(alertas[0].nivel).toBe("critica");
    expect(alertas[0].texto).toContain("8 días");
  });

  it("consumo alto: compara el último mes entero contra los 6 meses anteriores, no una carga suelta", () => {
    const historial = Array.from({ length: 6 }, (_, i) => cargaT({ id: `h${i}`, fecha: `2026-07-0${i + 1}` })); // 15 L/hs
    // Una sola carga muy alta no alcanza: el mes completo sale a 16 L/hs.
    const unaAlta = [
      cargaT({ id: "r1", fecha: "2026-09-20", litros: 130, trabajado: 10, consumoPorUnidad: 13 }),
      cargaT({ id: "r2", fecha: "2026-09-24", litros: 140, trabajado: 10, consumoPorUnidad: 14 }),
      cargaT({ id: "r3", fecha: "2026-09-28", litros: 250, trabajado: 10, consumoPorUnidad: 25 }),
    ];
    expect(alertasDeFlota({ ...base, tarjetas: [], cargasConTrabajo: [...historial, ...unaAlta] })).toEqual([]);

    // Un mes entero a 20 L/hs sí.
    const mesAlto = [20, 21, 19].map((l, i) => cargaT({ id: `a${i}`, fecha: `2026-09-2${i}`, litros: l * 10, trabajado: 10, consumoPorUnidad: l }));
    const [a] = alertasDeFlota({ ...base, tarjetas: [], cargasConTrabajo: [...historial, ...mesAlto] });
    expect(a.tipo).toBe("CONSUMO_ALTO");
    expect(a.texto).toContain("33%");
  });

  it("consumo alto: sin cargas suficientes —recientes o de referencia— no compara", () => {
    const cinco = Array.from({ length: 5 }, (_, i) => cargaT({ id: `h${i}`, fecha: `2026-07-0${i + 1}` }));
    const altasPocas = [30, 30].map((l, i) => cargaT({ id: `a${i}`, fecha: `2026-09-2${i}`, litros: l * 10, trabajado: 10, consumoPorUnidad: l }));
    expect(alertasDeFlota({ ...base, tarjetas: [], cargasConTrabajo: [...cinco, ...altasPocas] })).toEqual([]);

    const cuatro = cinco.slice(0, 4);
    const altas = [30, 30, 30].map((l, i) => cargaT({ id: `b${i}`, fecha: `2026-09-2${i}`, litros: l * 10, trabajado: 10, consumoPorUnidad: l }));
    expect(alertasDeFlota({ ...base, tarjetas: [], cargasConTrabajo: [...cuatro, ...altas] })).toEqual([]);
  });

  it("services: vencido es crítico, próximo es atención, al día no dice nada", () => {
    const alertas = alertasDeFlota({
      ...base,
      tarjetas: [],
      services: [
        { equipoId: "EM1", lectura: "VENCIDO", horasFaltantes: -30 },
        { equipoId: "EM2", lectura: "PROXIMO", horasFaltantes: 20 },
        { equipoId: "EM3", lectura: "AL_DIA", horasFaltantes: 200 },
        { equipoId: "EM4", lectura: null, horasFaltantes: null },
      ],
    });
    expect(alertas.map((a) => [a.equipoId, a.nivel])).toEqual([["EM1", "critica"], ["EM2", "atencion"]]);
  });

  it("lo crítico va primero aunque se haya detectado después", () => {
    const alertas = alertasDeFlota({
      ...base,
      tarjetas: [],
      services: [
        { equipoId: "EM2", lectura: "PROXIMO", horasFaltantes: 20 },
        { equipoId: "EM9", lectura: "VENCIDO", horasFaltantes: -5 },
      ],
    });
    expect(alertas.map((a) => a.nivel)).toEqual(["critica", "atencion"]);
  });
});

const c = (id: string, fecha: string, lectura: number | null, equipoId: string | null = "EM3") => ({ id, equipoId, equipoRaw: "EM3 - Doosan", fecha, lectura });

describe("revisarCargas", () => {
  it("marca las cargas sin equipo reconocido", () => {
    const [p] = revisarCargas([c("a", "2026-09-01", null, null)], HOY);
    expect(p.tipo).toBe("SIN_EQUIPO");
  });

  it("un número de menos marca esa carga y no la siguiente", () => {
    const problemas = revisarCargas([c("a", "2026-09-01", 7900), c("b", "2026-09-10", 795), c("c", "2026-09-20", 7995)], HOY);
    expect(problemas.map((p) => [p.cargaId, p.tipo])).toEqual([["b", "LECTURA_MENOR"]]);
  });

  it("un número de más marca esa carga y no la siguiente, que está bien", () => {
    const problemas = revisarCargas([c("a", "2026-09-01", 7900), c("b", "2026-09-10", 79500), c("c", "2026-09-20", 7995)], HOY);
    expect(problemas.map((p) => [p.cargaId, p.tipo])).toEqual([["b", "LECTURA_MAYOR"]]);
  });

  it("dos cargas el mismo día no cuentan como retroceso, sin importar el orden en que vinieron", () => {
    expect(revisarCargas([c("a", "2026-09-27", 2369), c("b", "2026-09-27", 2356)], HOY)).toEqual([]);
  });

  it("lecturas que sólo suben, o cargas sin lectura, no marcan nada", () => {
    expect(revisarCargas([c("a", "2026-09-01", 100), c("b", "2026-09-02", null), c("c", "2026-09-03", 130)], HOY)).toEqual([]);
  });

  it("una fecha imposible se avisa siempre y esa carga no entra a la comparación de lecturas", () => {
    const problemas = revisarCargas(
      [c("a", "2006-08-06", 16780), c("b", "0226-07-25", 4493), c("c", "2026-09-01", 100), c("d", "2026-09-10", 130)],
      HOY
    );
    expect(problemas.map((p) => [p.cargaId, p.tipo])).toEqual([["a", "FECHA_DUDOSA"], ["b", "FECHA_DUDOSA"]]);
  });

  it("lo que pasó hace más de 120 días no se lista: ya no se puede arreglar con provecho", () => {
    const viejo = revisarCargas([c("a", "2026-01-31", null, null), c("b", "2026-01-01", 5000), c("c", "2026-01-05", 50), c("d", "2026-01-09", 5100)], HOY);
    expect(viejo).toEqual([]);
    const reciente = revisarCargas([c("a", "2026-09-30", null, null)], HOY);
    expect(reciente).toHaveLength(1);
  });

  it("cada equipo se compara con sus propias cargas", () => {
    expect(revisarCargas([c("a", "2026-09-01", 9000, "EM3"), c("b", "2026-09-02", 100, "EM4")], HOY)).toEqual([]);
  });
});

describe("fechaPlausible", () => {
  it("rechaza 2006 y 0226, acepta hoy y mañana, rechaza más allá", () => {
    expect(fechaPlausible("2006-08-06", HOY)).toBe(false);
    expect(fechaPlausible("0226-09-17", HOY)).toBe(false);
    expect(fechaPlausible("2026-10-06", HOY)).toBe(true);
    expect(fechaPlausible("2026-10-07", HOY)).toBe(true);
    expect(fechaPlausible("2026-10-20", HOY)).toBe(false);
  });
});

describe("barraDeConsumo", () => {
  it("sin consumo no hay barra; sin referencia hay barra neutra y sin marca", () => {
    expect(barraDeConsumo(null, 15).nivel).toBeNull();
    const sinRef = barraDeConsumo(15, null);
    expect(sinRef.marcaPct).toBeNull();
    expect(sinRef.nivel).toBeNull();
  });

  it("igual al promedio cae sobre la marca y es normal", () => {
    const b = barraDeConsumo(15, 15);
    expect(b.anchoPct).toBeCloseTo(b.marcaPct!, 5);
    expect(b.desvioPct).toBe(0);
    expect(b.nivel).toBe("NORMAL");
  });

  it("los niveles cortan en +10% y +25%", () => {
    expect(barraDeConsumo(16.5, 15).nivel).toBe("NORMAL");
    expect(barraDeConsumo(17, 15).nivel).toBe("ATENCION");
    expect(barraDeConsumo(18.75, 15).nivel).toBe("ATENCION");
    expect(barraDeConsumo(19, 15).nivel).toBe("ALTO");
  });

  it("consumir menos que el promedio es normal, y la barra no se sale del 100%", () => {
    expect(barraDeConsumo(10, 15).nivel).toBe("NORMAL");
    expect(barraDeConsumo(10, 15).desvioPct).toBe(-33);
    expect(barraDeConsumo(60, 15).anchoPct).toBe(100);
  });
});

describe("disponibilidadMensualDeLaFlota", () => {
  it("suma días de toda la flota: operativo sobre registrados", () => {
    const [sep, oct] = disponibilidadMensualDeLaFlota(
      [
        estado({ equipoId: "A", fecha: "2026-09-01", estado: "OPERATIVO" }),
        estado({ equipoId: "A", fecha: "2026-09-02", estado: "FUERA_DE_SERVICIO" }),
        estado({ equipoId: "B", fecha: "2026-09-01", estado: "OPERATIVO" }),
        estado({ equipoId: "B", fecha: "2026-09-02", estado: "OPERATIVO_CON_FALLAS" }),
      ],
      ["2026-09", "2026-10"]
    );
    expect(sep.pct).toBe(50);
    expect(sep.dias).toBe(4);
    // Un mes sin datos es null, no 0%: 0% diría que toda la flota estuvo parada.
    expect(oct.pct).toBeNull();
  });
});
